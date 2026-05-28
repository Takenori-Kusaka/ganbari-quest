# 購入セキュリティ 要件定義 (#2540 / Epic #2525 Phase 1)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2540 (購入セキュリティの要件) |
| 親 | #2526 (Phase 1) / 上位 #2525 |
| ステータス | Phase 1 完了 (deep-research: Stripe webhook security + OWASP 一次確認 → 推奨で確定、PO 確定 2026-05-27) |

## 真の新規スコープ (他孫で既出の要件は参照のみ)

#2540 固有の新規スコープは **FR-2 (webhook tenant 再検証) / FR-6・FR-7 (認可境界・プラン改ざん防止) / FR-8・NFR-1 (PII/PCI 最小化)** の 4 点。webhook 署名検証・冪等性・tenantId サーバ側取得は有料化/dunning 孫で既出 → 参照統合 (重複起票しない)。

## 機能要件 (FR)

| ID | 要件 | 設計意図 + 根拠 |
|----|------|----------------|
| FR-1 | Checkout 開始時、tenantId は `locals.context` (サーバ側) からのみ取得し client_reference_id に埋める。client 提供 tenantId を信頼しない | 他テナント流用・誤紐づけ (IDOR) 防止。OWASP「client 識別子を信頼しない」(既出参照) |
| FR-2 | **webhook 受信時、client_reference_id と既存 family-tenant の対応をサーバ側で再検証**してから権限付与。対応取れない event は付与せず記録 | account-first でのなりすまし最終防壁。OWASP 毎リクエスト object-level 認可 (**新規**) |
| FR-3 | webhook は HTTPS + constructEvent 署名検証通過 event のみ処理、失敗は 4xx | なりすまし webhook 注入遮断。Stripe mandatory (既出参照) |
| FR-4 | event.id で冪等性管理、replay/重複を 1 回反映。署名 timestamp 5 分 tolerance デフォルト維持 (0 禁止) + NTP 同期 | replay 防止は署名 timestamp に**内包** (追加機構不要)。Stripe (既出参照) |
| FR-5 | 無料トライアル可否は自社 hasUsedTrial (family-tenant 単位) で Checkout 前にサーバ側 gate | トライアル繰り返し悪用防止 (既出参照、Radar 不要) |
| FR-6 | 課金操作 (Checkout/portal/解約) は **owner/parent のみ**。子供ロールは課金画面ルートを deny by default で遮断 | 認可境界・子供の不正課金防止。OWASP least privilege (**新規**) |
| FR-7 | プラン状態は **webhook 由来の自社 DB を SSOT**、client から渡る plan 値で権限判定しない | プラン改ざん防止 (capability gate 整合)。OWASP「client claim 信頼しない」(**新規**) |
| FR-8 | Stripe へ送る metadata/description に **PII (氏名・メール・子供データ) と cancellation_reason 自由記述を入れない**。参照 ID のみ | PII 拡散防止。Stripe metadata docs (PII 保存禁止) (**新規**) |

## 非機能要件 (NFR)

- NFR-1: **カード情報は自社で一切保持しない** (Stripe トークン/Checkout 経由)、PCI スコープ最小化 (**新規**)
- NFR-2: 退会時に Stripe Customer も削除し PII を残さない (既出参照、PIPC)
- NFR-3: webhook endpoint は HTTPS 必須 (TLS)
- NFR-4: 認可検証はサーバ側 (hooks.server.ts/service 層) で毎リクエスト、client-side gate は UX のみで権限根拠にしない

## ユーザーストーリー

1. 保護者として、自分の購入が確実に自分の家族テナントだけに反映され、他家庭に誤紐づかない
2. 子供として、課金画面に到達できず勝手に契約/解約できない
3. 保護者として、解約理由など自由記述が Stripe 等外部に PII として残らない
4. 運営として、偽 webhook や同一 event 再送で不正にプラン付与されない

## Pre-PMF で「やらない」過剰防衛 (ADR-0010)

| やらない | 理由 |
|---|---|
| IP allowlist | Stripe 自身が「recommended (defense-in-depth)」で mandatory でないと明言。署名検証+冪等で最低ライン充足。IP レンジ変動の運用コスト過剰 |
| Stripe Radar | トライアル悪用は hasUsedTrial で足りる |
| WAF | 国内家庭向け小規模で過剰、署名+HTTPS+認可境界で代替 |
| 汎用監査ログ基盤 (S3+Athena) | ADR-0010 で過剰防衛指定済 |
| subscription 共有検知の高度機構 | account-first + family-tenant 課金で構造的に共有メリット小 |

## Open question (推奨で確定)

| # | 論点 | 推奨/状態 |
|---|------|----------|
| 1 | webhook tenant 再検証で対応取れない event の挙動 | **(a) 付与せずアラート** (Pre-PMF、自動 refund 連携はしない)、推奨で確定 |
| 2 | subscription 共有を明示 enforce するか | Pre-PMF 不要 (account-first + family-tenant で構造的防止)、推奨で確定 |
| 3 | cancellation_reason 自由記述の自社保持期間 | #2538 で 90日確定済 |
| 4 | IP allowlist 将来再評価トリガ | PMF 後・不正 webhook 観測時に ADR で再評価、推奨で確定 |

## 既存実装の現状と変更点 (delta、2026-05-28 補強)

| # | 既存実装 (file:line) | 本要件 | 扱い |
|---|---|---|---|
| 1 | tenantId サーバ側取得 (`src/routes/api/stripe/checkout/+server.ts`:29) / owner-parent 認可 (`src/routes/api/stripe/checkout/+server.ts`:24-26) / 署名検証 (`src/routes/api/stripe/webhook/+server.ts`:24-32) / metadata に PII なし | 維持 | ✅ 実装済み |
| 2 | webhook tenant 再検証なし (metadata tenantId をそのまま信頼 `src/lib/server/services/stripe-service.ts`:246、handleCheckoutCompleted=L245 の内側) | サーバ側で tenant 対応を再検証してから権限付与 | **新規構築** (FR-2) |
| 3 | webhook 冪等性 (event.id dedup) なし | event.id 冪等性 | **新規構築** (NFR-1、DB table。dunning と共用) |
| 4 | plan を client metadata planId で信頼 (`src/lib/server/services/stripe-service.ts`:257、handleCheckoutCompleted=L245 の内側) | webhook 由来の自社 DB を SSOT | **変更** (FR-7) |

**影響範囲**: webhook 冪等性 DB は dunning (#2537) と共用。実装は Phase 6/7。既存の認可境界・署名検証・PII 非保存は維持。関数位置は 2026-05-28 検証済 (handleCheckoutCompleted=L245)。

## 根拠 (primary source)

- Stripe webhooks (署名検証/replay/冪等) / security guide (HTTPS mandatory・IP allowlist recommended) / metadata (PII 保存禁止) / カード情報保管ガイド (PCI 最小化)
- OWASP Authorization Cheat Sheet (deny by default / least privilege / 毎リクエストサーバ側検証 / client 識別子不信頼 / IDOR 防止)
- ADR-0010 (過剰防衛しない) / ADR-0012 / PIPC
