# ADR-0030: `npm run pre-ready` CLI 採用と pre-push hook 非採用

- Status: Accepted
- Date: 2026-05-01
- Related: Issue #1775, PR #1746 / #1751 / #1754 / #1759 / #1765 / #1770 (Fix Agent 自己言及循環事故)
- Related: ADR-0010 (Pre-PMF スコープ判断 — 過剰防衛抑制)

## Context

直近 50 PR の観察で以下 5 パターンの BLOCK 起因事故が頻発した:

1. **CI 自己言及循環**: PR template の Ready for Review チェックリスト「CI が全て通過している」項目を `[x]` にするには CI 通過が必要だが、この checkbox 自体が `pr-merge-gate.yml` の検出対象 — Fix Agent がこの 1 項目を埋めるためだけに動く事故 (PR #1746 / #1751 / #1754 / #1759 / #1765 / #1770)
2. **PR body 禁止語スキャン範囲が AC マップ限定**: 「補足」「設計方針」「レビュー依頼」セクションに「予定」「別 PR」「follow-up」が混入 (PR #1763 / #1770)
3. **必須セクション見出しの完全一致漏れ**: QM レビュー結果セクションの括弧書き完全一致が必要だが、開発者が括弧の `— #1197 / #1198` 部分を削除して再 push する事故 (PR #1718 / #1746 / #1760)
4. **`mergeable: CONFLICTING` 事前検知不在**: Ready 化時点では merge 可能でも、QM Review 中に他 PR が merge されて CONFLICTING 化 (PR #1672 / #1675 / #1718 / #1753)
5. **ローカルセルフチェック忘れ**: 開発者が `npx biome check` / `npx svelte-check` / `npx vitest run` をローカル実行せず Ready 化 → CI で検出されるが時間ロス

QM Orchestrator の観察 (2026-05-01): 「追加 CI ゲートは天井に近い。`pre-ready` ローカルコマンドを 1 本作れば、開発者の『やり忘れ』は事前検出可能。CI は最終防衛線として現状維持で十分」。PO 承認済み。

## Decision

### 採用: `npm run pre-ready` CLI

`scripts/pre-ready.mjs` + `scripts/check-pr-body.mjs` を新設し、Ready for Review 化前のローカル一括セルフチェックを開発者・Agent が**明示的に実行**する運用とする。

- 実装は純 Node CLI (`spawn` で既存 `scripts/*.mjs` を順次呼ぶ薄いオーケストレータ)
- 各 Step で fail したら即 exit 1 + 修正方針表示
- PR template の Ready for Review チェックリストには `npm run pre-ready` 実行項目を追加
- `pr-merge-gate.yml` のチェックリスト検査は継続 (チェックリスト全項目 [x] が維持されている前提で動作)
- 自己言及循環項目「CI が全て通過している」は PR template から削除 (CI 通過確認は GitHub Status Checks 側に委ねる)

### 検討した OSS / 確立パターン (Issue #1775 / #1350 OSS 先調査ルール準拠)

| 選択肢 | pros | cons | 採否 |
|-------|------|------|------|
| **(採用) 純 Node CLI** | 既存 `scripts/*.mjs` (lint:parallel 等) と同じ世界観で追加学習コスト 0 / Windows + WSL + macOS 全環境対応 / `npm run pre-ready` で発火 | 開発者が実行を忘れたら効果なし (→ template チェックリストでカバー) | ✅ 採用 |
| Husky + lint-staged | git pre-commit / pre-push hook で自動実行 / 業界標準 | (a) commit 単位で重い検査を毎回走らせると DX 悪化 (本 CLI は PR 単位検査で重い)、(b) Husky 導入は npm 依存追加で Pre-PMF 段階の最小化方針 (ADR-0010) と摩擦、(c) WSL / Windows Git Bash で `core.hooksPath` を上書きするユーザがいて事故源 | ❌ 不採用 |
| lefthook | Husky と同等 / Go バイナリ単体 / yaml 設定 | Husky と同じ「自動実行 → 強制力 vs DX」のトレードオフ。さらに別バイナリインストールが必要 | ❌ 不採用 |
| pre-commit (python) | 言語横断 / Python エコシステムで人気 | Python 環境必須で本リポジトリ (pure Node) と整合せず | ❌ 不採用 |
| GitHub Actions `workflow_dispatch` | リモート実行可能 | ローカルとの差異が出る / 開発者が手動 trigger 忘れる | ❌ 不採用 |

### Pre-PMF 適合 (ADR-0010)

- Pre-PMF サインアップ 20 名/月達成に必要か: いいえ (運用効率向上)
- 採用理由: Re-Review サイクル削減で Auto Mode Agent コスト削減 + 開発者体験向上
- 過剰防衛にならない理由: 既存 CI ゲートは現状維持、新規追加せず。本 CLI はあくまで「ローカル事前検出」の補助線で、最終防衛線は CI 側が担う

### AC6 (`.husky/pre-push` 自動実行) — 非採用

Issue #1775 AC6 で「オプション推奨」と提案されたが、以下の理由で**現時点では採用しない**:

1. `package.json` 現状に husky / lefthook 依存なし — 導入は新規 dev dependency 追加
2. Pre-PMF 段階での tooling 追加は ADR-0010 の最小化方針に反する
3. 開発者が `--no-verify` で bypass するインセンティブがあり、ADR-0006 (assertion erosion ban) の文化と整合しない
4. 代替: PR template チェックリストで `npm run pre-ready` 実行を明示的に求める (人間 + Agent 双方に効果あり)

将来 Pre-PMF 卒業後にチーム規模拡大した時点で再検討する。

## Consequences

### Positive

- Fix Agent の起動回数削減 (CI 自己言及循環解消)
- PR body 禁止語スキャン範囲の拡大 (AC マップ限定 → body 全体)
- 必須セクション見出しの SSOT 化 (`.github/PULL_REQUEST_TEMPLATE.md` を runtime parse)
- mergeable: CONFLICTING の事前検知でマージ前事故を予防
- ローカル一括検査でテスト実行漏れの即発見

### Negative

- 開発者・Agent が `npm run pre-ready` を忘れた場合、CI で検出されるまで遅延 (現状維持と同等)
- `scripts/pre-ready.mjs` / `scripts/check-pr-body.mjs` の保守コスト (約 600 行 / OSS 依存なし)
- PR template から削除した「CI が全て通過している」項目に依存していた既存 PR は再生成が必要 (Re-Review 時に template と diff)

### Followup

- 1 ヶ月運用後 (2026-06-01) に Re-Review サイクル件数の比較レビュー
- Husky / lefthook 採用検討は Post-PMF 後 (チーム規模 5 名以上)
- `--pr` 引数なし運用での DX 観察 (現状: PR 未作成時は Step 6/7 skip)

## References

- Issue #1775
- PR #1746 / #1751 / #1754 / #1759 / #1765 / #1770 (CI 自己言及循環事故)
- PR #1763 / #1770 (PR body 禁止語混入)
- PR #1718 / #1746 / #1760 (必須セクション完全一致漏れ)
- PR #1672 / #1675 / #1718 / #1753 (CONFLICTING 化)
- ADR-0010 (Pre-PMF スコープ判断)
- ADR-0006 (Safety Assertion Erosion Ban — `.skip` / `--no-verify` 抑制原則と整合)

## 2026-05-27 補追: 前提崩れによる位置付け変更

本 ADR の決定根拠の 1 つ「`package.json` に husky / lefthook 依存なし (2026-05-01 時点)」は、その後の PR (詳細は git log 参照) で `husky: ^9.1.7` が devDependencies に追加され前提が崩れている。

加えて ADR-0022 amendment 3 (#1879) で `.husky/pre-push` が `scripts/check-gh-account-before-pr.mjs` を呼ぶ運用が確立されたことで、本 ADR §「検討した OSS / 確立パターン」表中の Husky 非採用 cons (a) / (b) は **gh アカウント検証という別目的での Husky 導入が既に成立済**となり、history-only。

ただし本 ADR の中心位置付け (`npm run pre-ready` CLI による開発者明示実行 / pre-push hook での重い検査自動実行は不採用) は依然有効。`.husky/pre-push` の現運用 (gh account check のみ) は軽量検査であり、本 ADR の AC6 非採用判断 (重い lint / test を pre-push で走らせない) と矛盾しない。

pre-push hook 拡張 (例: pre-ready 全 step を pre-push で走らせる) は別途 RFC を要する。本 ADR は履歴 record として保持し、現状運用との差分を本節で明示する。
