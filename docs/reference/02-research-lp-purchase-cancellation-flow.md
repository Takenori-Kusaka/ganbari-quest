# Research 02: LP 直接購入 + 解約導線整備 — 業界 prior art 比較 + 4 軸採用根拠

> **methodology**: `docs/reference/deep-research-request-methodology.md` §4.2 「中規模 (Issue Tree + Rust RFC Alternatives + Prior art 抜粋)」
>
> **対象 EPIC**: #2098 (LP 直接購入 + 解約導線整備 EPIC、D 集約 + D-additional + F-1 + F-2 + F-3 統括)
>
> **対象子 Issue**: #2100 / #2101 / #2102 / #2103 / #2104 / #2190
>
> **調査者**: PO 補佐 (Claude Code)
>
> **日付**: 2026-05-14 (commit 化: 2026-05-18、EPIC AC1)
>
> **本 research の SSOT 化**: 本ドキュメントは `tmp/research/02-research-lp-purchase-cancellation-flow.md` を `docs/reference/` 配下に正本化した EPIC #2098 AC1 の成果物。子 Issue 6 件の意思決定根拠はすべて本書に集約され、PR #2222 (F-1/F-2/F-3 実装) / PR #2228 (D 集約 + D-additional + #2190 統合) で実装が完了している。

---

## 1. 調査目的

PO 報告 (2026-05-14):

> 「pricing.html からスタンダード / ファミリーを直接購入するボタンがない、解約も同じステップで簡単にできる必要がある」

の構造的根本解消を目的に、(D) 既存設計書のドキュメンテーション整合 + (F) LP UX 改修 + (D-additional) Stripe Dashboard ランブック整備の 6 Issue 統括 EPIC #2098 を起票するための事前調査。

軸:

- **軸 A**: Tower 型二段 CTA (無料体験 + 直接購入) を採用すべきか、δ proration 方式 (Subscription Upgrade API) も検討すべきか
- **軸 B**: 解約導線を Stripe Customer Portal 直行にすべきか、内製解約 UI も並行すべきか
- **軸 C**: 既存「CC 登録不要」訴求 5 箇所を残すか撤廃するか、新 CTA との整合方法
- **軸 D**: Stripe Dashboard 立ち上げ手順 (Phase 1 α フル新規 / Phase 2 β 差額キー / Phase 3 δ proration) の採用順序

---

## 2. 軸 A: 直接購入動線の業界比較 (5 件)

### 2.1 候補 A-1: Tower (Git クライアント、買い切り → サブスク移行)

| 項目 | 内容 |
|---|---|
| 概要 | LP `https://www.git-tower.com/buy` から Standard / Premium プランを直接購入 + ライセンスキーメール送付 + アプリでキー入力認証 |
| 採用 | キー方式 + α fresh start (古いキー → 新規キー、proration なし) |
| メリット | 1:1 紐付け 透明性、PMF 前段の Pre-PMF stage 適合、Stripe Webhook → SES → キー発行の最小実装 |
| デメリット | 月額/年額切替時のスムーズ感は劣る (新規発行のため一度解約 → 再購入) |
| 関連 | PO 提示 8 項目 #4 (家族グループ 1:1 紐付け) と完全整合 |

### 2.2 候補 A-2: Sketch (デザインツール、買い切り + 1 年更新)

| 項目 | 内容 |
|---|---|
| 概要 | LP から直接購入 + ライセンスキーメール送付 + Mac アプリで認証、1 年で更新時に新規キー |
| 採用 | キー方式 + α fresh start |
| メリット | 「Mac の DRM の枠を超えて家族で共有可能」訴求が本プロジェクト「家族グループ 1:1 紐付け」と類似 |
| デメリット | 更新時の自動再購入なし、本プロジェクトのサブスク自動更新と異なる |

### 2.3 候補 A-3: JetBrains (IDE、Personal/Educational ライセンス)

