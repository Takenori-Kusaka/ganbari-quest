---
title: "README"
status: active
importance: medium
owner: "Team"
last_updated: "2026-05-18"
---

# がんばりクエスト ドキュメントアーキテクチャ

このディレクトリは「がんばりクエスト」の各種ドキュメントを管理するためのルートです。
情報の目的とライフサイクルに応じて、以下のディレクトリに分類されています。

## ディレクトリ構成

- **/docs/product/**: プロダクト要件・戦略
  - ペルソナ、事業計画、企画書など「なぜ作るのか」「誰に届けるのか」を定義します。
- **/docs/architecture/**: システム全体・決定事項
  - アーキテクチャ設計書、ADR (`decisions/`) など、システム全体の構成や技術的決定事項を管理します。
- **/docs/engineering/**: 技術仕様・設計
  - API設計、UI設計、DB設計、セキュリティ設計など、「どのように作るか」の具体的な技術仕様を管理します（実装のSSOT）。
- **/docs/operations/**: 運用・手順
  - デプロイ手順、トラブルシューティング、Runbookなど、システム運用に必要な手順書を管理します。
- **/docs/archive/**: 履歴・廃止
  - 過去のセッションログ、調査履歴、廃止された仕様書など、現在は参照用途のみでアクティブに保守されないドキュメントを保管します。

## ドキュメント管理のルール

1. **SSOT (Single Source of Truth) の原則**
   - 仕様やルールは重複して書かず、各分野の担当ドキュメント（例: 用語なら `terms.ts` や関連規約）を正とします。
   - `docs/engineering/` などの設計書は、実装変更時に必ず同期して更新してください（ADR-0001）。

2. **メタデータ (Frontmatter) の付与**
   - すべての Markdown ファイルには、先頭に YAML Frontmatter を記述し、状態 (`status`) や重要度 (`importance`) を明示します。
   - 例:
     ```yaml
     ---
     title: "API設計書"
     status: active
     importance: high
     owner: "リードエンジニア"
     last_updated: "2026-05-18"
     ---
     ```

3. **ドキュメントのライフサイクル**
   - 古くなったドキュメントは削除するのではなく、Frontmatter を `status: deprecated` に変更するか、`docs/archive/` に移動して履歴を残してください。
