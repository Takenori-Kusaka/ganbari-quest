<!-- hotfix PR (priority:critical / hotfix label) の場合は `--kind critical-fix` template に切替え:
  npm run dev:open-pr -- --issue <num> --kind critical-fix
  → hotfix runbook 5 項目内蔵 (#2343 / docs/sessions/dev-session.md §hotfix PR runbook)
  → ADR-0002 5 要件 + refactor:internal-no-doc-impact ラベル判断 + env 配布 4 経路 + $lib/runtime/env 経由化 + pre-ready check 統合 -->

## 顧客価値・目的

<!-- 「何を変更したか」ではなく「なぜこの変更がユーザーにとって必要か」を書く -->

**対象ユーザー**: <!-- 子供 / 親（管理者） / 運営 / システム全体 -->

**解決する課題**: <!-- ユーザーが抱えている問題、または実現したい体験を 1-2 文で -->

**期待される効果**: <!-- この変更により、ユーザー体験がどう改善されるか -->

## 関連 Issue

<!-- closes #123 で自動クローズ。複数の場合は全て列挙。Issue がない場合は理由を明記 -->
closes #

## AC 検証マップ (ADR-0004)

<!-- ⚠️ 必須: Issue の Acceptance Criteria 1 行ごとに 1 行。
     ⚠️ 4 列固定 (`AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス`) — 2 列簡略形式禁止 (#1775 AC2 / #2586)
     検証手段は機械検証可能なコマンド / ファイルパス / スクリーンショット番号で書く。
     結果 / エビデンス列には HEAD SHA + file:line + grep / 実体根拠を必ず付与する。
     例外: ac-verification-skip コメントで対象外化（監査ログに記録）→ <!-- ac-verification-skip: 理由 -->
     参考 PR (4 列 SSOT 実装例): #2588 / #2599 -->

| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |
|---------|--------|---------|------------------|
| AC1 | <!-- 例: Mobile 高 ≤ 15000px --> | <!-- 例: `node scripts/measure-lp-dimensions.mjs` --> | <!-- 例: HEAD `abc1234` / mobile=11469px PASS / output L42 --> |
| AC2 | <!-- 例: AC 内容 を簡潔に --> | <!-- 例: `npx vitest run tests/unit/foo.test.ts` --> | <!-- 例: HEAD `abc1234` / 12 passed (L8-19) / tests/unit/foo.test.ts:42 --> |

## 変更タイプ

- [ ] feat: 新機能
- [ ] fix: バグ修正
- [ ] refactor: リファクタリング
- [ ] design: デザイン・UI改善
- [ ] infra: インフラ・CI/CD
- [ ] test: テスト改善
- [ ] docs: ドキュメント
- [ ] marketing: マーケティング・LP

## 影響範囲・変更コンポーネント

**変更レイヤー**:
- [ ] DB スキーマ (`$lib/server/db/`)
- [ ] サービス層 (`$lib/server/services/`)
- [ ] API エンドポイント (`src/routes/api/`)
- [ ] ページ / レイアウト (`src/routes/`)
- [ ] UI コンポーネント (`$lib/ui/`, `$lib/features/`)
- [ ] ドメインモデル (`$lib/domain/`)
- [ ] インフラ (`infra/`)
- [ ] LP サイト (`site/`)
- [ ] 設定・CI (`package.json`, `.github/`, `biome.json` 等)

**影響を受ける画面・機能**:
<!-- 例: 子供ホーム画面（全年齢モード）、親管理画面のレポートタブ -->

## テスト & 安全装置セルフチェック

<!-- biome / svelte-check / vitest / playwright の個別申告は不要 — pre-ready CLI が一括検証 + CI ci.yml が同 4 コマンドを別途実行するため二重申告は冗長。 -->

- [ ] **`npm run pre-ready -- --pr <num>` 全 Step PASS**（#1775 / ADR-0030）— biome / svelte-check / vitest / hardcoded-strings / lp-dimensions / check-pr-body をローカル一括検証
- [ ] 追加・変更したテストの概要を以下に記載（テスト追加なしなら「N/A」）:
  <!-- 例: tests/e2e/combo-bonus.spec.ts に「ダイアログ表示→閉じる→再表示なし」を追加 -->
- [ ] **新規 env / secret 追加時**（ADR-0006）: 末尾の「配布済み env / secret」セクションに証跡を記載。該当なければ「N/A」
- [ ] **DynamoDB 実装変更時**（ADR-0010 / #1021）: SQLite + DynamoDB 両実装完成 + `scripts/check-dynamodb-stub.mjs` PASS。該当なければ「N/A」
- [ ] **Critical バグ修正の場合**（ADR-0002）: 5 要件（E2E 回帰 / AC 全項目 / 提案全実装 / 5 年齢モード検証 / 直近 30 日重複変更チェック）確認済み。該当なければ「N/A」

## スクリーンショット / ビジュアルデモ

<!-- ⚠️ UI 変更がある場合は必須。SS は CI を通すための添付ではなく、起票者自身が UI/UX デザイナー視点で
     docs/DESIGN.md §9 禁忌事項 6 点（hex 直書き / プリミティブ再実装 / 内部コード露出 / 用語ハードコード /
     インラインスタイル / <style> 50 行超え）に違反していないかを自己判定した証跡。
     撮った後、自分で見返して違和感があれば Ready 前に直すこと。 -->

**添付ルール（要約）**:
- URL は GitHub 上で表示可能なもの（user-attachments / screenshots branch raw URL / `docs/screenshots/` raw URL）
- ローカル相対パス（`tmp/...` / `.tmp-screenshots/...`）禁止（#1741）
- **DOM HTML スナップショット併記必須**（#1747 / #1766）— `scripts/capture.mjs` がデフォルトで `<file>.dom.html` を同ディレクトリに生成
- 認証画面（login / signup / 管理画面 / ops / プラン別 UI）は `npm run dev:cognito` (#1026) で撮影
- 撮影方法・トラブルシュートは `docs/troubleshoot/screenshot_capture.md` を参照

**4 スロット添付**（#1740）:

| | モバイル (375px) | PC (1440px) |
|---|---|---|
| **修正前** | <!-- ![before-mobile](URL) --> | <!-- ![before-pc](URL) --> |
| **修正後** | <!-- ![after-mobile](URL) --> | <!-- ![after-pc](URL) --> |

UI 変更を含まない PR (refactor / docs / infra のみ) は本セクションに「**該当なし（理由）**」と明記。

**インタラクティブ状態**: disabled / readonly フィールドの値が見える / エラー状態 / 空状態の SS が必要なら追加（#1462 / #1481）。該当なければ「N/A」。

## コード品質セルフレビュー (#1481)

<!-- SOLID / セキュリティ / A11y / Performance を統合。該当なしは N/A で可 -->

- [ ] **SOLID**: 単一責任（S）/ 依存性逆転（D, interface 経由）/ インターフェース分離（I, 必要最小依存）
- [ ] **DRY**: 同一ロジック / 同一バグが他ファイルにないか `grep` / `Glob` で調査済み（見つかれば同 PR or 別 Issue）
- [ ] **YAGNI**: 現要件に不要な抽象化を追加していない
- [ ] **Security（OSS 公開前提）**: 秘密情報・内部 URL の hardcode なし / Security by obscurity に依存しない / OWASP Top 10 (Injection / Auth / XSS / IDOR) を境界で検証 / N/A 可
- [ ] **アクセシビリティ**: キーボード操作可 / ARIA 適切 / コントラスト WCAG AA（セマンティックトークンで自動担保） / N/A 可
- [ ] **パフォーマンス**: N+1 なし / バンドルサイズ確認 / N/A 可

## 横展開・影響波及チェック

**並行実装ペア**（`docs/design/parallel-implementations.md` 参照、該当するペアにチェック）:

- [ ] 本番アプリ (`src/routes/(child)/`, `src/routes/(parent)/`) + デモ版 (`src/routes/demo/`) を同期
- [ ] **LP ↔ アプリ双方向整合**（#1481 / ADR-0013）: LP 記載がアプリ実装と一致 / アプリの新規機能・用語が LP に未記載のままでない（Committed/Aspirational 確認）
- [ ] 全年齢モード 5 種（baby/preschool/elementary/junior/senior）に横展開
- [ ] ナビゲーション 3 種（`AdminLayout` + `AdminMobileNav` + `BottomNav`）に反映
- [ ] E2E / ユニットシード（`tests/e2e/global-setup.ts` / `tests/unit/helpers/test-db.ts` / `src/lib/server/demo/demo-data.ts`）と チュートリアル (`tutorial-chapters.ts` / `demo-guide-state.svelte.ts`) を同期
- [ ] **labels SSOT** (ADR-0009): 新規ユーザー向け文言は `src/lib/domain/labels.ts` 経由 / LP 側は `data-label` 属性経由 / リテラル直書きなし
- [ ] **設計書同期** (ADR-0001): 影響を受ける `docs/design/` の設計書を同 PR で更新（DB→08 / API→07 / UI→06 / インフラ→13 / セキュリティ→14）
- [ ] **並行 PR overlap** (#1200): 本 PR が変更するファイルを同時期に変更する open PR が他に無い、または合意済み
- [ ] N/A — 並行実装の影響範囲外

**LP / 販促文言変更時** (ADR-0013 / #1314):

<!-- LP (`site/**`) / pricing page / `plan-features.ts` / `pricing-strategy.md` / `docs/design/19-*.md` の
     文言を変更・追加した場合のみ記入。Aspirational 機能の LP 新規追加は禁止。 -->

| 変更した文言 | 実装コードパス | Committed/Aspirational |
|------------|---------------|----------------------|
| <!-- 例: 「毎日のおみくじシール」 --> | <!-- 例: `src/lib/server/services/stamp-card-service.ts::stampToday` --> | <!-- Committed --> |

該当なしの場合は「N/A」と明記。

## レビュー依頼事項・破壊的変更

**破壊的変更**:
- [ ] このPRに破壊的変更は**含まれない**
- [ ] 含まれる → 影響範囲・マイグレーション手順・既存データへの影響を以下に記載

<!-- 含まれる場合:
**影響範囲**:
**マイグレーション手順**:
**既存データへの影響**:
-->

**レビュー依頼事項・QA**:
<!-- レビュアーに特に確認してほしい観点や、設計判断で迷った点があれば記載。なければ空欄で OK -->

## 配布済み env / secret (ADR-0006)

<!-- 新規 env / secret を追加した場合のみ記入。CI の new-env-distribution-check が
     「配布済み: <ENV>」行を検出する。該当なければ「N/A」 -->

- [ ] N/A — 新規 env / secret の追加なし

<!-- 例:
- 配布済み: AWS_LICENSE_SECRET → GitHub Actions Secrets (deploy.yml, deploy-nuc.yml)
- 配布済み: AWS_LICENSE_SECRET → SSM Parameter Store /ganbari-quest/prod/aws_license_secret
- 配布済み: AWS_LICENSE_SECRET → NUC .env (本機 + バックアップ機)
-->

## Ready for Review チェックリスト

<!-- Draft → Ready 前に確認。CI 全緑は GitHub Status Checks 側で別途検証されるため本リストには含めない（#1775 自己言及循環の解消） -->

- [ ] **`npm run pre-ready -- --pr <num>` 全 Step PASS** をローカル確認した
- [ ] セルフレビュー済み（不要な差分・デバッグコードなし）
- [ ] 全 AC が実装済み（TODO / 「予定」のまま残っている AC がない）
- [ ] Phase 分割した場合: 着手前に PO と合意し、子 Issue を起票済み
- [ ] UI 変更時: SS が GitHub 上で表示確認 + DOM HTML 併記（#1741 / #1747）+ DESIGN.md §9 禁忌 6 点を目視確認
- [ ] 認証画面変更時: `npm run dev:cognito` (#1026) で実ブラウザ操作した SS を添付

## QM レビュー結果

<!-- QM が記入。フォーマット・必須手順は docs/sessions/qa-session.md「Tier 2 手順 5」を参照。
     CI 緑 = approve ではない。Issue AC 照合と SS 目視が必須（ADR-0022）。 -->

[QM 5 手順 approve body は `docs/sessions/qa-session.md` を参照](../docs/sessions/qa-session.md)
