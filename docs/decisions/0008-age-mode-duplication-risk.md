# ADR-0008: 年齢モード5重複の変更リスク管理

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-09 |
| 関連 Issue | #567, #607, #622 |

## コンテキスト

5つの年齢モード（baby/preschool/elementary/junior/senior）のホームページは、ほぼ同一の `+page.server.ts` と `+page.svelte` を持っている。

#607 の修正で、以下の変更を **10ファイル（5 server + 5 svelte）** に同一適用した:
- `rarityPoints` → `stampPoints` のリネーム
- `omikujiRank` フィールドの追加（型定義 + 代入）
- `cardTotalSlots ?? 7` → `?? 5` のフォールバック値変更
- `stampOmikujiRank` の型定義・代入追加

1ファイルでも変更漏れがあると、**特定の年齢モードだけ壊れる**。テストが全年齢モードをカバーしていない場合、検知が遅れる。

## 決定

#567（`[uiMode]` パラメータルート統合）が完了するまで、以下のルールを適用する:

1. **全年齢モード共通の機能**（スタンプカード、ログインボーナス、活動記録、ポイント表示等）を変更する場合、PR の変更ファイルリストに **5つ全ての年齢モード** が含まれていることを確認する
2. 1ファイルの変更を行った後、`grep -r` で**変更前の文字列が他ファイルに残っていないか**を検証する
3. E2E テストは少なくとも2つ以上の年齢モードで実行する（baby + elementary 推奨）
4. #567 の統合完了後、本 ADR は `superseded` に変更する

### 影響を受けるファイル

```
src/routes/(child)/baby/home/+page.server.ts
src/routes/(child)/baby/home/+page.svelte
src/routes/(child)/preschool/home/+page.server.ts
src/routes/(child)/preschool/home/+page.svelte
src/routes/(child)/elementary/home/+page.server.ts
src/routes/(child)/elementary/home/+page.svelte
src/routes/(child)/junior/home/+page.server.ts
src/routes/(child)/junior/home/+page.svelte
src/routes/(child)/senior/home/+page.server.ts
src/routes/(child)/senior/home/+page.svelte
```

## 結果

- 年齢モード間の不整合を早期に検知できる
- レビュアーが「5ファイル変更されているか」を明確にチェックできる
- 根本解決（#567 統合）までのリスクを管理できる

## 教訓

- **DRY 違反はコードの問題だけでなく、変更管理の問題** — 同一コードの5重複は、変更コストを5倍にし、変更漏れリスクを指数的に増大させる
- **「後で統合する」は今のリスクを消さない** — 統合が完了するまでの間もリスク管理が必要
