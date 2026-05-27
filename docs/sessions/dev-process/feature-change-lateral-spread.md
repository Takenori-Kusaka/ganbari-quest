# 機能変更時の横展開確認

> 用語・ラベル・機能変更時に「1 箇所だけ直して他が壊れる」最多の問題パターンを防ぐ。grep 全件確認 + LP/pricing 波及 + SSOT 群同期。

**SSOT 位置付け**: [dev-process/README.md](README.md) の各論。並行実装ペアの本体は [parallel-implementations.md](../../design/parallel-implementations.md)。

---

## 1. 用語・ラベル変更は grep で全件確認

テキスト修正・用語変更・ラベル変更を含む変更では、横展開（他画面・他ファイルに同じ文字列が残っていないか）を必ず確認する。「1 画面だけ直って他が壊れている」が顧客クレームインシデントで最多の問題パターン。

1. テキスト修正前に `grep -rn "修正前テキスト" src/ site/` で全出現箇所を洗い出す
2. 全箇所を修正する（1 箇所だけ直して `closes #xxx` にしない）
3. 変更説明に「grep 結果: N 箇所中 N 箇所修正、除外理由: ...」を明記
4. 用語 SSOT は `src/lib/domain/terms.ts`（atom）→ `labels.ts`（compound）の 2 階層（ADR-0045）。atom 1 行修正で全画面伝播することを確認

---

## 2. 機能変更時の LP / pricing / faq 波及確認（ADR-0013 LP truth）

新機能・機能変更・plan policy 変更の Issue 起票時、**LP / pricing / faq に同類訴求があるか必ず grep 確認**し、波及修正を AC に含める。

```bash
# 該当機能を LP / pricing / faq で訴求しているか確認
grep -rn "<機能関連キーワード>" site/index.html site/pricing.html site/faq.html
grep -rn "<機能関連キーワード>" src/lib/domain/labels.ts
```

ヒットあれば Issue / PR の AC に追加（LP 3 ページの該当箇所 path を明示）:

- [ ] LP トップ（hero / 機能訴求の該当 section）
- [ ] pricing（プラン比較表 / FAQ の該当行）
- [ ] faq（該当 Q&A）
- [ ] labels.ts / shared-labels.js（生成 source）
- [ ] LP メトリクス ratchet 維持（forbiddenTerms 0 / desktopHeight 8000 / presetActivityCountClaimedMin 300）
- [ ] LP SS 再撮影（該当 page）
- [ ] `node scripts/generate-lp-labels.mjs --check`
- [ ] `node scripts/sync-lp-fallback.mjs --check`

適用範囲: 機能の追加 / 削除 / 仕様変更 / プラン policy 変更（free / standard / family / trial）/ 制限数値変更（お子さま 2 人まで / 活動 3 個まで等）/ 主要 use case の表現変更。

> 教訓: 「フリープラン手動追加禁止 + インポートのみ」起票時、LP / pricing の「活動 3 個まで」「持ち物チェックリスト 3 個/子まで」訴求への波及修正を忘れた。ADR-0013（LP truth）で明文化されているのに Issue 起票時に観点が漏れた。

---

## 3. DB schema 変更時の SSOT 群同期（4 dimension）

schema を変更する PR は複数の SSOT file を同期する。未同期だと CI 環境の fresh DB で初めて発覚し、cascade fail する（build / test / e2e / docker-build / ci-gate 全て）。

| dim | file | 責務 |
|---|---|---|
| 1 | `src/lib/server/db/schema.ts` | drizzle table 型 SSOT |
| 2 | `src/lib/server/db/create-tables.ts` | 新規 DB / dev / CI 用の `CREATE TABLE IF NOT EXISTS` |
| 3 | `src/lib/server/db/migration/lazy-startup-migrations.ts`（structural） | 既存 production DB への shadow-table recreation / DROP COLUMN / FK target switch |
| 4 | 同上（data copy） | cross-table semantic flip 時の row 移動（per-table → per-child、family master → tenant scope） |

(3) は schema 形状を旧→新に合わせる（列 / FK / 制約）。(4) はデータ自体を旧 table 群から新 table 群へ意味的に再配置する。両者は同 file 内に並ぶが責務が異なる。

検証コマンド:

```bash
# semantic flip を含む schema 変更 PR では以下が全件 hit 必須
git diff main --name-only | grep -E '(schema|create-tables|lazy-startup-migrations)\.ts'
# かつ data copy block を含むこと
git diff main -- src/lib/server/db/migration/lazy-startup-migrations.ts | grep -E '(INSERT INTO|UPDATE.*SET.*activity_id|UPDATE.*SET.*child_id)'
```

横展開すべき SSOT 群（DB スキーマペア）:

- `src/lib/server/db/schema.ts`（drizzle table 定義）
- `src/lib/server/db/create-tables.ts`（起動時 CREATE TABLE 群）
- `src/lib/server/db/migration/lazy-startup-migrations.ts`（structural + data copy）
- `tests/unit/helpers/test-db.ts`（unit test DB setup）
- `tests/e2e/global-setup.ts`（E2E DB seed）
- `src/lib/server/demo/demo-data.ts`（demo fixture）
- `src/lib/server/db/dynamodb/keys.ts`（DynamoDB key 設計、tenant scope 変更時）
- `tests/integration/*.test.ts` の `SQL_TABLES` inline CREATE TABLE 群（facade rewrite で SSOT table が flip した時）

> 教訓: activities → child_activities flip（PR #2487）で dim 1/2/3 を同期したが dim 4（data copy）が漏れ、NUC user data が完全消失した（history 全件 orphan、UI 表示 0）。schema 形状の変更（dim 1-3）と row 移動（dim 4）は独立に扱う。設計書 SSOT は `docs/design/08-データベース設計書.md`、再発時 runbook は `docs/runbooks/activities-data-recovery.md`。

---

## 4. PR / レビューでの横展開チェック

- PR 作成時（Dev）: テキスト変更 PR は「grep 全件確認しましたか?」を自問。demo / 本番の両方を確認
- PR レビュー時（Reviewer）: diff に含まれないファイルに同じテキストが残っていないか自分でも grep で検証。開発者の「全件修正しました」を信じるだけでは不十分
