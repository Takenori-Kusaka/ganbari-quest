---
name: PR Review
description: Use when reviewing a pull request. Enforces the mandatory 9-point checklist (file existence, dependencies, AC verification, E2E, lateral spread, CSS, design docs, documentation, recent-deploy deletion guard).
---

# PR レビューチェックリスト

## 必須 9 項目（A〜I 全項目）

### A. ファイル存在・依存関係
- [ ] import 先のファイルが全て実在するか
- [ ] 新規 import の依存パッケージが package.json に存在するか
- [ ] 削除されたファイルを参照している箇所がないか

### B. Issue AC 突合
- [ ] Issue の Acceptance Criteria を 1 行ずつ検証
- [ ] 部分実装で `closes` していないか（AC 全項目必須）
- [ ] Issue で提案された対策が全て実装されているか

### C. テスト品質（ADR-0005 / ADR-0061）
- [ ] 新規コードにユニットテストが同梱されているか
- [ ] 境界値・異常系・競合のテストケースがあるか
- [ ] アサーション弱体化（toBeTruthy/toBeDefined への置換）がないか
- [ ] E2E テストが必要な場合は同梱されているか
- [ ] **failing-test-first（ADR-0061）**: バグ修正 PR は「再現テスト → 修正」順か。修正前に失敗し修正後に green になるテストで原因が pin されているか（修正だけで再現テストなしは差し戻し）
- [ ] **push-down-the-pyramid（ADR-0061 / ADR-0007）**: 重量レーン（e2e / 統合監査）で露見した不具合は、同条件を unit / lint / fitness function で捕捉できないか検討し、可能なら下位層に降ろしてあるか
- [ ] **same-class-N→guard（ADR-0061）**: 同一バグ class が 2 回以上再発している領域は、別 instance パッチでなく CI gate / lint / property test / fitness function で class 全体を lock しているか（instance パッチのみは Done にしない）

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

### I. 直近 deploy file 削除なし（#2603、rebase drift 5 連続再発教訓）
- [ ] `node scripts/check-recent-deploy-deletion.mjs --pr <N>` が exit 0
- [ ] 直近 7 日に main merge された file を本 PR が削除していない（rebase drift の典型 symptom）
- [ ] archive 移動 (ADR 1-in-1-out 等) の legitimate な delete なら `--ignore-pattern` で除外
- [ ] exit 2 検出時は **Fix Agent dispatch → `git rebase origin/main` 強制** + screenshots branch 再 push (#2063)

## 判定

- 全項目 OK → Approve
- 1 つでも NG → Request Changes + 具体的な修正指示
- Copilot の COMMENTED は承認扱いにしない
