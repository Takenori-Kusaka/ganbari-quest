# Stripe Webhook 冪等性 DB 設計 (stripe_webhook_events dedup table) — Epic #2525 Phase 5 子 2

| 項目 | 内容 |
|------|------|
| 孫 issue | #2641 (Phase 5 子 2 — webhook 冪等性 DB 設計) |
| 親 | #2530 (Phase 5 アーキ) / Epic #2525 |
| 上位 (Phase 1) | #2537 (dunning) / #2540 (security) |
| ステータス | 設計確定 (deep-research: Stripe 公式 Webhook 一次 6 URL 検証済 → 本 PR で docs 確定、コード変更は Phase 7) |
| 依存 (Phase 5 同位) | 子 1 ([phase5-stripe-product-architecture.md](phase5-stripe-product-architecture.md)) Webhook endpoint 設計と統合 |
| Phase 7 連動 | webhook handler 全 5 種 (現行) + 3 種 (子 1 新規 `subscription_schedule.*`) を本 DB 経由 |
| 起点 | Phase 1 dunning NFR-1 (webhook 冪等性) + Phase 1 security FR-4 (event.id で冪等性管理) + security 既存実装 delta #3 (「event.id dedup なし → 新規構築」) の合流地点 |

## 1. 設計背景

### 1.1 課題: 現行は webhook event.id dedup を持たず、二重課金 / 二重ライセンス発行リスクを抱える

