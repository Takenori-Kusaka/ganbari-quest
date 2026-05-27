# Dev Self-Review Agent — 運用 SSOT

| 項目 | 内容 |
|---|---|
| 目的 | PR Ready 化前の Dev 側 self-review。QA team 5 手順を先取り自己実行し、同種指摘を未然に検知 |
| 位置付け | Dev session の 1 step (Ready 化前必須 step、条件付き) |
| 権限 | merge / approve なし。Dev 内部判定で BLOCK 一覧 / OK 評価 |
| 参照 | `docs/sessions/qa-session.md` 5 手順 / `docs/sessions/qa-checklist-ui-quality.md` 10 項目 |

---

## §1 必須化条件

| PR 種別 | Self-Review |
|---|---|
| schema 変更 / 設計書同期 / 新 ADR / UI primitive / 大規模 refactor (PR diff > 50 行 / `.svelte` 変更) | **必須** |
| 微修正 / docs only / typo fix | 任意 |

---

## §2 レビュー観点

### §2.1 qa-session.md 5 手順

| 手順 | 内容 | 実施方法 |
|---|---|---|
| 1. Issue 照合 | PR body の `closes #N` を読み Issue AC と PR diff 1:1 突合 | `gh issue view <N>` + `gh pr diff <PR>` で AC check |
| 2. SS 実視認 | PR body の SS を Read tool で実際に開く、1 画像 1 行所見 | `gh pr view <PR> --json body` で URL 抽出 → 各 Read |
| 3. SS 欠落検知 | UI / `site/**` / `.svelte` / `.css` 変更で SS 0 枚 → BLOCK | `gh pr diff <PR> --name-only` で diff 検出 → SS 有無確認 |
| 4. CI 確認 | `gh pr checks <PR>` 全 green (skip 無視可) | 同コマンド |
| 5. 承認/BLOCK | Self-Review は承認権限なし → block list 出力 | 内部判定として block 一覧を report |

### §2.2 Self-Review 固有 追加観点 (16 項目)

