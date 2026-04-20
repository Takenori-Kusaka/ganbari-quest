# 0031. スキーマ変更時の既存データ互換性テスト義務化

> **Archived (2026-04-20)**: スキーマ変更互換性テスト。CI 組込済み

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-16 |
| 起票者 | Session PO |
| 関連 Issue | #963, #962 (postmortem), #783, #941 (原因 PR) |
| 関連 ADR | ADR-0020 (test quality ratchet), ADR-0029 (safety assertion erosion ban) |

## コンテキスト

### なぜこの決定が必要か

PR #941 で children テーブルに `is_archived` カラムを追加し、一覧クエリに `eq(isArchived, 0)` フィルタを入れた。結果、**本番 NUC の既存行が `is_archived = NULL` のままアプリに認識されず、セットアップ済みテナントが「未セットアップ」扱いとなりリダイレクトループで全利用不可**になった（Postmortem #962）。

### なぜテストで検出できなかったか

- ローカル E2E / unit テストは **`drizzle-kit push` で DB を毎回新規作成**する
- 新規作成時は全行が CREATE TABLE 時点の DEFAULT 値で挿入されるため `is_archived = 0` が保証される
- 本番 DB は `ALTER TABLE ADD COLUMN` で追加されるため**既存行が NULL のまま残る**
- `eq(col, 0)` は `col IS NULL` にマッチしない（SQL の 3 値論理）
- **テストが「NULL 混在の既存 DB」を前提にしていなかった**ことが根本原因

### 「全バージョン DB をテストする」は非現実的

全過去バージョンの DB を保持してテストするのは運用不能。必要なのは
**カラム追加時に NULL 混在行のテストケースを 1 件だけ追加すること**。

## 検討した選択肢

### 選択肢 A: 全バージョン DB のテスト環境構築

- メリット: 完全な後方互換検証
- デメリット: DB スナップショット管理 / テスト時間爆発 / マイグレーション依存の DAG 管理 → **非現実的**

### 選択肢 B: マイグレーション script 側で backfill + ADR でテスト必須化（採用）

- **マイグレーション側**: `ALTER TABLE ADD COLUMN` と同時に `UPDATE table SET col = default WHERE col IS NULL` を実行
- **クエリ側**: NULL と 0（または default）を区別しない場合は `or(eq(col, default), isNull(col))` でフィルタ
- **テスト側**: 新カラム追加時は「NULL 混在行」を INSERT してクエリ結果を検証するテストを 1 件追加
- **CI 側**: `src/lib/server/db/schema.ts` が変更された PR に対応するテストが無い場合 warn（`scripts/check-schema-change-tests.mjs`）
- メリット: コスト最小 / 再発防止が具体的 / 文書化されレビュー基準が明確
- デメリット: 開発者のレビュー判断に一部依存

### 選択肢 C: クエリ側で IS NULL OR eq を必須化

- メリット: アプリ側で防御
- デメリット: 全クエリに拡散すると可読性が下がる / 定着しにくい。**マイグレーション側で backfill するほうが根本解決**

## 決定

### D-1. マイグレーション時の backfill を必須とする

`ALTER TABLE ADD COLUMN` を含むマイグレーション（`scripts/migrate-*.cjs` / `scripts/add-*.cjs` / 起動時の `schema-validator.ts` の自動 ADD）では、**既存行に default 値を backfill する UPDATE を同 script / 同トランザクション内で実行**すること。

```sql
-- NG（既存行が NULL のまま残る）
ALTER TABLE children ADD COLUMN is_archived INTEGER DEFAULT 0;

-- OK（既存行も backfill）
ALTER TABLE children ADD COLUMN is_archived INTEGER DEFAULT 0;
UPDATE children SET is_archived = 0 WHERE is_archived IS NULL;
```

> **補足**: SQLite の `ALTER TABLE ADD COLUMN` は **定数 DEFAULT** なら既存行にも適用されるが、`CURRENT_TIMESTAMP` 等の非定数や、後から DEFAULT だけ追加する場合は適用されない。**バックフィル UPDATE を常に書く**ほうが安全で意図も明確。

### D-2. 新カラム + クエリフィルタの組み合わせには NULL 混在テストを必須とする