| 項目 | 内容 |
|---|---|
| 概要 | LP `https://www.jetbrains.com/idea/buy/` から Personal / Organization 購入、ライセンスキーで認証 |
| 採用 | キー方式 + α fresh start (Toolbox subscription はキー方式と異なるが、Personal は本プロジェクトと類似) |
| メリット | 直接購入 → メール → キー入力の動線が業界 prior art として確立済み |
| デメリット | 教育機関向け無料ライセンスの存在が本プロジェクトと無関係 |

### 2.4 候補 A-4: Linear (タスク管理 SaaS、Account-based)

| 項目 | 内容 |
|---|---|
| 概要 | LP `https://linear.app/pricing` から Sign Up → Stripe Checkout → アカウント直結 (キー方式なし) |
| 採用 | account 直結 + δ proration (Stripe Subscription Upgrade API 利用) |
| メリット | プラン変更時の体験が最もスムーズ |
| デメリット | キー方式と矛盾、本プロジェクトの「家族グループ 1:1 紐付け」と非整合 |
| 関連 | PO 提示 8 項目 #4 と非互換 |

### 2.5 候補 A-5: Notion (ノート SaaS、Workspace-based)

| 項目 | 内容 |
|---|---|
| 概要 | LP `https://www.notion.so/pricing` から Sign Up → Workspace 設定 → Stripe Checkout → アカウント直結 |
| 採用 | account 直結 + δ proration |
| メリット | Workspace 単位の運用が「家族グループ」と一見類似 |
| デメリット | キー方式と矛盾、サブスク変更時の proration が複雑 |

### 2.6 軸 A 結論

**首位推奨**: A-1 Tower / A-2 Sketch / A-3 JetBrains の「キー方式 + α fresh start」が本プロジェクトの PO 提示 8 項目 #4 (家族グループ 1:1 紐付け) と完全整合。

**棄却**: A-4 Linear / A-5 Notion の「account 直結 + δ proration」は Stripe Subscription Upgrade API (`prorate: true`) を使う必要があり、キー方式と相互排他。

**Pre-PMF 適合**: Phase 1 α フル新規 (Tower 型) を採用、Phase 2 β 差額キー (Sketch 型) / Phase 3 δ proration (Linear/Notion 型) は PMF 確認後の再評価対象 (ADR-0010 Bucket B)。

---

## 3. 軸 B: 解約導線の業界比較 (4 件)

### 3.1 候補 B-1: Stripe Customer Portal (Stripe 公式 hosted)

| 項目 | 内容 |
|---|---|
| 概要 | Stripe が hosting する標準解約 UI、`stripe.billingPortal.sessions.create()` で 1 click 遷移 |
| 採用 | デフォルト推奨、`/admin/billing` の「請求管理ページを開く」ボタンが該当 |
| メリット | FTC Click-to-Cancel Rule (2025-07-14 施行) / 改正消費者契約法 (2023) / 改正特商法 (2022) に整合 |
| デメリット | UI カスタマイズ自由度低い (Stripe 標準のみ) |
| 関連 | 本プロジェクト既存実装あり (`src/routes/api/stripe/portal/+server.ts`) |

### 3.2 候補 B-2: 内製解約 UI (引き止め画面 + 退会アンケート)

| 項目 | 内容 |
|---|---|
| 概要 | Spotify / Netflix 型: 解約ボタン → 引き止め画面 → 退会アンケート → discount オファー → 解約 |
| 採用 | 業界一般、但し dark pattern リスク高い |
| メリット | リテンション改善効果あり |
| デメリット | FTC Click-to-Cancel Rule で違反リスク (「同程度の容易さでの解約」要件)、Pre-PMF stage では dark pattern を導入する正当性なし |
| 関連 | 本プロジェクト ADR-0012 (Anti-engagement) と矛盾 |

### 3.3 候補 B-3: γ ハイブリッド (FAQ 経路明示 + アプリ内 1-click → Stripe Portal)

| 項目 | 内容 |
|---|---|
| 概要 | LP の FAQ に解約経路を明示 + アプリ内 `/admin/billing` から 1-click で Stripe Customer Portal に遷移 |
| 採用 | **PO 提示 8 項目 #5 整合、PR #2222 で実装済** |
| メリット | LP-アプリの 2 段階だが透明性高い、ペルソナ (IT リテラシー低い親) が迷わない |
| デメリット | 2 段階のため 1 click 純粋な業界 prior art (Stripe Portal 直行) より 1 ステップ多い |

