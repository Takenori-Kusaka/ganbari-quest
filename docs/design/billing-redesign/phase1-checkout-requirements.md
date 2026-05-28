# 有料化 (checkout → subscription) 要件定義 (#2534 / Epic #2525 Phase 1)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2534 (有料化の要件) |
| 親 | #2526 (Phase 1) / 上位 #2525 |
| ステータス | Phase 1 完了 (deep-research: 4 論点 Stripe 公式一次確認 → PO 確定 2026-05-27、判断 1 論点も確定) |

## 機能要件 (FR)

| ID | 要件 | 設計意図 + 根拠 |
|----|------|----------------|
| FR-1 | **1 Product (例: 「がんばりクエスト」) に standard/family × 月額/年額 = 4 Price** を Stripe に定義、アプリは **lookup_key 参照** | 価格改定時のコード変更ゼロ化。Stripe build-subscriptions 公式推奨。lifetime 廃止と整合。**同一 Product 別 Price 構成はプラン変更要件 ([plan-change](phase1-plan-change-requirements.md) §最重要制約 / FR-2) が要求する Portal 期末ダウングレード成立の前提** (別 Product だと Portal 期末ダウンが効かず credit proration 事故)。最終 Dashboard 構成の確認・再設計は Phase 5 へ申し送り (plan-change Open question 1) |
| FR-2 | プラン選択 UI = **月額/年額トグル + プランカード 2 枚**、トグルで表示価格同期切替 | 業界収束パターン |
| FR-3 | 年額カードに **月あたり換算 + 月額取り消し線 + 「2ヶ月分おトク」** 明示 | ユーザーに計算させない。両プラン 16.7% off = 2ヶ月無料 (業界ど真ん中) |
| FR-4 | Checkout Session 作成時に必ず **Customer object を渡す** | 重複検出 + 権限紐付けの前提。account-first で signup 時に Customer 確定済 |
| FR-5 | **`checkout.session.completed` webhook で権限付与 (SSOT)**、success_url は UX 専用 | 公式の唯一信頼できる fulfillment 起点 (success_url 単独で付与禁止) |
| FR-6 | success ページは **「準備中」表示 + session status polling で自動解禁** | processing gap の信頼毀損回避。Stripe は webhook を最大10秒待って redirect |
| FR-7 | 既存 active サブスク保有者の Checkout 到達を **Customer Portal へ自動 redirect** (Stripe built-in) | ALREADY_SUBSCRIBED 重複防止。Customer object + portal login link + Dashboard 設定が前提 |
| FR-8 | **feature gate / プラン管理 / トライアル終了通知 の 3 入口を Checkout Session 作成に集約** | 動線一元化 |

## 非機能要件 (NFR)

- NFR-1: webhook は **冪等処理** (event.id デデュープ、fulfill は複数回安全)
- NFR-2: webhook **署名検証必須** (construct_event)、未検証は reject
- NFR-3: `checkout.session.async_payment_succeeded/failed` も購読 (将来の遅延決済対応)
- NFR-4: サブスク状態を **アプリ DB にキャッシュ** (ログイン毎の Stripe API 照会回避)
- NFR-5 (ADR-0012): 年額誘導は煽らず、トグルは中立操作可能
- NFR-6 (ADR-0013): 「2ヶ月無料」は実価格 (16.7% off) と一致するため記載可

## ユーザーストーリー

1. プランを選び (月/年トグル + カード)、年額のおトク額が一目で分かる
2. 決済直後「準備中」を見た後、操作不要で自動的に有料機能が解禁
3. すでに課金中なら二重課金されず契約管理画面に案内
4. 無料/トライアルで feature gate に当たった時その場から checkout に進める

## 月額/年額の提示

- 年額は両プラン **16.7% off = 2ヶ月無料** にぴったり一致 → **「2ヶ月分おトク」表現を推奨** (コンシューマ向けは % off より高転換)。年額選択時は月換算 (standard ¥417/月相当 / family ¥650/月相当) 併記
- **デフォルト選択**: **月額デフォルト (PO 確定 2026-05-27)**。年額は「2ヶ月おトク」として併置。Anti-engagement 整合、Pre-PMF で始めやすさ優先

## Open question

| # | 論点 | 推奨 | 状態 |
|---|------|------|------|
| 1 | 月/年トグルのデフォルト | **月額デフォルト** (年額は「2ヶ月おトク」併置) | ✅ PO 確定 2026-05-27 (Anti-engagement 整合) |
| 2 | 重複防止の実装方式 | Stripe built-in 自動 redirect | 推奨で確定 (UX 文言制御は Phase 3 で評価) |
| 3 | success polling 上限 | webhook 10秒待ち後 polling、タイムアウト時「数分後に再読込」 | 実装詳細 (Phase 5-6) |
| 4 | トライアル→有料化の動線文言 | standard も併置 (family 固定 trial 後のダウンセル経路) | トライアル要件と整合、確定 |
| 5 | 年額の解約・日割り扱い | — | **解約孫 #2536 で確定** (Phase 1 早期に PO 判断要) |

## 既存実装の現状と変更点 (delta、2026-05-28 補強)

| # | 既存実装 (file:line) | 本要件 | 扱い |
|---|---|---|---|
| 1 | createCheckoutSession (stripe-service.ts:66-101) / webhook SSOT fulfillment (:245-303) / customer 紐づけ / 4 Price 構成 (config.ts:39-70) | 維持 | ✅ 実装済み |
| 2 | priceId リテラル依存 (config.ts 環境変数直読) | lookup_key 参照 | **変更** (FR-1、Stripe Dashboard 設定も) |
| 3 | success ページ「準備中」+ polling なし | 準備中表示 + session status polling | **新規実装** (FR-6、Phase 3 UI) |
| 4 | `checkout.session.async_payment_succeeded/failed` 購読なし (現状 completed/invoice.paid/payment_failed のみ) | 購読追加 | **新規** (NFR-3) |
| 5 | ライセンスキー発行 (handleCheckoutCompleted stripe-service.ts:267-296) | **撤去** (license key 廃止) | **削除** (領域 12 連動) |

**影響範囲**: 実装は Phase 6/7。lookup_key は Stripe Dashboard 設定連動。ライセンスキー発行ブロック撤去は領域 12 (#2514) と連動。

## 根拠 (primary source)

- Stripe build-subscriptions / checkout/fulfillment / limit-subscriptions (Product/Price/lookup_key, webhook SSOT, processing gap polling, 重複防止 built-in)
- 月額年額: innerTrends (16.7%=2ヶ月無料 標準) / Paddle (月換算併記)
- ADR-0012 (Anti-engagement) / ADR-0013 (LP truth)
- 既存: src/lib/server/stripe/ / terms.ts (PRICE_TERMS / TRIAL_TERMS / PLAN_FULL_TERMS)