新カラムを追加し、かつ `WHERE` 句 / `eq(col, val)` / `and(...)` にそのカラムが含まれるクエリが 1 つでもある場合、**「該当カラムが NULL の既存行」を INSERT してクエリ結果を検証するテスト**を同 PR 内で追加すること。

```ts
// tests/unit/... に 1 件追加する例
it('is_archived が NULL の既存行も active として返される', () => {
  sqlite.exec(`
    INSERT INTO children (tenant_id, nickname, age, is_archived)
    VALUES ('t1', 'legacy', 5, NULL)
  `);
  const result = findAllChildren('t1');
  expect(result.map((c) => c.nickname)).toContain('legacy');
});
```

### D-3. CI で schema.ts 変更 → テスト追加を機械チェックする

`scripts/check-schema-change-tests.mjs` を新設し、PR の差分に
`src/lib/server/db/schema.ts` が含まれるときに、以下のいずれかが diff に含まれることを要求する:

1. `tests/unit/db/` 以下のテストファイルの追加/変更
2. `tests/unit/services/` 以下のテストファイルの追加/変更
3. PR 本文に `[skip-schema-test-check]` マーカー（例: フォーマット変更のみ）

※ false negative を許容するラフな警告チェック。blocking にはしない（warn 止まり）
が、PR レビュー側で `[must]` 指摘の判断材料とする。

### D-4. tests/CLAUDE.md に明文化

`tests/CLAUDE.md` の「禁止事項」および「機能追加 PR のテスト要件」に以下を追記:

- スキーマ変更（カラム追加・削除・型変更）を含む PR は、**NULL 混在の既存行**に対する
  クエリテストを同 PR 内で追加すること
- マイグレーション script に `ALTER TABLE ADD COLUMN` を書く場合は、対応する
  `UPDATE SET col = default WHERE col IS NULL` を同 script 内に書くこと

### D-5. DynamoDB 並行実装の整合性

`src/lib/server/db/sqlite/*.ts` と `src/lib/server/db/dynamodb/*.ts` で同じ entity を扱う Repository ペアがある場合、新カラム追加時に **両実装で undefined / null / 既定値のハンドリングを一致させる**こと。DynamoDB は attribute 欠損と null を区別するため、sqlite 側で IS NULL ハンドリングを足したなら、DynamoDB 側で attribute_exists 相当のガードを入れる必要がないか確認する。

## 結果

### 得られるもの

- #962 と同種のインシデント（新カラム + NULL 混在行で全機能不全）を事前検知できる
- レビュー基準が明文化され、`[must]` 指摘として一貫して処理できる
- CI の warn で「スキーマ変更なのにテストが追加されていない」PR が視認可能になる

### トレードオフ

- 毎回 NULL 混在テストを書く分、テストファイル数が増える（1 件 / スキーマ変更）
- 既存の ALTER TABLE script に backfill を後付けする修正が別途必要（#963 AC 4 番目 → フォローアップ issue）

### フォローアップ

- [ ] `src/lib/server/db/schema-validator.ts` の `validateAndMigrate` で `ALTER TABLE ADD COLUMN` を実行する際、drizzle config の default 値を抽出して `DEFAULT` 節を付与 + `UPDATE ... WHERE IS NULL` を同トランザクションで実行する（別 PR、ランタイム挙動変更のためリスク高、回帰テスト同梱必須）
- [ ] 既存の `scripts/add-*.cjs` / `scripts/migrate-*.cjs` の `ALTER TABLE ADD COLUMN` 箇所に backfill UPDATE を後付け（履歴 script は基本触らない方針だが、棚卸しはする）

### 禁止事項

- `src/lib/server/db/schema.ts` にカラムを追加し、同 PR 内に NULL 混在行テストが無いのを許すこと
- マイグレーション script で `ALTER TABLE ADD COLUMN` を書いて、backfill UPDATE を伴わないこと
- 「テストは後続 PR で」として本 PR で Done にすること（ADR-0020 違反）

## 参考

- Postmortem: `docs/postmortem/2026-04-xx-is-archived-null-outage.md`（#962 の詳細）
- 原因 PR: #941（`is_archived` 導入）
- SQLite `ALTER TABLE ADD COLUMN` 仕様: <https://www.sqlite.org/lang_altertable.html#altertabaddcol>
