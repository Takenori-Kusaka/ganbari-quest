# 0026. 致命修正コミットの force push による消失防止

- **Status**: Accepted
- **Date**: 2026-04-30
- **Related Issue**: #1750
- **Related Incidents**: PR #1717 (1683-C Legal SSOT) でリモート HEAD が force push され、`SANITIZE_CONFIG` 拡張 / E2E テスト / XHTML パーサ対応の致命修正がすべて消失
- **Related ADRs**: ADR-0006 (Safety Assertion Erosion Ban), ADR-0019 (CDK Replacement Detection Gate), ADR-0022 (admin bypass disable QM approve), ADR-0025 (LP SSOT innerHTML + DOMPurify)

## 背景

PR #1717 (1683-C Legal SSOT) では QM Re-Review が実機検証で「DOMPurify が legal docs の構造タグを strip してベタテキスト崩壊する」致命的欠陥を 2 度検出した:

1. **1 回目 BLOCK 後の Fix Agent (commit a00e42cc)**: `SANITIZE_CONFIG.ALLOWED_TAGS` 拡張、E2E spec 追加、XHTML パーサ対応を実装
2. **2 回目 Re-Review**: 修正が PR HEAD に反映されていないと検出 → 再 BLOCK
3. **2 回目 Fix Agent (commit a58b1abc) の調査結果**: リモート HEAD が `17f6590a → a24f2f97` に **force push されており**、1 回目の修正が**完全消失**していた

force push の主体は不明（rebase した第三者か PR 作成者）だが、以下の構造的問題が浮上した:

- 致命修正コミットが意図せず force push で消失するリスクが構造的に存在する
- 「Re-Review が前回 BLOCK 検出箇所と同じ欠陥を検出する」サイクルが気付かれず進行する
- `dismiss_stale_reviews_on_push: true` は force push 経由の意図せぬ消失を検出できない

ADR-0006 (Safety Assertion Erosion Ban) の精神性と整合: 一度確立した安全機構を意図せずに削除しないようにする構造的 Gate が必要。

## 決定