### 3.4 候補 B-4: LP 上で直接 Stripe Portal 起動 (B-1 LP 直結)

| 項目 | 内容 |
|---|---|
| 概要 | LP `pricing.html` の解約 CTA から `/api/stripe/portal` を直接呼出、認証は redirect で auth/login へ |
| 採用 | 1 click 化 (B-1 と B-3 の中間) |
| メリット | LP 上で最短経路 |
| デメリット | LP-API 直結のため CSRF / 認証経路が複雑、Pre-PMF 過剰実装 |

### 3.5 軸 B 結論

**首位推奨**: B-3 γ ハイブリッド (FAQ 経路明示 + アプリ内 1-click → Stripe Portal)。

**棄却**: B-2 内製解約 UI (dark pattern リスク + ADR-0012 矛盾) / B-4 LP 直結 (Pre-PMF 過剰)。

**PR #2222 実装結果**: F-2 (#2103) で `faqCancelPathNote` + `existingCustomerCancelLink` + `/admin/billing` 経由 1-click を実装、AC1-AC9 全 PASS。

---

## 4. 軸 C: 「CC 登録不要」訴求の整合方法 (3 案)

### 4.1 既存「CC 登録不要」訴求 5 箇所

| 場所 | 文言 | 整合方針 |
|---|---|---|
| `pricing.html` hero subtext | 「クレジットカード登録不要 でまずは無料体験」 | **維持** (無料体験文脈) |
| `pricing.html` 無料プラン カード | 「クレジットカードの登録は不要です」 | **維持** (無料プラン文脈) |
| `pricing.html` trialStep1Desc | 「クレジットカードの事前登録は不要です」 | **維持** (トライアル文脈) |
| `pricing.html` faqAfterTrialA | 「クレカ登録不要のまま体験できます」 | **維持** (FAQ 文脈) |
| `index.html` cta-trust-credit-card SVG | 「クレジットカード登録不要」 | **維持** (信頼バッジ文脈) |

### 4.2 候補 C-α: 全 5 箇所「CC 登録不要」訴求を撤廃

| 項目 | 内容 |
|---|---|
| メリット | 新 CTA「今すぐ購入 (CC 必要)」と矛盾しない |
| デメリット | ペルソナ (IT リテラシー低い親) の信頼形成に寄与している既存訴求を毀損、無料体験 CVR 低下リスク |
| 採用判定 | **棄却** |

### 4.3 候補 C-β: 「CC 登録不要」を残しつつ全プラン直接購入を諦める (β)

| 項目 | 内容 |
|---|---|
| メリット | 既存訴求と矛盾しない |
| デメリット | PO 提示「直接購入導線が欲しい」を満たさない |
| 採用判定 | **棄却** |

### 4.4 候補 C-γ: 既存「CC 登録不要」維持 + 新 CTA に「決済情報の入力が必要」注記

| 項目 | 内容 |
|---|---|
| メリット | 無料体験 (CC 不要) と 直接購入 (CC 必要) を ペルソナ目線で明確に区別、信頼形成と CVR 両立 |
| デメリット | LP の文言情報量が増える (但し pricing.html 縦長は許容範囲) |
| 採用判定 | **採用、PR #2222 F-3 (#2104) で実装済 (AC1-AC6 全 PASS)** |

---

## 5. 軸 D: Stripe Dashboard 立ち上げ手順 (6 項目)

### 5.1 D-1: Stripe Test Mode で Product / Price 作成

| 項目 | 内容 |
|---|---|
| 概要 | Standard / Family プラン × 月額 / 年額 = 4 Product 作成、Test mode で Price ID 確定 |
| 工数 | 約 15-20 分 |
| 関連 | `docs/operations/stripe-dashboard-runbook.md` Phase 1 ステップ 1-2 |

### 5.2 D-2: Webhook endpoint 設定 + signing secret 配布

