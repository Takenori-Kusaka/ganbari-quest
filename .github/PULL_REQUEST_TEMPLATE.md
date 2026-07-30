## 顧客価値・目的

**対象ユーザー**: <!-- 子供 / 親（管理者） / 運営 / システム全体 -->

**解決する課題**: <!-- ユーザーが抱えている問題、または実現したい体験を 1-2 文で -->

**期待される効果**: <!-- この変更により、ユーザー体験がどう改善されるか -->

## 関連 Issue

<!-- 行頭 closing keyword 必須（feat / fix）。閉じない PR は <!-- no-issue-close: 理由 --> を記載 -->
Closes #

## AC 検証マップ (ADR-0004)

<!-- Issue の AC 1 行ごとに 1 行。4 列固定。結果列は HEAD SHA + file:line + 実体根拠を必ず付ける -->

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---------|--------|---------|------------------|
| AC1 | <!-- AC 内容 --> | <!-- `npx vitest run tests/unit/foo.test.ts` --> | <!-- HEAD `abc1234` / 12 passed / tests/unit/foo.test.ts:42 --> |

## 変更タイプ

<!-- 1 つ以上 [x] を選択。PR title 接頭辞が type:* label の SSOT で、本欄はその可読補助 -->

- [ ] feat: 新機能
- [ ] fix: バグ修正
- [ ] refactor: リファクタリング
- [ ] design: デザイン・UI改善
- [ ] infra: インフラ・CI/CD
- [ ] test: テスト改善
- [ ] docs: ドキュメント
- [ ] marketing: マーケティング・LP

## 影響範囲・横展開チェック

**影響を受ける画面・機能**:
<!-- 例: 子供ホーム画面（全年齢モード）、親管理画面のレポートタブ -->

<!-- 並行実装ペアの詳細は docs/design/parallel-implementations.md。該当なしは「N/A（理由）」 -->

- [ ] **並行実装ペア**を同期した（labels SSOT / 5 年齢モード / ナビ 3 種 / E2E・unit seed / チュートリアル）
- [ ] **設計書同期** (ADR-0001): 影響する `docs/design/` を同 PR で更新（DB→08 / API→07 / UI→06 / インフラ→13 / セキュリティ→14）
- [ ] **LP ↔ アプリ整合** (ADR-0013): LP 記載が実装と一致。Aspirational を LP に新規追加していない
- [ ] **重量 e2e 敏感領域** (`parallel-implementations.md` §SSOT) に触れる場合、該当 spec のローカル実行ログを本文に貼った
- [ ] N/A — 上記いずれも影響範囲外

## テスト・品質セルフチェック

| テスト種別 | コマンド | 結果 |
|---|---|---|
| pre-ready | `npm run pre-ready -- --pr <num>` | <!-- PASS / FAIL --> |
| 追加・変更テスト | <!-- `npx vitest run tests/unit/foo.test.ts` / なしは N/A --> | <!-- PASS / N/A --> |

- [ ] **SOLID / DRY / YAGNI**: 単一責任・依存性逆転を満たす / 同一ロジックの重複を `grep` で調査済 / 不要な抽象化なし
- [ ] **Security（OSS 公開前提）**: 秘密情報・内部 URL の hardcode なし / OWASP Top 10 を境界で検証 / N/A 可
- [ ] **A11y・パフォーマンス**: キーボード操作可 / ARIA 適切 / コントラスト WCAG AA / N+1 なし / N/A 可
- [ ] **Critical バグ修正**(ADR-0002): 5 要件確認済。該当なければ N/A

## スクリーンショット / ビジュアルデモ

<!-- UI 変更時は必須。SS は CI 通過用の添付ではなく、DESIGN.md §9 禁忌 6 点を自己判定した証跡。
     URL は GitHub 上で表示可能なもの（ローカル相対パス禁止）。DOM HTML スナップショット併記必須。
     撮影方法・認証画面の注意は docs/troubleshoot/screenshot_capture.md / `scripts/capture.mjs --help` -->

| | モバイル (375px) | PC (1440px) |
|---|---|---|
| **修正前** | <!-- ![before-mobile](URL) --> | <!-- ![before-pc](URL) --> |
| **修正後** | <!-- ![after-mobile](URL) --> | <!-- ![after-pc](URL) --> |

UI 変更を含まない PR は「**該当なし（理由）**」と明記。disabled / エラー / 空状態の SS が必要なら追加。

## レビュー依頼事項・破壊的変更

**破壊的変更**:
- [ ] 含まれない
- [ ] 含まれる → 影響範囲・マイグレーション手順・既存データへの影響を以下に記載

**レビュー依頼事項**:
<!-- 特に確認してほしい観点、設計判断で迷った点。なければ空欄で OK -->

## 配布済み env / secret (ADR-0006)

<!-- 新規 env / secret 追加時のみ。CI が「配布済み: <ENV>」行を検出する -->

- [ ] N/A — 新規 env / secret の追加なし

## Ready for Review チェックリスト

<!-- CI 全緑は Status Checks 側で検証するため本リストに含めない。
     pre-ready の実行証跡も項目にしない（自己参照 deadlock を作るため、#4022） -->

- [ ] セルフレビュー済み（不要な差分・デバッグコードなし）
- [ ] 全 AC が実装済み（未実装・先送りの AC がない）
- [ ] UI 変更時: SS が GitHub 上で表示確認 + DOM HTML 併記 + DESIGN.md §9 禁忌 6 点を目視確認
- [ ] 認証画面変更時: `npm run dev:cognito` で実ブラウザ操作した SS を添付

## QM レビュー結果

<!-- QM が記入。5 手順の approve body フォーマットは docs/sessions/qa-session.md 参照 -->

[QM 5 手順 approve body は `docs/sessions/qa-session.md` を参照](../docs/sessions/qa-session.md)
