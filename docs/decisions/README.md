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
| 0006 | [PR レビューは文書化された指摘を必ず出力する](0006-pr-review-must-document-findings.md) | accepted | 2026-04-07 |
| 0007 | [画像アセットが存在する機能を絵文字に戻すことは明示的デグレ](0007-image-asset-protection.md) | accepted | 2026-04-07 |
| 0008 | [年齢モード5重複の変更リスク管理](0008-age-mode-duplication-risk.md) | accepted | 2026-04-07 |
| 0009 | [server→client 型契約の安全性確保](0009-server-client-type-contract.md) | accepted | 2026-04-07 |
| 0010 | [Issue 起票・クローズの品質基準](0010-issue-close-quality.md) | accepted | 2026-04-10 |
| 0011 | [SvelteKit + Svelte 5 採用](0011-sveltekit-svelte5.md) | accepted | 2026-01-15 |
| 0012 | [DynamoDB シングルテーブル設計](0012-dynamodb-single-table.md) | accepted | 2026-02-20 |
| 0013 | [Cognito + Google OAuth 認証](0013-cognito-google-oauth.md) | accepted | 2026-02-25 |
| 0014 | [3層CSSトークンアーキテクチャ](0014-css-token-architecture.md) | accepted | 2026-03-15 |
| 0015 | [Repository パターンによる DB 抽象化](0015-repository-pattern.md) | accepted | 2026-02-15 |
| 0016 | [ダイアログ/オーバーレイの状態管理方針](0016-dialog-overlay-management.md) | accepted | 2026-04-10 |
| 0017 | [テスト品質の劣化を許容しない開発プロセス](0017-test-quality-ratchet.md) | accepted | 2026-04-10 |
| 0018 | [Issue起票は根本原因特定と構造的解決策を必須とする](0018-issue-quality-standard.md) | accepted | 2026-04-10 |
| 0019 | [ダイアログ管理はFSMでスクラップ＆ビルド](0019-dialog-fsm-scrap-and-rebuild.md) | accepted | 2026-04-10 |
| 0020 | [テスト品質の劣化を許容しない（強制プロセス）](0020-test-quality-ratchet-enforcement.md) | accepted | 2026-04-10 |
| 0021 | [デプロイ検証ゲート](0021-deploy-verification-gate.md) | accepted | 2026-04-11 |