現行 (`src/lib/server/services/stripe-service.ts` の `handleWebhookEvent` = L221、5 handler の switch dispatcher) は Stripe Webhook event を受信すると、署名検証 (`constructEvent` = L218) 通過後に **event.id を検査せず**直接 handler を呼ぶ。Stripe の at-least-once delivery 仕様 (公式: <https://docs.stripe.com/webhooks#handle-duplicate-events>) では、ネットワーク障害 / handler 200 OK 応答遅延 / Stripe 側 retry により **同一 event.id が複数回到達**することが正規動作として保証されている。

[Phase 1 security](phase1-security-requirements.md) FR-4 で確定:

> **FR-4: event.id で冪等性管理、replay/重複を 1 回反映。署名 timestamp 5 分 tolerance デフォルト維持 (0 禁止) + NTP 同期**

[Phase 1 dunning](phase1-dunning-requirements.md) NFR-1 + 既存実装 delta #3 で確定:

> **NFR-1: webhook 冪等性 (同一 payment_failed 重複で多重遷移しない)**
> **既存実装 #3: webhook 冪等性 (event.id dedup) なし → event.id 冪等性 → 新規構築 (NFR-1、DB table 新設)**

dedup なしのまま放置すると以下が発生する (Stripe 公式 docs の `Handle duplicate events` 警告に該当):

1. **`checkout.session.completed` 重複 → license key 二重発行**: `handleCheckoutCompleted` (L245-303) は `issueLicenseKey` (L271) を呼んで license key を発行し、Stripe Customer のメールに送信する。同一 event.id が 2 回到達すると 2 通のメール送信 + DB に 2 行 license_keys insert で顧客困惑を招く
2. **`invoice.paid` / `invoice.payment_failed` 重複 → past_due ↔ active 遷移の振動**: dunning grace period 中に同一 event が複数回到達すると、past_due → active → past_due の不要な遷移が連鎖し、Phase 1 dunning NFR-3 (子供の利用体験は支払い状態で**突然中断しない**) に反する
3. **`customer.subscription.deleted` 重複 → 解約 → 即時再活性化 → 解約の振動**: 退会フローで Stripe Customer 削除と subscription cancel が両方発火し、両 webhook が冪等性なく処理されると、tenant の `plan` 列が `free` ↔ `standard` を振動

### 1.2 課題: Phase 5 子 1 で webhook 購読 event が 5 → 8 種に拡張される

[phase5-stripe-product-architecture.md](phase5-stripe-product-architecture.md) §4.3 で Phase 7 webhook 購読 event リストに 3 種が新規追加される:

- `subscription_schedule.aborted` (Phase 1 plan-change ダウングレード予約の予期せぬ終了検知)
- `subscription_schedule.canceled` (顧客が Portal でダウン予約をキャンセルした場合の検知)
- `subscription_schedule.completed` (期末ダウン適用完了の検知)

子 1 §4.3 best practice 3 で確定:

> **Phase transition 時の冪等処理: 同一 phase 開始 event が複数回到達した場合の二重課金回避**

これらの新規 event も既存 5 種と同じ dedup 機構に乗せる必要がある (event 型別に dedup ロジックを分散させると 8 箇所散在 → 将来追加時の漏れ温床)。本 PR で **handler 横断の dedup 機構を 1 箇所** (`handleWebhookEvent` dispatcher 入口、L221) に置き、全 event 型を一律処理する。

### 1.3 課題: Stripe 公式が「24h replay window 内の dedup を SSOT として推奨」と明示

Stripe 公式 (<https://docs.stripe.com/webhooks#handle-duplicate-events>) より:

> "your application should be able to handle duplicate events. One way to do this is by **logging the event IDs you've processed**, and then not processing already-logged events."

加えて Stripe `event.id` (`evt_*`) は Stripe 側で **再送 (replay) 時も同一 ID** が再利用される (公式: <https://docs.stripe.com/api/events/object>)。CLI `stripe events resend <event_id>` でも同一 ID で再送される (公式: <https://docs.stripe.com/cli/events/resend>)。よって `event.id` を PK にした「処理済み event ログ」が dedup の SSOT として最適。

### 1.4 設計がなかった場合に何が困るか

1. **license key 二重発行 → 顧客困惑 + 経理混乱** (Phase 1 security 既存実装 delta #3 未消化)
2. **past_due ↔ active 振動 → 子供の利用体験中断** (Phase 1 dunning NFR-1 / NFR-3 未成立)
3. **Phase 5 子 1 の 3 種新規 event 追加時に dedup を 8 箇所散在実装** (将来の new event 追加で漏れ温床)
4. **Stripe CLI / Dashboard からの手動 replay 検証で本番副作用** (顧客状態が壊れて補修工数発生)

## 2. 設計原則

| 原則 | 内容 | 根拠 |
|------|------|------|
| **handler 横断の dedup 機構** | `handleWebhookEvent` dispatcher 入口 (L221) で 1 箇所 dedup、全 event 型を一律処理 | Stripe 公式 best practice / future-proof (新規 event 追加時の散在防止) |
| **event.id PK** | Stripe `evt_*` の immutable な ID を SSOT、replay/resend で同一 ID を活用 | Stripe 公式 API events object 仕様 |
| **handler 実行と dedup row 書込みを同一 transaction** | SQLite は `BEGIN ... COMMIT`、DynamoDB は `TransactWriteItems`、in-memory は同期 Map に統一 | partial failure (handler 成功 + dedup row insert 失敗) で次回到達時に再実行されることを保証 (at-most-once は無理、at-least-once で冪等 handler を作る Stripe 推奨パターン) |
| **30 日 retention (ADR-0049 整合)** | `processed_at` 30 日経過で物理削除 (Stripe 公式 `Events API` は 30 日でも保持される為、replay window 内のみカバーすれば足りる) | Stripe 公式 events object docs (30 日後 list API から消える) / PIPC データ最小化 / Pre-PMF dedup row 量を膨張させない |
| **4 backend 整合** | SQLite (Drizzle) / DynamoDB (single table) / in-memory (demo & test) で同一 interface (`IWebhookEventRepo`) | `parallel-implementations.md` の DB スキーマ整合ルール (§9 並行ペア整合) |
| **error_message + retry_count 記録** | handler 例外時は `handler_result: 'error'` で row insert + error_message に Stripe.Error message を保存、retry_count を increment | Phase 7 retry 戦略の基礎データ (本 PR scope 外、retry 自動化は PMF 後判断) |
| **HTTP status は常に 200 (重複検知時も)** | Stripe 公式: 4xx/5xx 返却は Stripe 側 retry をトリガし重複到達を増やす | Stripe 公式 webhook best practice (`Acknowledge events immediately`) |

## 3. 確定案: stripe_webhook_events table

### 3.1 SQLite schema (Drizzle ORM、`src/lib/server/db/schema.ts` に追加)

```typescript
// ============================================================
// stripe_webhook_events - Stripe Webhook 冪等性 dedup (Phase 5 子 2 / #2641)
// 同一 event.id 重複処理時の二重課金 / 二重ライセンス発行を防ぐ。
// Stripe at-least-once delivery + replay/resend で同一 event.id 再送が正規動作。
// 30 日 retention (Stripe Events API 保持期間と同期、ADR-0049 整合)。
// ============================================================
export const stripeWebhookEvents = sqliteTable(
  'stripe_webhook_events',
  {
    // Stripe event.id (`evt_*`)、immutable、Stripe 側 SSOT
    eventId: text('event_id').primaryKey(),
    // event.type (`checkout.session.completed` / `invoice.paid` / `subscription_schedule.aborted` 等)
    eventType: text('event_type').notNull(),
    // handler 実行完了時刻 (ISO 8601)、retention cutoff の基準
    processedAt: text('processed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    // 'success' | 'error' | 'skipped' (未購読 event 型)
    handlerResult: text('handler_result').notNull(),
    // handler 例外時の error message (Stripe.Error.message を最大 500 文字で truncate)
    errorMessage: text('error_message'),
    // 同一 event.id の再到達回数 (初回 = 0、replay/resend で increment)
    retryCount: integer('retry_count').notNull().default(0),
    // 関連 tenant_id (handler が解決できた場合のみ、analytics 用、PII ではない)
    tenantId: text('tenant_id'),
  },
  (table) => [
    // 30 日 retention cron 用 (processed_at で範囲 delete)
    index('idx_stripe_webhook_events_processed_at').on(table.processedAt),
    // analytics 用 (handler_result='error' の件数集計、event_type 別件数)
    index('idx_stripe_webhook_events_type_result').on(table.eventType, table.handlerResult),
  ],
);
```

**カラム選定根拠**:

| カラム | 選定根拠 |
|---|---|
| `eventId` (PK) | Stripe `evt_*` の immutable ID。Phase 1 security FR-4「event.id で冪等性管理」直接整合 |
| `eventType` | analytics 用 (どの event 型が retry 多発しているか可視化)、debug 用 (本番 incident 時に event 型別の失敗率を集計) |
| `processedAt` | 30 日 retention cron の cutoff 基準、`CURRENT_TIMESTAMP` default で handler 完了時刻が自動記録 |
| `handlerResult` | dedup 判定とは独立に「過去にこの event はどう処理されたか」を audit 可能に。`error` row は次回到達時に再処理する判断材料 |
| `errorMessage` | Phase 1 security FR-3「失敗は 4xx」の trace、Stripe.Error 情報を 500 文字で truncate (PII 流入リスク回避) |
| `retryCount` | Phase 7 retry 戦略の基礎データ (Pre-PMF では「retry 多発 event を Sentry alert」用、自動 retry は PMF 後判断) |
| `tenantId` | analytics 用 (tenant 別の webhook 失敗率)、handler が解決できなかった場合 null 許容 |

**意図的に除外したカラム**:

- `payload` (Stripe event 本体 JSON) — **意図的に除外**。Stripe Events API (30 日保持) が SSOT。自社 DB に payload 全文を保存すると (a) PII (customer email / billing details) が DB 流入する OWASP 違反、(b) DB サイズ膨張、(c) Stripe API 経由で同等情報が取得可能。Pre-PMF 過剰防衛 (ADR-0010)
- `webhook_endpoint_id` — Pre-PMF では endpoint 1 個 (`/api/stripe/webhook`)、複数 endpoint 運用時に拡張

### 3.2 DynamoDB schema (single-table design、`src/lib/server/db/dynamodb/keys.ts` に追加)

```typescript
// ============================================================
// Stripe webhook events dedup (Phase 5 子 2 / #2641):
//   PK = STRIPE_WEBHOOK_EVENT
//   SK = <event.id>           (例: evt_1ABCxyz)
//
// 用途: handleWebhookEvent dispatcher 入口で SK 一致を check し、
// 既存時は handler skip、不在時は handler 実行後に PutItem。
//
// Global single-partition (write rate 想定: Pre-PMF で <100/日、PMF 後でも <10k/日)。
// hot partition 懸念は AnalyticsAggregate (#1693) / CHALLENGE_AGG (#1742) の
// 既存単一 partition 運用と同じ。
//
// TTL: 30 日 (Stripe Events API 保持期間と同期、ADR-0049 整合)。
// DynamoDB TTL 機能で自動削除し retention cron 不要。
// ============================================================
export const STRIPE_WEBHOOK_EVENT_PK = 'STRIPE_WEBHOOK_EVENT';

export function stripeWebhookEventKey(eventId: string): DynamoKey {
  return {
    PK: STRIPE_WEBHOOK_EVENT_PK,
    SK: eventId,
  };
}

export const STRIPE_WEBHOOK_EVENT_TTL_DAYS = 30;
```

**設計判断**:

- **Global single-partition**: `cancellation_reasons` (#1596) / `graduation_consent` (#1603) / `analytics_aggregate` (#1693) と同パターン。書込み rate < 10k/日で hot partition 不発生 (DynamoDB は 1k WCU/sec/partition、毎秒 1000 events 並列処理が物理限界)
- **GSI 不要**: dedup 判定は SK 単点 lookup (`GetItem`)、event_type 別 analytics 集計は scan + filter (低頻度、夜間 cron)。Pre-PMF 過剰防衛回避 (ADR-0010)
- **TTL native 機能**: SQLite と異なり DynamoDB は item-level TTL を native sup, sport。30 日後に AWS が自動削除 → 自社 retention cron 不要

### 3.3 in-memory schema (demo & test、`src/lib/server/db/demo/` 配下に新規 file)

```typescript
// src/lib/server/db/demo/webhook-event-repo.ts (Phase 7 で新規作成、本 PR scope 外)
// in-memory Map で 4 backend 整合を保つ。demo Lambda + unit test で使用。
import type { IWebhookEventRepo, WebhookEventRecord } from '../interfaces/webhook-event-repo.interface';

const events = new Map<string, WebhookEventRecord>();

export const demoWebhookEventRepo: IWebhookEventRepo = {
  async findByEventId(eventId) {
    return events.get(eventId) ?? null;
  },
  async insert(record) {
    events.set(record.eventId, record);
  },
  async incrementRetryCount(eventId) {
    const existing = events.get(eventId);
    if (existing) events.set(eventId, { ...existing, retryCount: existing.retryCount + 1 });
  },
  async deleteOlderThan(cutoffIso) {
    for (const [id, record] of events) {
      if (record.processedAt < cutoffIso) events.delete(id);
    }
  },
};
```

### 3.4 Repository interface (`src/lib/server/db/interfaces/webhook-event-repo.interface.ts` 新規)

```typescript
export interface WebhookEventRecord {
  eventId: string;
  eventType: string;
  processedAt: string; // ISO 8601
  handlerResult: 'success' | 'error' | 'skipped';
  errorMessage?: string;
  retryCount: number;
  tenantId?: string;
}

export interface IWebhookEventRepo {
  findByEventId(eventId: string): Promise<WebhookEventRecord | null>;
  insert(record: WebhookEventRecord): Promise<void>;
  incrementRetryCount(eventId: string): Promise<void>;
  /** retention cron 用 (cutoffIso より古い row を削除、SQLite のみ呼ぶ。DynamoDB は TTL 自動) */
  deleteOlderThan(cutoffIso: string): Promise<number>;
}
```

## 4. 既存 webhook handler との統合方針 (Phase 7 実装)

### 4.1 dispatcher 入口での dedup check (handleWebhookEvent = L221)

```typescript
// Phase 7 で stripe-service.ts に追加する擬似コード (本 PR scope 外、設計のみ)
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  const repos = getRepos();
  const existing = await repos.webhookEvent.findByEventId(event.id);

  if (existing) {
    // 重複到達 — retry_count++ + 既に処理済みとして skip
    await repos.webhookEvent.incrementRetryCount(event.id);
    logger.info(`[STRIPE] Duplicate webhook event skipped: ${event.id} type=${event.type} retry=${existing.retryCount + 1}`);
    return; // HTTP 200 を返す (上位 +server.ts 側)、Stripe 側 retry を抑止
  }

  // 初回到達 — handler 実行 → 結果を insert (transaction で atomic)
  let handlerResult: 'success' | 'error' | 'skipped' = 'success';
  let errorMessage: string | undefined;
  let tenantId: string | undefined;

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        tenantId = (event.data.object as Stripe.Checkout.Session).metadata?.tenantId;
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      // Phase 5 子 1 新規 3 種 (Phase 7 で handler 実装)
      case 'subscription_schedule.aborted':
      case 'subscription_schedule.canceled':
      case 'subscription_schedule.completed':
        await handleSubscriptionScheduleEvent(event); // Phase 7 新規
        break;
      default:
        handlerResult = 'skipped';
        logger.info(`[STRIPE] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    handlerResult = 'error';
    errorMessage = String(err).slice(0, 500); // 500 文字 truncate (PII 流入回避)
    logger.error(`[STRIPE] Webhook handler failed: ${event.id} type=${event.type}`, { error: errorMessage });
    // 例外を re-throw しない — dedup row を必ず insert して次回到達時の再処理判断材料を残す
  }

  await repos.webhookEvent.insert({
    eventId: event.id,
    eventType: event.type,
    processedAt: new Date().toISOString(),
    handlerResult,
    errorMessage,
    retryCount: 0,
    tenantId,
  });
}
```

### 4.2 設計判断: handler 失敗時に exception を re-throw しない

**選択肢 A (採用)**: handler 失敗時も dedup row を insert、HTTP 200 で Stripe に返答
**選択肢 B (不採用)**: handler 失敗時は dedup row insert を skip、HTTP 5xx で Stripe 側 retry に委ねる

A 採用根拠:
- 同一 event の無限 retry loop (handler が永続的なバグで失敗する場合) を回避
- `handler_result='error'` row が残ることで運用 alert (Sentry / Discord) が発火し、人間が修正できる
- Stripe 側 retry に頼ると **B プランの handler 修正 deploy 完了前に Stripe retry exhaustion (3 日後) でイベント完全消失**するリスク
- B が有効なケース (一時的なネットワーク障害等) は Stripe 側 5xx 検知の自動 retry より、自社 alert + 手動 `stripe events resend` の方が運用統制が効く

ただし `handler_result='error'` row は **次回 manual replay (`stripe events resend evt_*`) 時に skip されてしまう** ため、Phase 7 で **error row の手動再処理 endpoint** (`POST /api/admin/stripe/webhook/replay?event_id=evt_*`) を別途検討 (Phase 5 scope 外、Phase 7 follow-up Issue 起票推奨)。

### 4.3 dedup 機構の影響を受ける handler 一覧

| event 型 | 既存 / 新規 | handler 関数 | 二重処理時の実害 |
|---|---|---|---|
| `checkout.session.completed` | 既存 | `handleCheckoutCompleted` (L245) | **license key 二重発行 + メール 2 通送信** (最高優先で dedup 必須) |
| `invoice.paid` | 既存 | `handleInvoicePaid` (L305) | past_due → active 復帰の振動 |
| `invoice.payment_failed` | 既存 | `handlePaymentFailed` (L333) | grace period status 多重遷移 |
| `customer.subscription.updated` | 既存 | `handleSubscriptionUpdated` (L359) | tenant.plan 列の振動 (Phase 5 子 1 の Portal 期末ダウン UI に影響) |
| `customer.subscription.deleted` | 既存 | `handleSubscriptionDeleted` (L394) | 解約 → 再活性化 → 解約振動 |
| `subscription_schedule.aborted` | **新規** (子 1) | `handleSubscriptionScheduleEvent` | schedule 状態反映の振動 |
| `subscription_schedule.canceled` | **新規** (子 1) | 同上 | 同上 |
| `subscription_schedule.completed` | **新規** (子 1) | 同上 | 期末ダウン適用の重複処理 |

## 5. 30 日 retention (ADR-0049 整合)

### 5.1 SQLite (Drizzle) — 日次 cron で物理削除

```typescript
// src/lib/server/services/retention-service.ts (Phase 7 で拡張、本 PR scope 外)
async function purgeStaleWebhookEvents() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const deleted = await repos.webhookEvent.deleteOlderThan(cutoff.toISOString());
  logger.info(`[RETENTION] Purged ${deleted} stale stripe_webhook_events`);
}
```

cron 配置: `src/lib/server/cron/retention-cron.ts` の既存 retention cron に統合 (`activity_logs` / `point_ledger` 等と同 batch、Phase 7 拡張)。

### 5.2 DynamoDB — item-level TTL native 機能

DynamoDB は item に `ttl` 属性 (Unix epoch seconds) を設定すると、AWS が 48h 以内に自動削除 (公式: <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html>)。retention cron 不要。

```typescript
// dynamodb/webhook-event-repo.ts insert 時 (Phase 7 で新規実装)
const ttlEpochSeconds = Math.floor((Date.now() + 30 * 86400 * 1000) / 1000);
await client.put({
  TableName,
  Item: {
    ...stripeWebhookEventKey(event.id),
    eventType,
    processedAt,
    handlerResult,
    retryCount: 0,
    tenantId,
    ttl: ttlEpochSeconds, // DynamoDB が 30 日後に自動削除
  },
});
```

### 5.3 retention vs replay window のトレードオフ

| retention 期間 | メリット | デメリット |
|---|---|---|
| **30 日 (採用)** | Stripe Events API 保持期間 (30 日) と同期、replay 可能期間内は dedup 効果あり、PII 最小化 | 31 日目以降の replay (理論上は不可、Stripe 側 30 日で消える) が来た場合 dedup 効果なし → handler 再実行 |
| 90 日 | より長い replay window をカバー | DB 行数 3 倍、PII を 3 倍長期保持 (errorMessage 経由) |
| 永久 | 全 audit trail 保持 | DB 膨張、ADR-0049 retention 原則違反 |

30 日採用根拠: Stripe Events API 自体が 30 日で list 不能になる仕様 (`stripe events resend <event_id>` も 30 日以内のみ) のため、自社 dedup 期間を延ばしても replay 自体が来ない。

## 6. 4 backend 整合チェック (parallel-implementations.md §9 並行ペア)

| backend | 実装ファイル (Phase 7 新規) | 検証パス |
|---|---|---|
| **SQLite (Drizzle)** | `src/lib/server/db/sqlite/webhook-event-repo.ts` | `npx vitest run src/lib/server/db/` |
| **DynamoDB** | `src/lib/server/db/dynamodb/webhook-event-repo.ts` | integration test (`tests/integration/db/dynamodb/`) |
| **in-memory (demo)** | `src/lib/server/db/demo/webhook-event-repo.ts` | unit test (`tests/unit/db/webhook-event-repo.test.ts`) |
| **E2E test setup** | `tests/e2e/global-setup.ts` (CREATE TABLE 追加) + `tests/unit/helpers/test-db.ts` (CREATE TABLE 追加) | `npx playwright test tests/e2e/` |

`parallel-implementations.md` §「並行実装ペア (DB スキーマ)」表に Phase 7 PR で 1 行追記:

```markdown
| `stripe_webhook_events` (#2641 / Phase 5 子 2) | `src/lib/server/db/schema.ts` (table + 2 index) | `tests/e2e/global-setup.ts` (CREATE TABLE + 2 INDEX) | `tests/unit/helpers/test-db.ts` (CREATE TABLE) + `src/lib/server/db/create-tables.ts` (CREATE TABLE + 2 INDEX) | `src/lib/server/db/demo/webhook-event-repo.ts` (Map<string, WebhookEventRecord>) | #2641 (Phase 5 子 2) |
```

## 7. ADR-0031 (DB migration) 整合: migration script 仕様

新規 table 追加のため SQLite migration が必要 (Phase 7 で `drizzle-kit generate` 実行)。

| 項目 | 仕様 |
|---|---|
| migration ファイル | `drizzle/migrations/NNNN_add_stripe_webhook_events.sql` (NNNN は Phase 7 時点の連番) |
| migration 内容 | `CREATE TABLE stripe_webhook_events (...)` + 2 index 作成 |
| rollback 戦略 | `DROP TABLE stripe_webhook_events`、active 0 件で再構築可 (data loss tolerable) |
| 初回 deploy 後の動作 | 初回 webhook 到達時に最初の row が insert される、既存 webhook handler は無改変で動作 (Phase 7 で dispatcher 側に dedup check を追加するまで dedup は無効、ただし table 自体は存在する) |
| DynamoDB の場合 | DynamoDB は schemaless のため migration 不要、TTL 属性は table 設定 (CDK で 1 行追加: `timeToLiveAttribute: 'ttl'`) |

**ADR-0031 (DB migration) 整合**: 本 table 追加は **新規 table 追加のみで既存 schema に変更なし**、ロールバック容易、parallel-implementations.md 並行 4 backend 整合済 → ADR-0031 §3 「破壊的変更時の compat test 義務化」対象外。`tests/unit/db/schema.test.ts` の CREATE TABLE 一覧に 1 行追加で済む。

## 8. テスト計画 (Phase 7 一括実行)

| カテゴリ | テスト内容 | ファイル (Phase 7 新規作成、本 PR scope 外) | 実行 phase |
|---|---|---|---|
| **unit test** | dispatcher 入口 dedup check が既存 row を skip する | `tests/unit/services/stripe-service.dedup.test.ts` 新規 | Phase 7 |
| **unit test** | dispatcher 入口 dedup check が初回 event を insert する | 同上 | Phase 7 |
| **unit test** | handler 例外時 `handler_result='error'` で row insert | 同上 | Phase 7 |
| **unit test** | retry_count increment 動作 | 同上 | Phase 7 |
| **unit test** | 30 日経過 row が `deleteOlderThan` で削除される | `tests/unit/services/retention-service.webhook.test.ts` 新規 | Phase 7 |
| **integration** | DynamoDB TTL 属性が正しく設定される (mock LocalStack) | `tests/integration/db/dynamodb/webhook-event-repo.test.ts` 新規 | Phase 7 |
| **integration** | 4 backend (SQLite / DynamoDB / in-memory) で同一 interface 動作 | 同上 + `tests/unit/db/webhook-event-repo-cross-backend.test.ts` | Phase 7 |
| **E2E** | Stripe CLI `stripe events resend <event_id>` で同一 event を 2 回送信 → license key 1 個のみ発行 | `tests/e2e/billing/webhook-idempotency.spec.ts` 新規 | Phase 7 (Stripe CLI 実機環境必要) |
| **E2E** | Stripe CLI で異なる 5 event 型を順次送信 → 5 row insert + 全 handler 1 回ずつ実行 | 同上 | Phase 7 |

## 9. 影響範囲事後検証 (4 layer impact-analysis)

本 PR は **docs アーキ設計のみ** で新規 1 ファイル追加。Phase 7 統合 PR に向けた **事前見積** として記録。

### L1: 構文 (grep + ast-grep)

| 検出パターン | 件数 (推定、Phase 7 で実測) |
|---|---|
| `handleWebhookEvent` (`src/lib/server/services/stripe-service.ts` L221) 呼出箇所 | 1 件 (`src/routes/api/stripe/webhook/+server.ts` L33-44 の dispatcher) |
| `stripe.webhooks.constructEvent` 呼出 | 1 件 (`stripe-service.ts` L218、`verifyWebhookSignature`) |
| 既存 5 handler (`handleCheckoutCompleted` / `handleInvoicePaid` / `handlePaymentFailed` / `handleSubscriptionUpdated` / `handleSubscriptionDeleted`) | 5 件 (`stripe-service.ts` L245 / L305 / L333 / L359 / L394) |

### L2: 意味 (型 / 同名異義)

- `event.id` は Stripe SDK の `Stripe.Event.id` 型 (string)、本 DB 列 `eventId` と 1:1 対応
- `tenantId` カラムは既存 `cancellation_reasons.tenantId` / `trial_history.tenantId` と同名同義 (string)
- `handler_result` enum string は `'success' | 'error' | 'skipped'` の 3 値、cancellation `category` (`'卒業' | '離反' | '中断'`) のパターンを踏襲

### L3: 構造 (依存グラフ)

- 新規 `IWebhookEventRepo` interface (`src/lib/server/db/interfaces/`) → 4 backend 実装 (`sqlite/` / `dynamodb/` / `demo/`) → factory 経由で `stripe-service.ts` から呼出
- factory pattern (`src/lib/server/db/factory.ts`) への追加 1 行 (`webhookEvent: createWebhookEventRepo(...)`)
- 既存 `handleCheckoutCompleted` 等 5 handler の関数本体は **改変なし** (dispatcher 入口で dedup check のため)
- factory mock の更新が必要: `tests/unit/helpers/test-db.ts` の `createTestRepos()` に webhookEvent 追加

### L4: 派生 artifact (21 カテゴリ checklist)

| # | カテゴリ | 影響 |
|---|---|---|
| 1 | **DB schema** | **本 PR の対象** — 新規 1 table + 2 index、4 backend 整合 |
| 2 | DB 保存済 string value | なし (新規 table のため既存 data なし) |
| 3 | search index | なし |
| 4-6 | キャッシュ層 | なし (dedup は real-time、cache 不要) |
| 7 | Stripe Product / Price slug | なし (Phase 5 子 1 の scope) |
| 8 | Cognito | なし |
| 9 | Sentry / Datadog | Phase 7 で `handler_result='error'` row insert 時に Sentry alert (本 PR は設計のみ) |
| 10 | email template | なし (handler 内で email 送信は不変、dedup により 2 通送信が 1 通になる) |
| 11 | analytics event | Phase 7 で event_type 別の error 率を `/admin/analytics` に表示検討 (本 PR scope 外、follow-up Issue) |
| 12 | dashboard / alert | Sentry alert + Discord 通知 (Phase 7 webhook 実装時、Phase 1 security FR-1 整合) |
| 13 | Help Center / FAQ | なし (内部機構、顧客可視 0) |
| 14 | bookmarks / SEO | なし |
| 15 | 法務文書 | なし (PII 流入回避設計のため privacy.html 改訂不要) |
| 16 | GitHub Actions / pipeline | Phase 7 で `drizzle-kit push` migration を CI に追加 (既存 `npm run pre-ready` Step 1-3 で吸収) |
| 17 | **deployment env / secrets** | DynamoDB CDK 設定 (infra/lib/data-stack.ts 想定) に `timeToLiveAttribute: 'ttl'` 1 行追加 (Phase 7) |
| 18 | i18n platform | なし (内部機構、UI 露出 0) |
| 19 | fixture / seed / golden | tests/fixtures に Stripe webhook event mock 追加 (Phase 7) |
| 20 | 過去 PR / commit / Issue / ADR | 検索性のため更新しない |
| 21 | **audit log** | 本 table 自体が webhook 処理の audit log として機能、別途 audit log 不要 (ADR-0010 Pre-PMF) |

## 10. 想定リスク + ロールバック

| # | リスク | 対策 | ロールバック |
|---|---|---|---|
| R1 | dedup row insert が handler 実行より先に失敗 → 同一 event が次回到達時に再実行され `checkout.session.completed` 二重 license key 発行 | handler 実行 → row insert 順序、insert 失敗時の error log + Sentry alert で人間が検知 | 想定実害は license key 二重発行のみ、運用側で `revokeLicenseKey` で片方 revoke (Phase 7 で「重複 license key 検知 cron」を別途 follow-up Issue で起票推奨) |
| R2 | 30 日 retention で削除直後の replay (理論上は 30 日経過で Stripe 側からも消える) | Stripe 側 retention と同期、replay window を超えた event は重複到達しない | 仕様、対応不要 |
| R3 | handler 例外を re-throw しないため Stripe 側 retry が抑制され、一時的なネットワーク障害復旧前に手動 alert 対応が間に合わない | Sentry / Discord alert (`handler_result='error'` row insert で発火)、手動 `stripe events resend evt_*` で再処理 | Phase 7 で「error row 自動 retry 機構」を別途検討 (Pre-PMF scope 外、PMF 後判断) |
| R4 | DynamoDB single-partition (`PK=STRIPE_WEBHOOK_EVENT`) の hot partition | Pre-PMF write rate < 100/日、PMF 後 < 10k/日で物理限界 1000/sec 未達 | PMF 後の hot partition 発生時に GSI 追加 (event_type 別 partition 化)、本 PR scope 外 |
| R5 | 4 backend (SQLite / DynamoDB / in-memory) の interface 乖離で test 通過しても本番 fail | parallel-implementations.md §9 並行ペア整合チェック、test では各 backend で同一 spec 実行 (Phase 7) | interface 修正 → 全 backend 同期、`parallel-implementations.md` 表で漏れ検出 |
| R6 | Phase 5 子 1 完了前に本 PR 単独マージ → 既存 5 handler に dedup 効果あるが子 1 の 3 種新規 event 未対応 | 本 PR は **table + interface のみ**、dispatcher 側 dedup logic 統合は Phase 7 統合 PR (子 1 と同一 PR) で実施 | Phase 7 統合 PR を rollback、本 table は active 0 件で残置 |
| R7 | error_message に PII (customer email 等) が流入 | 500 文字 truncate + 文字列処理 (Phase 7 で `Stripe.Error` 型から email/billing details を strip するヘルパ実装) | PII 流入検知時に table truncate (data loss tolerable、active 0 件影響なし) |

## 11. ADR 起票判断

本要件は **新規 DB table 追加 + dedup 機構** で、判断原則は以下に集約済み:

- **ADR-0010 (Pre-PMF)**: 過剰防衛しない (payload 全文保存しない、GSI 追加しない、汎用 audit log にしない)
- **ADR-0049 (retention 30 日)**: Stripe Events API 保持期間と同期、PII 最小化
- **ADR-0031 (DB migration 互換性)**: 新規 table のみで既存 schema 不変、compat test 対象外
- **Phase 1 dunning NFR-1 / security FR-4**: 機能要件として既に確定済

→ **新規 ADR 起票不要** (新規 ADR 追加 gate §3 該当なし)。本 design doc が判断 SSOT として機能。

## 12. 既存実装の現状と変更点 (delta、2026-05-29 検証)

| # | 既存実装 (シンボル参照) | 本要件 | 扱い |
|---|---|---|---|
| 1 | `handleWebhookEvent` switch dispatcher (`src/lib/server/services/stripe-service.ts` L221) で dedup check なし | dispatcher 入口で `findByEventId` + 既存時 skip / 不在時 handler 実行 → `insert` | **拡張** (Phase 7、本 PR は設計のみ) |
| 2 | `verifyWebhookSignature` (`stripe-service.ts` L213) は変更なし、署名検証は維持 | 同上 | **不変** |
| 3 | 5 handler (L245 / L305 / L333 / L359 / L394) 関数本体は **改変なし** | 同上 | **不変** |
| 4 | DB schema (`src/lib/server/db/schema.ts`) に webhook 関連 table なし | `stripe_webhook_events` table + 2 index 追加 | **新規** (Phase 7、本 PR は設計のみ) |
| 5 | DynamoDB keys (`src/lib/server/db/dynamodb/keys.ts`) に `STRIPE_WEBHOOK_EVENT_PK` なし | `STRIPE_WEBHOOK_EVENT_PK` 定数 + `stripeWebhookEventKey` 関数追加 | **新規** (Phase 7) |
| 6 | repository interface (`src/lib/server/db/interfaces/index.ts`) に `IWebhookEventRepo` なし | `IWebhookEventRepo` interface 追加 + 4 backend 実装 | **新規** (Phase 7) |
| 7 | retention cron (`src/lib/server/cron/retention-cron.ts`、Phase 7 で拡張対象) に webhook events 対象なし | SQLite で `purgeStaleWebhookEvents` 統合、DynamoDB は TTL 自動削除 | **拡張** (Phase 7) |

シンボル位置は 2026-05-29 検証済 (行番号は Phase 7 実装で陳腐化するためシンボル名・関数名・定数名でのみ参照、L*** は参考)。

## 13. Open question (PO 判断、Phase 7 で確定)

| # | 軸 | 論点 | 推奨案 | 状態 |
|---|---|------|------|------|
| 1 | **business** | dedup 検知時の HTTP status は常に 200 で確定 (Stripe 公式 best practice)、admin alert は handler 失敗時のみで十分か? それとも dedup 検知率 (retry_count > 0 件数) も dashboard 化すべきか? | Phase 7 で `/admin/analytics` に「webhook 重複検知率」表示を follow-up Issue 起票 (Pre-PMF では Sentry / Discord alert のみで十分) | Phase 7 確定待ち |
| 2 | **UX** | dedup 検知時の email 重複送信 (license key 等) を防ぐが、handler 例外時の license 発行失敗を顧客がどう知る? | Phase 1 security FR-1 webhook tenant 再検証と整合: 失敗時に Sentry alert + 運用側手動 license 発行 + 顧客への email 通知 (`/admin/license/manual-issue` 経路、Phase 7 follow-up) | Phase 7 確定待ち |
| 3 | **security** | error_message に Stripe customer email 等の PII が流入する可能性 (Stripe.Error の `param` 等). 500 文字 truncate で十分か? | (a) `Stripe.Error` 型から `param` / `code` / `type` のみ抽出するヘルパで PII strip、(b) 500 文字 truncate は二重防御 — 両方実装 (Phase 7) | Phase 7 実装時に確定 |
| 4 | **security (adversarial)** | dedup row 自体への DoS 攻撃 (偽 webhook で signature 失敗 → dedup row 0 件で table 膨張なし、ただし署名検証通過済の event を 100k 並列送信で table 膨張) | 署名検証通過 event のみ dedup 対象、DynamoDB は item 数 1000 万件まで partition 制約なし (BillingMode=PayPerRequest)、SQLite は cron 削除で 30 日上限維持。攻撃成立条件 = Stripe 内部からの大量正規 event のみ (Stripe API 自体が rate limit) | 仕様、対応不要 |
| 5 | **security (adversarial)** | Phase 5 子 1 の `subscription_schedule.*` 3 種新規 event で handler 未実装期間 (本 PR マージ後 → Phase 7 統合 PR マージ前) は `default: skipped` で dedup row insert される。skipped row が 30 日 retention で削除されない間に Phase 7 で handler 実装 → 30 日以内に再送された subscription_schedule event が `existing.handler_result='skipped'` で skip され、handler 実行されない問題 | (a) `handler_result='skipped'` row は dedup 判定対象外とする (skip された event は handler 実装後に再処理する)、(b) または Phase 5 子 1 PR と Phase 7 統合 PR を同時マージで gap を最小化 | Phase 7 実装時に確定 (推奨: 案 a) |
| 6 | **security (adversarial)** | dispatcher 入口で `findByEventId` → `insert` の間に **並列で同一 event** が到達した場合 (Stripe 公式は順次配信を保証しないため複数 endpoint instance で同時受信ありえる)、両 instance が `findByEventId` で null を取得 → 両者が `insert` 試行で PK 一意性違反 → 1 つは catch して skip、もう 1 つは handler 実行 → license 二重発行回避 | (a) SQLite は `INSERT OR IGNORE` + `RETURNING` で atomic check-and-insert、(b) DynamoDB は `ConditionExpression: 'attribute_not_exists(SK)'` で同等、(c) in-memory は同期 Map の atomic write で物理単一 instance のみ動作 (demo は並列 webhook なし) | Phase 7 実装時に必須 (推奨案 a/b 両方実装) |

## 14. 関連 (2026-05-29 整合)

### Phase 1 (上位要件)

- [dunning-requirements](phase1-dunning-requirements.md) — NFR-1 (webhook 冪等性) / 既存実装 delta #3 (event.id dedup なし → 新規構築) → 本 PR で確定
- [security-requirements](phase1-security-requirements.md) — FR-4 (event.id で冪等性管理) / 既存実装 delta #3 (同上、dunning と共用) → 本 PR で確定
- [data-lifecycle-requirements](phase1-data-lifecycle-requirements.md) — NFR-2 (削除 cron idempotent / webhook 二重実行耐性) → 本 PR の retention cron が整合

### Phase 5 同位 (本 PR と並ぶ子 issue)

- 子 1 ([phase5-stripe-product-architecture.md](phase5-stripe-product-architecture.md)) — Webhook endpoint 設計、購読 event 5 → 8 種拡張 (`subscription_schedule.*` 3 種) → 本 PR の dedup 機構は子 1 の新規 3 種にも自動適用

### Phase 7 (実装、本 PR の落とし先)

- #2531 (Phase 7 実装) — 一括 rename PR + DB migration (`stripe_webhook_events` table 追加) + 4 backend 実装 + dispatcher dedup logic + retention cron 拡張 + Phase 5 子 1 統合

### ADR (関連)

- ADR-0010 (Pre-PMF、payload 全文保存しない / GSI 追加しない / 汎用 audit log にしない)
- ADR-0031 (DB migration 互換性、新規 table のみで既存 schema 不変)
- ADR-0049 (retention 30 日、Stripe Events API 保持期間と同期 / PII 最小化)

### memory (関連)

- [[per-issue-execution-workflow]] — 6 観点 + git workflow
- [[impact-analysis-methodology]] — 4 layer 防御 + 21 カテゴリ
- [[branch-base-main-freshness]] — main 最新化必須
- [[pr-body-encoding-powershell-stdin]] — Bash here-doc UTF-8
- [[pause-and-replan-on-stuck]] — 詰まり時立ち戻り 4 ステップ
- [[pr-review-recurring-blocks]] — QM BLOCK 予防 4 項目
- [[billing-critical-extra-caution]] — 課金は別格 (本 PR は dedup 機構で license 二重発行を構造的に防止)

## 15. 根拠 (primary source、Stripe 公式 6 URL 検証済)

deep-research 結果 (2026-05-29) で verbatim 確認済:

- [Stripe Webhooks: Handle duplicate events](https://docs.stripe.com/webhooks#handle-duplicate-events) — 「logging the event IDs you've processed」公式推奨
- [Stripe Webhooks: Acknowledge events immediately](https://docs.stripe.com/webhooks#acknowledge-events-immediately) — 200 返却で Stripe retry 抑止
- [Stripe API: Event object](https://docs.stripe.com/api/events/object) — `event.id` (`evt_*`) immutable、replay/resend で同一 ID
- [Stripe API: Events list (30 日 retention)](https://docs.stripe.com/api/events/list) — Events API 30 日保持期間
- [Stripe CLI: events resend](https://docs.stripe.com/cli/events/resend) — 手動 replay で同一 event.id 再送
- [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html) — item-level TTL native 機能 (48h 以内自動削除)
