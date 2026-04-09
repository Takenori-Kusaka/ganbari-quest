# Architecture Decision Records (ADR)

本ディレクトリは、がんばりクエストの重要な技術決定・設計判断を記録する。

## ADR テンプレート

```markdown
# NNNN. タイトル

| 項目 | 内容 |
|------|------|
| ステータス | proposed / accepted / deprecated / superseded |
| 日付 | YYYY-MM-DD |
| 起票者 | 名前 |
| 関連 Issue | #番号 |

## コンテキスト

なぜこの決定が必要だったのか。

## 検討した選択肢

### 選択肢 A: ...
- メリット: ...
- デメリット: ...

### 選択肢 B: ...
- メリット: ...
- デメリット: ...

## 決定

何を選び、なぜ選んだか。

## 結果

この決定により何が変わるか。トレードオフは何か。
```

## 命名規則

- ファイル名: `NNNN-kebab-case-title.md`
- 番号は 0001 から連番
- ステータスが `deprecated` / `superseded` になっても削除しない

## 一覧

| # | タイトル | ステータス | 日付 |
|---|--------|----------|------|
| 0001 | [リネーム時の後方互換必須](0001-rename-backward-compat.md) | accepted | 2026-03-28 |
| 0002 | [ダイアログキュー必須](0002-dialog-queue-required.md) | accepted | 2026-03-28 |
| 0003 | [設計書は Single Source of Truth](0003-design-doc-as-source-of-truth.md) | accepted | 2026-04-06 |
| 0004 | [スタンプカード正仕様](0004-stamp-card-spec.md) | accepted | 2026-04-06 |
| 0005 | [Critical 修正の品質ゲート](0005-critical-fix-quality-gate.md) | accepted | 2026-04-06 |
| 0006 | [SvelteKit + Svelte 5 採用](0006-sveltekit-svelte5.md) | accepted | 2026-01-15 |
| 0007 | [DynamoDB シングルテーブル設計](0007-dynamodb-single-table.md) | accepted | 2026-02-20 |
| 0008 | [Cognito + Google OAuth 認証](0008-cognito-google-oauth.md) | accepted | 2026-02-25 |
| 0009 | [3層CSSトークンアーキテクチャ](0009-css-token-architecture.md) | accepted | 2026-03-15 |
| 0010 | [Repository パターンによる DB 抽象化](0010-repository-pattern.md) | accepted | 2026-02-15 |