| 項目 | 内容 |
|---|---|
| 概要 | `/api/stripe/webhook` を Stripe Webhook endpoint に登録、`STRIPE_WEBHOOK_SECRET` を 3 箇所 (SSM / NUC `.env` / GitHub Actions Secrets) に配布 |
| 工数 | 約 10-15 分 |
| 関連 | ADR-0006 (配布証跡)、`docs/operations/stripe-dashboard-runbook.md` Phase 1 ステップ 3 |

### 5.3 D-3: Stripe Customer Portal 設定

| 項目 | 内容 |
|---|---|
| 概要 | Portal で許可する操作 (解約、支払い方法変更、請求書 DL) を設定 |
| 工数 | 約 5-10 分 |
| 関連 | `docs/operations/stripe-dashboard-runbook.md` Phase 1 ステップ 4 |

### 5.4 D-4: Production mode への切替準備

| 項目 | 内容 |
|---|---|
| 概要 | Test mode で動作確認後、本番 API key / Webhook secret に切替 |
| 工数 | 約 10-15 分 (確認含む) |
| 関連 | `docs/operations/stripe-dashboard-runbook.md` Phase 2 |

### 5.5 D-5: 月次運用 SOP

| 項目 | 内容 |
|---|---|
| 概要 | Stripe Dashboard 月次確認項目 (失敗 payment / dispute / 異常パターン) を SOP 化 |
| 工数 | 月 約 30 分 |
| 関連 | `docs/operations/stripe-dashboard-runbook.md` Phase 3 |

### 5.6 D-6: Phase 採用順序 (4 候補)

