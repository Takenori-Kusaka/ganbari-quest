---
name: PR Review
description: Use when reviewing a pull request. Enforces the mandatory 8-point checklist (file existence, dependencies, AC verification, E2E, lateral spread, CSS, design docs, documentation).
---

# PR レビューチェックリスト

## 必須 8 項目（A〜H 全項目）

### A. ファイル存在・依存関係
- [ ] import 先のファイルが全て実在するか
- [ ] 新規 import の依存パッケージが package.json に存在するか
- [ ] 削除されたファイルを参照している箇所がないか

### B. Issue AC 突合
- [ ] Issue の Acceptance Criteria を 1 行ずつ検証
- [ ] 部分実装で `closes` していないか（AC 全項目必須）
- [ ] Issue で提案された対策が全て実装されているか

### C. テスト品質（ADR-0005）
- [ ] 新規コードにユニットテストが同梱されているか
- [ ] 境界値・異常系・競合のテストケースがあるか
- [ ] アサーション弱体化（toBeTruthy/toBeDefined への置換）がないか
- [ ] E2E テストが必要な場合は同梱されているか

### D. 横展開（parallel-implementations.md）
- [ ] labels.ts の変更 → site/ + tutorial-chapters.ts も同期
- [ ] 本番画面の変更 → デモ画面も同等変更
- [ ] ナビゲーション変更 → Desktop + Mobile + BottomNav
- [ ] DB スキーマ変更 → global-setup.ts + test-db.ts + demo-data.ts

### E. CSS/デザイン（docs/DESIGN.md §9）
- [ ] hex 直書き禁止（routes/features 内）
- [ ] プリミティブ再実装禁止
- [ ] 内部コード UI 露出禁止
- [ ] 用語ハードコード禁止（labels.ts 経由）
- [ ] インラインスタイル禁止（動的値以外）

### F. 設計書同期
- [ ] docs/CLAUDE.md の更新ルール表に該当する変更がある場合、設計書が更新済み
- [ ] 設計書更新なき PR はマージ不可

### G. セキュリティ
- [ ] ユーザー入力の検証（XSS、SQLi）
- [ ] 認証・認可チェック
- [ ] 機密情報のログ出力禁止

### H. 文書化
- [ ] レビュー指摘を全て文書化（ADR-0006: 指摘ゼロでマージは禁止）
- [ ] 発見事項は PR コメントまたは Issue で記録

## 判定

- 全項目 OK → Approve
- 1 つでも NG → Request Changes + 具体的な修正指示
- Copilot の COMMENTED は承認扱いにしない