| # | カテゴリ | チェック観点 | 検証コマンド / 手順 |
|---|---|---|---|
| 1 | **破綻なし** | biome / svelte-check / vitest / playwright 全 PASS | `npm run pre-ready -- --pr <PR>` |
| 2 | **テスト十分性** | 新規 service / component に対応 test、E2E 動線 cover、skip count 増加 0 | `tests/` grep + skip count diff |
| 3 | **UI SS 期待 UX** | SS で期待動線が実現 | screenshots branch + Storybook |
| 4 | **Storybook 適合** | 新 primitive の `*.stories.svelte` 存在、autodocs、test:storybook PASS | `npm run test:storybook` |
| 5 | **過去 QA 指摘事前回避 (7 件)** | ADR 番号衝突 / ADR deprecation chain / copilot-instructions 同期 / todo trap / label / SS / discriminated union | 各観点の検証は `docs/sessions/qa-session.md` Tier 2 手順 5 と `docs/decisions/README.md` (ADR インベントリ + supersede 関係) を参照 |
| 6 | **docs SSOT 原則 (#2440)** | docs 本体に変更履歴 / supersede / 経緯メタ 0 件 | `grep -rE "supersede\|以前は\|⚠ .*覆\|変更履歴" docs/<新ファイル>` |
| 7 | **SOLID 違反** | DIP (ORM 直呼び) / SRP (1 関数全責) / ISP (巨大 interface) | コードレビュー (Read tool) |
| 8 | **場当たり対応** | hex 直書き / `<button>` 直書き / labels ハードコード | `stylelint` / `check-no-plan-literals.mjs` / `check-hardcoded-strings.mjs` |
| 9 | **AC 検証マップ完備 (ADR-0004)** | PR body の AC 表 全行埋まる + Issue AC と一致 | `check-pr-body.mjs` |
| 10 | **PR body 必須セクション** | 顧客価値・目的 / AC / やらないこと / 横展開 / レビュー依頼 / 破壊的変更 / 配布済み env / Ready チェックリスト / QM 結果 | `check-pr-body.mjs` |
| 11 | **禁止語回避** | follow-up / 予定 / TODO / 別途 / autodocs (todo trap) | `check-pr-body.mjs` |
| 12 | **PR label** | type:* / area:* / priority:* 付与 | `gh pr view <PR> --json labels` |
| 13 | **並行実装同期 (parallel-implementations.md 6 ペア)** | labels / 年齢モード / 本番デモ / ナビ / DB / チュートリアル | 該当ペア 該当時に同期 |
| 14 | **Research 方針との適合性** | 上流 research / policy docs と実装が整合 | `tmp/user-question/<scope-docs>` と diff 突合 |
| 15 | **セキュリティ / 認証情報流出** | API response / URL / cookie / log に PII / token / secret 漏れ 0 / CWE-598 / COPPA / GDPR | `grep -rE "console.log\|console.error" src/` + `gh pr diff` で sensitive data 検出 / response shape 確認 |
| 16 | **メモリリーク防止** | `$effect` cleanup / `onDestroy` listener removal / subscription unsubscribe / setInterval clear / WebSocket close | `grep -rE "\$effect\|addEventListener\|setInterval\|setTimeout" src/<新規ファイル>` |
| 17 | **レンダリング性能 (lazyload 含む)** | bundle size 増減 / `await import()` lazy 化 / image `loading="lazy"` / N+1 query / cache 戦略 | `npm run build` で bundle size diff / `grep -rE "<img" src/` で lazy 属性確認 |

### §2.3 UI/UX 品質 10 項目

UI 変更 PR では必ず実行。詳細は `docs/sessions/qa-checklist-ui-quality.md` 参照。

### §2.4 Self-Review HONESTY（false PASS 主張の禁止、Issue #2475）

Dev Self-Review で「PASS」と自己宣言したが QM Re-Review で実態 FAIL という事象が連続再発した（Issue #2475、3 PR 連続: PR-4/5/6）。**各観点に機械検証コマンド + ローカル実行結果を必ず添付**する。証跡コマンド添付なしの「PASS」は **false PASS と同等扱い**（= FAIL 判定）。

特に以下の観点は report に機械検証コマンド + 結果を必ず含める:

| 観点 | 必須添付 |
|---|---|
| #1 破綻なし | `npm run pre-ready -- --pr <N>` の出力末尾 5 行 |
| #2 テスト十分性 | `npx vitest run` の `Test Files X passed (X)` 行 + `git diff main --stat` の test file 件数 |
| #5 過去 QA 指摘事前回避 | `gh pr view <N> --json commits` で先行 PR の fix commit を grep し回避済み確認 |
| #8 場当たり対応 | `grep -rn "TODO\|FIXME" <変更 file>` 0 件 / `npx stylelint --no-fix <変更 .svelte>` PASS |
| #15 セキュリティ | tenant 外 childId を 403 reject する unit test 名を列挙（CWE-598 関連時） |

**test count の自己宣言が stale にならないよう注意**: facade / strategy rewrite 後に「X PASS / Y FAIL」と書く時は、rewrite 後の実 capture コマンド（`npx vitest run > tmp/vitest-full-output.txt 2>&1`）で取り直す。pre-rewrite の数字をそのまま流用しない（#2475 7 件目再発の原因）。

verdict table には「false PASS 主張ゼロを目視確認済」を明記する。QA team が merge 前に加えた fix の頻出パターンは [../sessions/dev-process/qa-fix-patterns.md](../sessions/dev-process/qa-fix-patterns.md) を参照し、事前回避する。

---

## §3 Agent spawn テンプレート

### §3.1 共通入力

| パラメータ | 内容 |
|---|---|
| `<PR>` | レビュー対象 PR 番号 |
| `<branch>` | PR の head branch (Agent が `gh pr view <PR> --json headRefName` で取得) |
| `<scope-docs>` | 関連 PR の policy synthesis docs path (`tmp/user-question/2026-05-XX-prX-policy-synthesis.md`) |
| `<related-issue>` | PR が close する Issue 番号 |

### §3.2 Prompt template (Agent 起動時にコピー、`<>` 置換)

```
## Task: Self-Review of PR #<PR> (Dev Inner Critic)

QA team review 前段階として、`docs/operations/self-review-agent.md` §2 観点 (qa-session.md 5 手順 + 自由追加 17 項目) を **自己批判的に** 自己実行する。BLOCK 一覧 / OK 評価を内部判定で出力 (merge / approve コマンドは実行しない)。

### 必読 input docs

1. `docs/operations/self-review-agent.md` (本運用 SSOT)
2. `docs/sessions/qa-session.md` (QA team 5 手順)
3. `docs/sessions/qa-checklist-ui-quality.md` (UI/UX 10 項目)
4. `<scope-docs>` (PR 設計憲法 = Dev policy synthesis)
5. `docs/decisions/README.md` (ADR インベントリ + supersede 関係 — 過去 QA 指摘 7 件の構造的背景)

### 手順

§2.1 qa-session.md 5 手順 + §2.2 Self-Review 固有 17 項目 を順次実施。各項目の PASS / FAIL を判定し、FAIL 時は具体的修正方針を BLOCK 一覧に記録。

### 報告フォーマット

## Self-Review Result (PR #<PR>)

### 評価: ✅ APPROVE (Dev 内部) / ⚠ BLOCK (Dev 内部、要修正)

### 手順 1: Issue 照合
- Issue #<X> AC 突合結果: ...

### 手順 2: SS 実視認
- SS 1 (URL): 所見 ...
- SS 2 (URL): 所見 ...

### 手順 3: SS 欠落検知
- diff 変更: ...
- SS 状況: ...

### 手順 4: CI 確認
- 全 green / red job: ...

### 手順 5: Self-Review 固有 17 項目
1. 破綻なし: PASS / FAIL ...
2. テスト十分性: PASS / FAIL ...
3. UI SS 期待 UX: PASS / FAIL / N/A ...
4. Storybook 適合: PASS / FAIL / N/A ...
5. 過去 QA 指摘回避 (7 件): [✓✓✓✓✓✓✓] / [✗ <item>]
6. docs SSOT 原則: PASS / FAIL ...
7. SOLID 違反: なし / 検出: ...
8. 場当たり対応: なし / 検出: ...
9. AC 検証マップ: 完備 / 不備 ...
10. PR body 必須セクション: PASS / FAIL ...
11. 禁止語回避: PASS / FAIL ...
12. PR label: 付与済 (type:X / area:Y / priority:Z) / 不足 ...
13. 並行実装同期: 該当なし / 同期確認済 / 不足 ...
14. Research 方針適合: PASS / 乖離: ...
15. セキュリティ / 認証情報流出: なし / 検出: ...
16. メモリリーク防止: なし / 検出: ...
17. レンダリング性能: PASS / 懸念: ...

### BLOCK 一覧 (要 Dev 修正)
(BLOCK あれば箇条書き、なければ「なし」)

### Dev next action
- BLOCK ありの場合: 各 BLOCK に対する fix 方針 + 修正対象 file
- 全 PASS の場合: `gh pr ready <PR>` 実行 OK の判定

### 関連 file (絶対パス)
...

### 制約

- merge / approve コマンドは実行しない (権限なし)
- BLOCK 発見時は Dev 側で fix → 再 spawn (反復可)
- Self-Review approve = QA team へ渡す準備完了の判定
- 1 Agent = 1 PR
- 700 行以内で報告
```

---

## §4 BLOCK 対応 (Dev session 主体の判断分岐)

| BLOCK 件数 | 対応 |
|---|---|
| 1-3 件 | Dev session 主体が直接 fix → 再 spawn |
| 4+ 件 | Fix Agent spawn → 再 spawn (Fix Agent prompt は `docs/sessions/qa-session.md` 参照) |

---

## §5 失敗からの学習

Self-Review が approve したが QA team が BLOCK した場合:
- 該当 BLOCK 種類を本 docs §2.2 観点表に追加 (PR で本ファイルを更新)
- 横断ポリシー化が必要な場合は ADR 起票 (`docs/decisions/README.md` 10 枠 + 1-in-1-out ルール参照)
- 次回以降の Self-Review で同種検知

---

## §6 観点根拠 evidence base

本 SSOT §2.2 17 観点 / §1 必須化条件 / §4 BLOCK 対応の設計根拠となる、Dev / QA 同種指摘の連続再発事例:

| Issue / PR | 再発カテゴリ | §2.2 該当観点 |
|---|---|---|
| #2438 | Fix Agent が main HEAD の最新 SSOT を確認せず BLOCK 解消が不完全になる (2 回再発) | #5 過去 QA 指摘事前回避 / #14 Research 方針との適合性 |
| #2444 | Dev Agent が PR body 13 セクション SSOT を遵守せず CI fail を再発させる (3 回再発) | #9 AC 検証マップ完備 / #10 PR body 必須セクション |
| #2449 | ADR 番号衝突 / deprecation chain / copilot-instructions 同期 | #5 過去 QA 指摘事前回避 |
| #2450 | CI AC todo trap / type:feat label 不足 / UI primitive SS 不足 / TypeScript optional silent skip | #5 過去 QA 指摘事前回避 / #11 禁止語回避 / #12 PR label / #2 テスト十分性 |
| #2407 / #2435 / #2442 / #2443 | docs research / revert cycle で 13 sections 欠落・dogfooding 失敗 | #6 docs SSOT 原則 / #10 PR body 必須セクション |

これらは本 SSOT 起票の構造的根拠であり、§2.2 観点表は今後の再発検出機構として機能する。
