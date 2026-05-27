# QA fix パターン集 — merge 前に QA team が加えた頻出 fix

> PR が QA team によって merge される際、merge 前に QA team が加えた fix commit の頻出パターン集。同種指摘を後続 PR で繰り返さないための事前回避チェックリスト。

**SSOT 位置付け**: [dev-process/README.md](README.md) の各論。関連: [../../operations/self-review-agent.md](../../operations/self-review-agent.md)（§2.2 観点 5「過去 QA 指摘事前回避」の根拠リスト）

---

## merge 通知を受けたら必ず確認する

PR merge 通知を受けたら、merge commit + その直前の fix commit を確認し、QA team がどんな指摘を出したかを学習する。

```bash
gh pr view <num> --json commits --jq '.commits[] | "\(.oid[:8]) \(.messageHeadline)"'
# 最後の fix commit の詳細を取得
gh api repos/Takenori-Kusaka/ganbari-quest/commits/<sha> --jq '.commit.message'
```

「fix: #XXXX PR #YYYY BLOCK 解消 - ...」commit を read し、次の PR / docs に学びを反映する。これを怠ると想定外の変更が混入したり、QA team に何度も同じ指摘をもらう。

---

## 頻出 QA fix カテゴリ

### ADR / docs 系

| カテゴリ | 内容 |
|---|---|
| ADR 番号衝突 | 既存 ADR + burn 済番号（revert cycle）を含む全件確認。起票前に `docs/decisions/README.md` の active + archive 全件照合 |
| ADR deprecation chain | ADR-0023→0031 / ADR-0009→0045 等、参照前に status 確認 |
| `.github/copilot-instructions.md` 同期 | ADR 追加 / 変更時は同期必須 |
| docs SSOT 原則違反 | docs 本体に変更履歴 / supersede / 経緯メタを混入させない（#2440） |
| PR body 必須セクション欠落 | `.github/PR_TEMPLATE_SECTIONS.json` SSOT の全セクション（13 件）を `check-pr-body.mjs` 準拠で配置 |
| closes 誤参照（umbrella 巻き込み） | `Closes: #2362` 等 EPIC を誤指定して umbrella 全閉じ。後続 Phase Issue を別途起票して `closes` はそちらに |

### CI gate 系

| カテゴリ | 内容 |
|---|---|
| CI AC todo trap | `pr-ac-verification-check.yml` は `/todo/i` 部分一致（TODO / autodocs / autogen-docs）を検出。禁止語回避 |
| label 手動付与 | `gh pr edit <num> --add-label "type:xxx"`（CI 自動付与されないケースあり） |
| UI 変更 PR SS | Storybook iframe / capture script で SS → screenshots branch push |
| schema.ts と create-tables.ts SSOT 不整合 | schema 変更時の cascade CI fail。[feature-change-lateral-spread.md](feature-change-lateral-spread.md) の SSOT 群同期参照 |

### 実装 / セキュリティ系

| カテゴリ | 内容 |
|---|---|
| 新 action IDOR（CWE-598） | `importPresetToChildren` / `copyFromChild` 等の new action で tenant 外 childId を accept してしまう。tenant scope 検証必須 |
| SvelteKit 303 redirect JSON parse fail | form action から 303 を返すと client fetch の JSON parse が常時 fail。`x-sveltekit-action: true` + `deserialize()` 必須 |
| TypeScript 型 silent skip | optional fields → discriminated union + type guard（fail loud） |
| E2E tenant_id mismatch | `global-setup.ts` seed tenant_id と auth provider 返却 tenant_id 不一致で JOIN filter fail。seed と provider の tenant_id 整合確認必須 |
| status flip で claim window 喪失 | `markCompleted` で即 `status='completed'` に flip すると active list から除外 → claim button が render されず報酬受取不可。`status='active' OR (status='completed' AND rewardClaimed=0)` の expansion 必要 |
| N+1 in loop | build helper が iteration ごとに内部 fetch する。`prefetched*` optional 引数で caller 側 1 回 fetch + pass-through pattern |

### テスト同期系（facade / strategy rewrite 後）

| カテゴリ | 内容 |
|---|---|
| integration test の inline SQL_TABLES 更新忘れ | facade rewrite で SSOT table が flip した時、`tests/integration/*.test.ts` の `SQL_TABLES` inline CREATE TABLE 群に new table 追加 + reset/seed の table 名変更 |
| mock setup mismatch | facade rewrite で内部呼出が変わると `$lib/server/db/*-repo` mock の expected method が変わる（per-row → bulk 等） |
| action 名変更の test 同期忘れ | action 名変更時（`importChallengeSet` → `importMarketplaceChallengeSet` 等）関連 unit test を全件 grep + 同期 |
| 旧 spec rewrite（削除でなく） | 旧前提の spec は削除ではなく新動線に rewrite |
| Valibot maxLength で ZWJ emoji fail | `👨‍👩‍👧‍👦`（11 UTF-16 code units）が `maxLength(10)` で validation fail。emoji 受入時は maxLength を 20 程度に拡張 |
| SS 偽装（.catch swallow） | capture spec で `.catch(() => {})` を必須遷移に付けて fail を握りつぶし、SS-attempted 接尾辞で失敗自認 = 偽装。必須遷移は明示 wait + 失敗で throw |

### Svelte 5 / Ark UI 固有

| カテゴリ | 内容 |
|---|---|
| Ark UI Menu hydration race | headless `openMenu` 即 click で Portal positioner が display:none。rAF retry pattern を spec に移植 |
| `$effect` 内 replaceState router not initialized | `$app/navigation` の replaceState が hydration 直後 fail。`tick()` 1 microtask + fallback `window.history.replaceState` |
| Toast 多重発火 | `$effect` 依存値が複数 update する場合 dedupe key 必要（例: `lastProcessedImportFingerprint`） |

---

## Self-Review HONESTY（false PASS 主張の禁止）

Dev Self-Review で「PASS」と自己宣言したが QM Re-Review で実態 FAIL という事象が連続再発した（Issue #2475、3 PR 連続）。**各観点に機械検証コマンド + ローカル実行結果を必ず添付**する。証跡コマンド添付なしの「PASS」は false PASS と同等扱い。

特に以下は機械検証コマンド + 結果を report に含める:

- 破綻なし: `npm run pre-ready -- --pr <N>` の出力末尾 5 行
- テスト十分性: `npx vitest run` の `Test Files X passed (X)` 行 + `git diff main --stat` の test file 件数
- 過去 QA 指摘事前回避: `gh pr view <N> --json commits` で先行 PR の fix commit を grep し回避済み確認
- 場当たり対応: `grep -rn "TODO\|FIXME" <変更 file>` 0 件 / `npx stylelint --no-fix <変更 .svelte>` PASS
- セキュリティ: tenant 外 childId を 403 reject する unit test 名を列挙（CWE-598 関連時）

**test count の自己宣言が stale にならないよう注意**: facade rewrite 後に「X PASS / Y FAIL」と書く時は、rewrite 後の実 capture コマンド（`npx vitest run > tmp/vitest-full-output.txt 2>&1`）で取り直す。pre-rewrite の数字をそのまま流用しない。

詳細運用は [self-review-agent.md](../../operations/self-review-agent.md) §2.2 / §6 を SSOT とする。