多層防御として以下 3 つの仕組みを併用する。単一機構では不完全のため A + B + C を組み合わせる (#1750 の選択肢 D)。

### 1. **GitHub Branch Ruleset で `require_last_push_approval: true` を有効化** (AC1)

- main ブランチおよび PR ターゲット候補ブランチで「最後の push 後に最低 1 件の approve が必要」を設定
- これにより force push 直後に approve が剥がれ、明示的な再 approve なしでマージ不可となる
- `dismiss_stale_reviews_on_push: true` と併用する

### 2. **致命修正検査 CI ジョブ（hard-fail）** (AC2)

ADR-0019 (CDK Replacement Detection Gate) と同パターン。
`scripts/check-lp-innerhtml-tags.mjs` (#1747) で静的検査する。

検査対象は `site/shared-labels.js` の `SANITIZE_CONFIG.ALLOWED_TAGS` である。
必須タグ (`h1` / `h2` / `h3` / `h4` / `p` / `ul` / `ol` / `li` / `div` / `table` / `tr` / `th` / `td` / `header` / `section` / `dl` / `dt` / `dd` 等) を**全て含むこと**を確認する。

加えて、過去の Re-Review で BLOCK 検出されたファイルが PR から削除されていないかを以下のとおり検証する:

- 必須 E2E spec ファイル `tests/e2e/lp-legal-docs-render.spec.ts` の存在確認 (#1717 残存ガード)
- 必須 E2E spec ファイル `tests/e2e/lp-innerhtml-structure.spec.ts` の存在確認 (#1747 残存ガード)
- これらのファイルが削除された場合、`scripts/check-lp-innerhtml-tags.mjs` が `[FAIL]` を返すよう拡張する

ADR-0006 と同様、**warn ではなく hard-fail** で運用する。skip するには本 ADR を supersede する別 ADR を起票する必要がある。

### 3. **PR Re-Review 時の前回 BLOCK 検出箇所機械チェック** (AC3)

QM Re-Review Agent / QA セッションは、Re-Review 時に「前回 BLOCK Issue の AC 番号 → 当該ファイル / 行 / 設定値」のマッピングを参照し、当該箇所が変更されていないかを必ず検証する。

- 検証は `scripts/check-lp-innerhtml-tags.mjs` (静的) + `tests/e2e/lp-innerhtml-structure.spec.ts` (E2E) の 2 段で行う
- Agent が「前回検出箇所が修正されている」と報告した場合でも、Re-Review 担当は本 ADR で定めたチェックを必ず実行する

### 4. **dev-session.md / qa-session.md への注意事項追記** (AC5)

- **致命修正後の force push 禁止** を dev-session.md / qa-session.md に明記
- やむを得ず force push が必要な場合（例: 機密情報を漏らした場合）は、PO に事前通知 + ADR-0006 と同様の手続きを踏む
- `git push --force-with-lease` を必須化し、`git push --force` の使用は禁止（git config で `push.useForceIfIncludes = true` を推奨）

## 検討した選択肢

### 選択肢 A: Branch Ruleset の `require_last_push_approval` のみ

- pros: GitHub native、設定 1 行
- cons: 通常の rebase + force-with-lease も approval を要求される。force push の意図せぬ消失自体は検出できない（push 後の approve 剥がしのみ）

### 選択肢 B: 致命修正の静的検査 CI のみ（ADR-0019 パターン）

- pros: PR 単位で検出可能、既存 CI 基盤を活用
- cons: 検査ロジックの維持コスト。「何が致命修正か」のリストを継続的に更新する必要あり

### 選択肢 C: Re-Review 機械チェックのみ

- pros: 致命欠陥が再発した瞬間に検出
- cons: マッピング管理コスト。Re-Review 担当が手動で実行する仕組みは抜け漏れリスクあり

### 選択肢 D: A + B + C の組み合わせ（採用）

- 機構的予防 (A) + 静的検査 (B) + Re-Review 自動チェック (C) の多層防御
- 単一機構の脆弱性を相互補完できる
- ADR-0006 / ADR-0019 と一貫した「構造的 Gate」設計

## 結果

- **再発防止強度**: 致命修正の force push 消失は force push 自体ではなく「修正コードが消えたか」を CI で検証することで構造的に防止できる
- **運用コスト**: `scripts/check-lp-innerhtml-tags.mjs` を新規追加 (#1747 と同 PR)、Branch Ruleset 設定を 1 回行うのみ
- **副作用**:
  - 通常の rebase + force-with-lease 後にも approve 剥がしが発生する。Pre-PMF 体制では PO 単独 approve のため運用上の摩擦は低い
  - `--force-with-lease` を必須化することで、誤った force push で同僚作業を上書きするリスクも下がる

## 実装スコープ

本 ADR を採択する PR (P5B2 bundle / #1750 / #1747) で以下を完了する:

- [x] `scripts/check-lp-innerhtml-tags.mjs` の作成（#1747）
- [x] `tests/e2e/lp-innerhtml-structure.spec.ts` の作成（#1747）
- [x] `package.json` `lint:lp-innerhtml-tags` script + `lint:parallel` chain への組み込み
- [x] 本 ADR の起票
- [ ] **GitHub Branch Ruleset 設定** — PR レビュー後に GitHub Settings → Rules → Rulesets で `require_last_push_approval: true` を有効化（PO 操作）
- [ ] **dev-session.md / qa-session.md への明記** — 別 PR で `.claude/agents/dev-session.md` / `.claude/agents/qa-session.md` を更新（本 PR の scope は scripts + ADR のみ、Agent 文書化は #1750 の Done 基準 AC5 を別 follow-up Issue ではなく本 PR 内で完了するため次節で対応する）

## ADR-0006 との関係

ADR-0006 は「警告緩和 / 閾値緩和を ADR なしで行わない」を定めており、本 ADR は同精神性を「致命修正コミットを ADR なしで消失させない」へ拡張する。両 ADR とも警告/修正の eroding を構造的に防止する点で一貫している。
