# 支払い失敗 (dunning) 要件定義 (#2537 / Epic #2525 Phase 1)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2537 (支払い失敗 dunning の要件) |
| 親 | #2526 (Phase 1) / 上位 #2525 |
| ステータス | PO 確定 2026-05-27 → **2026-05-28 既存実装照合で delta 補強** (Phase 1 立ち戻り、#2526 再オープン) |

## 状態遷移 (Stripe 公式)

```
active ──invoice.payment_failed──► past_due (grace: 有料維持) ──Smart Retries 枯渇──► canceled/unpaid (無料に戻す)
  ▲                                    │
  └──invoice.paid / カード更新──────────┘ (有料復元)
```

- **past_due = アクセス維持 (grace period)**、**unpaid/canceled = アクセス停止 (無料に戻す)** ← Stripe 公式が「unpaid でアクセス取り消し」と明言
- Smart Retries = 8回/2週間デフォルト (AI 最適タイミング)。`invoice.payment_failed` webhook

## 機能要件 (FR)

| ID | 要件 | 設計意図 + 根拠 |
|----|------|----------------|
| FR-1 | `invoice.payment_failed` で `past_due` 記録、**plan tier は有料維持** (grace period) | past_due = リトライ進行中、active 復帰経路を Stripe が保証 |
| FR-2 | Smart Retries 有効化 (**2週間/8回**)、リトライ枯渇時の最終挙動を **cancel** に設定 | Stripe 推奨デフォルト。最終 canceled で二値モデル維持・解約処理再利用 (PO 確定 2026-05-27) |
| FR-3 | `unpaid`/`canceled` 検知で **無料プランに戻す** (capability free 化、解約と同じ二値復帰) | Stripe「unpaid でアクセス取り消し」。解約処理再利用 |
| FR-4 | `invoice.paid`/updated→active で **有料 capability 即時復元** | 復旧導線。webhook SSOT |
| FR-5 | past_due 中、**親 admin 画面に静的バナー 1 件** (「お支払い確認 → Customer Portal」)、子供画面には一切表示しない | ADR-0012 (子端末通知禁止/連打しない)。復旧導線を Portal 集約 (メールリンク失効回避) |
| FR-6 | Stripe 自動 dunning メール (支払い失敗/カード期限切れ) を有効化、**自社メールは送らない** | 通知主体を Stripe (親メール) 一本化。自社で重ねると連打。ADR-0012 整合 |

## 非機能要件 (NFR)

- NFR-1: webhook 冪等性 (同一 payment_failed 重複で多重遷移しない)
- NFR-2: past_due → 無料復帰判定は **webhook driven のみ** (アプリでタイマー独自判定しない、grace 長さは Stripe Smart Retries 設定が SSOT)
- NFR-3: 子供の利用体験は支払い状態で**突然中断しない** (past_due 中は維持で自然担保)

## ユーザーストーリー

1. (親/失敗) カード切れで失敗 → 親メール + 親画面バナー → Portal でカード更新。**その間も子供の有料機能は止まらない**
2. (親/復旧) カード更新で次リトライ決済通り、有料機能維持 (何も失わない)
3. (親/最終失敗) 更新せず 2 週間 (8回) で自動的に無料プランに戻る (解約と同じ、データは無料保持ルール)
4. (子供) 親の支払い状態に関わらず通知・アクセス断を経験しない

## grace period 設計

**status を唯一の判定軸**: past_due=有料維持 / unpaid・canceled=無料。アプリで日数カウントしない (grace 長さは Stripe Smart Retries 設定が SSOT、二重管理回避)。復帰処理は解約の「無料に戻す」を完全再利用 (第 3 状態を作らない)。

## 既存実装の現状と変更点 (delta、2026-05-28 補強)

### 「7日/猶予」の概念区別 (混同注意)

本要件の grace period (2週) は **支払い失敗 grace** であり、以下と別概念:

| 概念 | SSOT | 現状値 | 本要件 |
|---|---|---|---|
| **支払い失敗 grace (本要件)** | `GRACE_PERIOD_DAYS` (config.ts:95) | 7日 (app ハードコード) | **2週 (Stripe Smart Retries SSOT へ移行)** |
| 解約/退会 読み取り専用猶予 | `grace-period-service.ts` | free 0/std 7/family 30日 | 変更なし (別概念) |
| トライアル | `TRIAL_PERIOD_DAYS` (config.ts:92) | 7日 | 変更なし |
| データ保持 | ADR-0049 | free 90/std 365/family ∞ | 変更なし |

### 既存実装からの変更点

| # | 既存実装 (file:line) | 本要件 | 扱い |
|---|---|---|---|
| 1 | `GRACE_PERIOD_DAYS=7` app ハードコード (`src/lib/server/stripe/config.ts`:95)、`handlePaymentFailed` が独自に grace 計算 (`src/lib/server/services/stripe-service.ts`:333) | Stripe Smart Retries 2週を SSOT に | **変更** (app 日数管理を廃止、Stripe SSOT 化) |
| 2 | `handleSubscriptionDeleted` は status を SUSPENDED にするのみ、plan 無料化なし (`src/lib/server/services/stripe-service.ts`:394) | unpaid/canceled で plan を無料に戻す | **新規実装** (FR-3) |
| 3 | webhook 冪等性 (event.id dedup) なし | event.id 冪等性 | **新規構築** (NFR-1、DB table 新設) |

**影響範囲**: 支払い失敗 grace は **LP 非言及のため LP 影響なし**。変更は `src/lib/server/stripe/config.ts` (GRACE_PERIOD_DAYS 廃止) + `src/lib/server/services/stripe-service.ts` (handlePaymentFailed=L333 / handleSubscriptionDeleted=L394) + webhook 冪等性 DB + Stripe Dashboard (Smart Retries 設定) に限定。実装は Phase 6/7。関数位置は 2026-05-28 検証済。

## Open question

| # | 論点 | 推奨/状態 |
|---|------|----------|
| 1 | リトライ枯渇時の最終 status | ✅ PO 確定 2026-05-27: **canceled** (二値モデル維持、解約処理再利用) |
| 2 | past_due バナー文言・頻度 | 静的 1 件、Phase 3 UI で文言確定 |
| 3 | 無料復帰時のデータ保持 | #2538 (データライフサイクル) で確定 (ADR-0049) |
| 4 | Smart Retries 期間 (grace 長さ) | ✅ PO 確定 2026-05-27: **2週間/8回** (Stripe 推奨) |
| 5 | カード期限切れ事前通知 (1ヶ月前 Stripe メール) | 有効化推奨 (親メールのみ、ADR-0012 抵触なし) |

## 根拠 (primary source)

- Stripe subscriptions/overview (status 定義、unpaid でアクセス取り消し) / revenue-recovery/smart-retries (8回2週、最終3択) / customer-emails (dunning メール、親宛) / webhooks
- ADR-0012 (dunning メールは事務連絡で Anti-engagement 射程外、子端末通知禁止) / ADR-0010 (Pre-PMF、独自タイマー判定しない) / ADR-0049 (無料復帰データ保持)