| 候補 | 概要 | 採用判定 |
|---|---|---|
| α: Phase 1 のみ (フル新規購入、Tower 型) | キー方式 + α fresh start、最小実装 | **採用 (Phase 1 立ち上げ、PR #2228 で SSOT 化)** |
| β: α + Phase 2 (差額キー、Sketch 型) | +280 円アップグレード Product 追加 | 不採用 (Pre-PMF 過剰、PMF 確認後再評価) |
| γ: α + Phase 2 + Phase 3 (δ proration、Linear/Notion 型) | Stripe Subscription Upgrade API 利用 | 不採用 (キー方式と矛盾) |
| δ: 全 Phase 同時 | リスク高 | 不採用 (段階リリース原則違反) |

### 5.7 軸 D 結論

**首位推奨**: D-6 α (Phase 1 のみ採用)、Phase 2/3 は PMF 確認後の再評価対象 (ADR-0010 Bucket B 整合)。

---

## 6. 統合採用結論 (PR #2222 / PR #2228 で実装済)

| 軸 | 採用候補 | 実装 PR | 状態 |
|---|---|---|---|
| A 直接購入 | Tower 型二段 CTA (キー方式 + α fresh start) | PR #2222 F-1 (#2102) | merged 2026-05-18 |
| B 解約 | γ ハイブリッド (FAQ 経路明示 + アプリ内 1-click → Stripe Portal) | PR #2222 F-2 (#2103) | merged 2026-05-18 |
| C CC 訴求整合 | γ 既存維持 + 新 CTA 注記 | PR #2222 F-3 (#2104) | merged 2026-05-18 |
| D Stripe Dashboard | α Phase 1 のみ | PR #2228 D-additional (#2101) | merged 2026-05-18 |
| D 集約 | license-key-requirements / plan-change-flow / terms.html SSOT 化 | PR #2228 D 集約 (#2100) | merged 2026-05-18 |
| 関連: terms.html 解約 vs アカウント削除明示 | 第 7 条 + 第 13 条で明示 (EPIC #2098 AC6) | PR #2228 (#2100 AC4) | merged 2026-05-18 |

---

## 7. ADR / Pre-PMF 整合確認

### 7.1 ADR-0010 (Pre-PMF Bucket)

| 項目 | バケット | 根拠 |
|---|---|---|
| 直接購入動線 | Bucket A (サインアップ離脱直結) | PMF 前段で CVR 阻害を解消、20 名/月達成補助 |
| 解約導線 | Bucket A (信頼形成直結) | FTC Click-to-Cancel Rule + 改正消費者契約法 / 改正特商法 整合、ペルソナ信頼形成 |
| Stripe Dashboard ランブック | Bucket A (運用立ち上げ直結) | PO が 1-2 時間で立ち上げ可能 |
| 差額キー方式 (Phase 2 β) | Bucket B | PMF 確認後の再評価 |
| δ proration (Phase 3) | Bucket C (棄却) | キー方式と矛盾 |

### 7.2 ADR-0012 (Anti-engagement)

- B-2 (内製解約 UI + 引き止め画面 + 退会アンケート + discount オファー) は dark pattern リスクで棄却
- 解約は γ ハイブリッド 1-click 経路を採用、滞留時間を増やさない

### 7.3 ADR-0013 (LP truth)

- F-1 「今すぐ購入」CTA: 既存 Stripe Checkout / Webhook / Customer Portal 実装あり → **Committed**
- F-2 「請求管理ページを開く」: 既存 `/admin/billing` `billing-open-portal` ボタンあり → **Committed**
- F-3 「決済情報の入力が必要」注記: Stripe Checkout 既存実装 + SES (#815) 実装あり → **Committed**

### 7.4 ADR-0014 (OSS 先調査)

- Tower / Sketch / JetBrains / Linear / Notion の 5 件業界 prior art を確認済 (軸 A § 2)
- Stripe Customer Portal を採用 (B-1) — Stripe 公式 hosted UI、FTC Click-to-Cancel Rule 整合

---

## 8. 関連 Issue / PR / 実装エビデンス

### 8.1 関連 Issue (closed)

| Issue | 状態 | PR |
|---|---|---|
| #2098 (EPIC) | open (本書 AC1 で commit、AC6 を PR #2228 で達成) | — |
| #2100 (D 集約) | closed (PR #2228) | PR #2228 |
| #2101 (D-additional Stripe Dashboard runbook) | closed (PR #2228) | PR #2228 |
| #2102 (F-1 直接購入 CTA) | closed (PR #2222) | PR #2222 |
| #2103 (F-2 解約 CTA) | closed (PR #2222) | PR #2222 |
| #2104 (F-3 CC 訴求整合) | closed (PR #2222) | PR #2222 |

### 8.2 関連 ADR

- ADR-0010 (Pre-PMF Bucket)
- ADR-0012 (Anti-engagement)
- ADR-0013 (LP truth)
- ADR-0014 (OSS 先調査)
- ADR-0006 (配布証跡)
- ADR-0025 archive (License × Stripe 因果関係)
- ADR-0026 archive (ライセンスキーアーキテクチャ)

### 8.3 関連設計書

- `docs/design/license-key-requirements.md` (D 集約で 8 項目 SSOT 化済)
- `docs/design/plan-change-flow.md` (D 集約で §11 追加済)
- `docs/design/license-subscription-causality.md` (D 集約で §2.4.1 追加済)
- `docs/design/account-deletion-flow.md` (D 集約で §0「解約との違い」追加済)
- `docs/operations/stripe-dashboard-runbook.md` (D-additional で新規作成済)
- `site/terms.html` 第 7 条 + 第 13 条 (D 集約で「解約 vs アカウント削除」明示済、EPIC AC6 達成)

---

## 9. 次の研究課題 (本書 scope 外)

- Phase 2 β 差額キー方式 (+280 円アップグレード Product) の PMF 確認後再評価
- Stripe Subscription Upgrade API (δ proration) のキー方式併用可否 (Pre-PMF 過剰なので未調査)
- SES 配布メール (#815) の実装詳細 (本 EPIC scope 外、別 Issue 進行中)
- `/admin/license` 適用 UI の実装詳細 (#847、本 EPIC scope 外)
- HMAC 必須化 / レート制限等のセキュリティ強化 (#806 / #813、本 EPIC scope 外)

---

## 10. 改訂履歴

| 日付 | 改訂 | 理由 |
|---|---|---|
| 2026-05-14 | 初版作成 (tmp/research/) | PO 報告対応の補佐 deep research |
| 2026-05-18 | docs/reference/ に正本化 (EPIC #2098 AC1) | PR #2222 + #2228 完工後の SSOT 化、子 Issue 6 件 closed 状態を本書で整合確認 |
