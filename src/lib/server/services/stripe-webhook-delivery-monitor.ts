// src/lib/server/services/stripe-webhook-delivery-monitor.ts
//
// #3959: Stripe webhook が「そもそも届いていない」ことを検知する (沈黙の検知)。
//
// 2026-07-26 の本番課金 incident では、CloudFront edge が Stripe からのリクエストを 403 で弾き、
// **リクエストが Lambda に 1 度も到達しなかった**。アプリ内の通知経路 (`notifyStripeAlert` /
// `sendDiscordAlert`) はすべて「アプリのコードが実行された」ことを前提にしているため、
// 初の有料課金が丸ごと落ちても alert は 1 つも鳴らず、顧客申告で発覚した。
//
// 「異常 = 例外が発生する」という前提では **イベントの不在**を検知できない。そこで
// 「Stripe 側には event があるのに、こちら側で完了していない」ことを外から周期的に確かめる。
//
// ## 検知の 2 signal (Issue #3959 ゴール)
//
//   S1 (滞留): Stripe の Event が `pending_webhooks > 0` のまま `STALE_MINUTES` 以上経過している。
//      `pending_webhooks` は「まだ 2xx を返していない配信先の数」で、incident 当時これが唯一の
//      決定的な証拠だった (`pending_webhooks=1` / `webhooks_delivered_at=null`)。
//   S2 (未反映): `checkout.session.completed` が `STALE_MINUTES` 以上前に発生しているのに、
//      その tenant に subscription が結び付いていない (= 支払いが起きたのにプランが反映されていない)。
//      S1 が Stripe 側の事実であるのに対し、S2 は**顧客影響そのもの**を見る。
//
// ## PR #4079 (`stripe-webhook-handler-failed`) との責務分界
//
// | | 所有する事象 | 発火 | 情報源 |
// |---|---|---|---|
// | `stripe-webhook-handler-failed` (#3985 / PR #4079) | event は**到達した**が handler が throw した | 初回失敗の瞬間 (同期) | アプリ内の catch |
// | `stripe-webhook-undelivered` (本 module) | event が**到達していない / 完了していない** | cron (1 時間毎) | Stripe API + 自 DB |
//
// Stripe API だけでは「未達」と「到達したが 500 を返した」を判別できない (どちらも
// `pending_webhooks > 0` のまま)。そのため本 module は**単独の pending だけでは鳴らさず**、
// S1 と S2 の**論理積**を条件にする (下記 `shouldAlert`)。handler が **throw して**失敗した場合、
// Stripe は再送するため checkout の効果は他経路 (subscription webhook / Portal) や再送で
// 反映されうる。両方が立つのは「支払いが起きたのに何も反映されていない」= 2026-07-26 と同型の
// 事象に限られる。
//
// ## どちらの alert も所有しない穴 (#4108、既知・本 PR では塞がない)
//
// handler が **throw せずに** 200 を返してしまう経路 (#4108: `resolveSubscriptionContext` が
// bare catch で一過性障害を潰し、呼び出し側が `if (!tenant) return` で正常終了する) は、
// **本 module と #4079 のどちらも検知しない**:
//
//   - `stripe-webhook-handler-failed` (#4079) は handler の throw を前提にするため発火しない。
//   - 200 が返っているので Stripe 側は配信成功扱いになり `pending_webhooks = 0` → **S1 が偽**。
//     本 module は S1 ∧ S2 を条件にするため、S2 (plan 未反映) が立っていても発火しない。
//
// つまり「支払い済みなのに plan が反映されない」状態が**無通知で継続する**。恒久対処 (throw しない
// 障害経路の re-throw + fitness function) は #4108 が所有する。S2 単独で鳴らす別 kind を足す案は
// 検知条件そのものの変更 (false positive の再評価が必要) になるため本 PR の scope 外とし、PO 判断に
// 委ねる。runbook 側の記述は `docs/runbooks/silent-failure-alert-response.md` §2.2 が SSOT。
//
// 1 回の実行で Discord に送るのは **最大 1 通**。findings は 1 通にまとめる (通知の重複を作らない)。
//
// 設計 SSOT: docs/design/13-AWSサーバレスアーキテクチャ設計書.md §3.3 Cron ジョブ一覧
//            docs/runbooks/silent-failure-alert-response.md (一次対応)

import type Stripe from 'stripe';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { notifyStripeAlertAsync } from '$lib/server/stripe/alert';
import { getStripeClient, isStripeEnabled } from '$lib/server/stripe/client';

/**
 * event 作成から何分経過したものを「滞留」とみなすか。
 *
 * Stripe は配信失敗時に指数バックオフで最大 3 日間再送するため、**一過性の失敗は数分で自然復旧する**。
 * 30 分は「Stripe の初期リトライが数回走っても解決していない」線であり、かつ検知遅延 1 時間以内
 * (Issue #3959 ゴール、cron は毎時実行) を満たす。短くすると再送で直る一過性障害を鳴らし、
 * 長くすると顧客が支払い済みなのに使えない時間が伸びる。
 */
export const STALE_MINUTES = 30;

/** 何時間さかのぼって Stripe の event を確認するか (1 回の実行で見る窓)。 */
export const LOOKBACK_HOURS = 24;

/**
 * 1 回の実行で Stripe から取得する event の上限。
 *
 * cron は 30 秒予算のアプリ Lambda 上で走る (13-AWS 設計書 §3.3 Cron ジョブ実行時間予算) ため
 * ページングしない。上限に達している時点で既に異常事態であり、その事実自体を alert に載せる。
 */
export const MAX_EVENTS_PER_RUN = 100;

/** 監視対象の event 型 (購読 5 種のうち、課金の成立に直結するもの)。 */
const MONITORED_EVENT_TYPES = [
	'checkout.session.completed',
	'invoice.paid',
	'customer.subscription.updated',
	'customer.subscription.deleted',
] as const;

const CHECKOUT_COMPLETED = 'checkout.session.completed';

export interface StaleEventSummary {
	eventId: string;
	eventType: string;
	createdIso: string;
	pendingWebhooks: number;
}

export interface UnreflectedCheckoutSummary {
	eventId: string;
	createdIso: string;
	/** session.metadata.tenantId (未設定なら null)。PII ではない内部 ID */
	tenantId: string | null;
	reason: 'tenant-not-found' | 'no-subscription' | 'subscription-mismatch' | 'tenant-id-missing';
}

export interface WebhookDeliveryCheckResult {
	/** Stripe が無効な環境 (staging / NUC / local) では検査せず終了する */
	skipped: 'stripe-disabled' | null;
	/** 走査した event 数 */
	checked: number;
	/** S1: pending のまま滞留している event */
	staleEvents: StaleEventSummary[];
	/** S2: checkout 完了なのに plan が反映されていない event */
	unreflectedCheckouts: UnreflectedCheckoutSummary[];
	/** MAX_EVENTS_PER_RUN に達したか (取りこぼしの可能性) */
	truncated: boolean;
	/** Discord alert を送ったか */
	alerted: boolean;
}

/**
 * alert を鳴らすかの判定 (責務分界の実体)。
 *
 * S1 (Stripe 側で未完了) と S2 (顧客影響あり) の両方が立ったときだけ鳴らす。
 * 片方だけで鳴らすと、handler 失敗を所有する `stripe-webhook-handler-failed` (PR #4079) と
 * 同一事象で二重に鳴る。
 */
export function shouldAlert(result: {
	staleEvents: readonly unknown[];
	unreflectedCheckouts: readonly unknown[];
}): boolean {
	return result.staleEvents.length > 0 && result.unreflectedCheckouts.length > 0;
}

function toIso(unixSeconds: number): string {
	return new Date(unixSeconds * 1000).toISOString();
}

/** Stripe の `session.subscription` は id 文字列か展開済オブジェクトのどちらでも来る。 */
function subscriptionIdOf(session: Stripe.Checkout.Session): string | null {
	const sub = session.subscription;
	if (!sub) return null;
	return typeof sub === 'string' ? sub : sub.id;
}

/**
 * checkout の効果が DB に反映されているかを確認する。
 *
 * 「tenant が subscription を 1 本持っている」だけを条件にすると、**既存契約者のプラン変更**
 * checkout が常に「反映済み」と誤判定される (変更前の subscription が残っているため)。
 * その場合は代金だけ取られて機能が開かない状態を見逃すので、Stripe が言う
 * 「この checkout が作った subscription」と DB が指す subscription の一致まで見る。
 */
async function inspectCheckout(event: Stripe.Event): Promise<UnreflectedCheckoutSummary | null> {
	const session = event.data.object as Stripe.Checkout.Session;
	const tenantId = session.metadata?.tenantId ?? null;
	const createdIso = toIso(event.created);

	if (!tenantId) {
		// metadata が欠けている = そもそも当方の checkout 経路で作られていない可能性がある。
		// 判定不能を「正常」に倒すと沈黙するため、未反映として扱い人が見る。
		return { eventId: event.id, createdIso, tenantId: null, reason: 'tenant-id-missing' };
	}

	const tenant = await getRepos().auth.findTenantById(tenantId);
	if (!tenant) {
		return { eventId: event.id, createdIso, tenantId, reason: 'tenant-not-found' };
	}
	if (!tenant.stripeSubscriptionId) {
		return { eventId: event.id, createdIso, tenantId, reason: 'no-subscription' };
	}

	const sessionSubscriptionId = subscriptionIdOf(session);
	if (sessionSubscriptionId && sessionSubscriptionId !== tenant.stripeSubscriptionId) {
		// この checkout で成立した subscription を DB が指していない = 反映されていない。
		return { eventId: event.id, createdIso, tenantId, reason: 'subscription-mismatch' };
	}
	return null;
}

/**
 * Stripe webhook の未達を検査し、必要なら Discord に 1 通だけ通知する。
 *
 * @param now 判定基準時刻 (test で固定するため注入可能。既定は現在時刻)
 */
export async function checkWebhookDelivery(
	now: Date = new Date(),
): Promise<WebhookDeliveryCheckResult> {
	const base: WebhookDeliveryCheckResult = {
		skipped: null,
		checked: 0,
		staleEvents: [],
		unreflectedCheckouts: [],
		truncated: false,
		alerted: false,
	};

	if (!isStripeEnabled()) {
		// staging / NUC / local。Stripe を持たない環境で毎時 alert を出さない。
		logger.info('[stripe-webhook-delivery-check] Stripe 無効のため検査を行いません', {
			service: 'stripe',
		});
		return { ...base, skipped: 'stripe-disabled' };
	}

	const nowSec = Math.floor(now.getTime() / 1000);
	const staleBeforeSec = nowSec - STALE_MINUTES * 60;
	const lookbackFromSec = nowSec - LOOKBACK_HOURS * 3600;

	const stripe = getStripeClient();
	const list = await stripe.events.list({
		types: [...MONITORED_EVENT_TYPES],
		created: { gte: lookbackFromSec, lte: staleBeforeSec },
		limit: MAX_EVENTS_PER_RUN,
	});
	const events = list.data ?? [];

	const staleEvents: StaleEventSummary[] = [];
	const unreflectedCheckouts: UnreflectedCheckoutSummary[] = [];

	for (const event of events) {
		if (event.pending_webhooks > 0) {
			staleEvents.push({
				eventId: event.id,
				eventType: event.type,
				createdIso: toIso(event.created),
				pendingWebhooks: event.pending_webhooks,
			});
		}
		if (event.type === CHECKOUT_COMPLETED) {
			const unreflected = await inspectCheckout(event);
			if (unreflected) unreflectedCheckouts.push(unreflected);
		}
	}

	const result: WebhookDeliveryCheckResult = {
		...base,
		checked: events.length,
		staleEvents,
		unreflectedCheckouts,
		truncated: events.length >= MAX_EVENTS_PER_RUN,
	};

	if (!shouldAlert(result)) {
		logger.info('[stripe-webhook-delivery-check] 未達の兆候はありません', {
			service: 'stripe',
			context: {
				checked: result.checked,
				staleCount: staleEvents.length,
				unreflectedCount: unreflectedCheckouts.length,
			},
		});
		return result;
	}

	// `stripe.events.list` は created の**降順** (新しい順) で返すため `staleEvents[0]` は最新。
	// runbook は障害の開始時刻を推定するために最古から辿るので、明示的に最小を取る (#4102 M4)。
	// createdIso は UTC の ISO 8601 固定長で、辞書順比較 = 時刻順比較になる。
	const oldestStale = staleEvents.reduce<StaleEventSummary | undefined>(
		(oldest, event) => (!oldest || event.createdIso < oldest.createdIso ? event : oldest),
		undefined,
	);
	// 通知には event id / type / tenant id / 件数のみを載せる。顧客の email / 氏名 / カード情報は
	// 一切参照しない (notifyStripeAlertAsync 側でも redactPii を通す、#2738 整合)。
	//
	// alert 送信は **await する**。本 cron は「alert を送って即レスポンス」であり、fire-and-forget の
	// まま返すと Lambda の freeze で送信中の fetch が凍結され、鳴るはずの通知が消える (#4102 M2)。
	await notifyStripeAlertAsync({
		kind: 'stripe-webhook-undelivered',
		message:
			`Stripe webhook が ${STALE_MINUTES} 分以上未完了で、支払い済みのプラン反映も行われていません ` +
			`(未完了 ${staleEvents.length} 件 / 未反映 checkout ${unreflectedCheckouts.length} 件)`,
		errorSummary: 'stripe-webhook-undelivered',
		tags: {
			staleCount: staleEvents.length,
			unreflectedCount: unreflectedCheckouts.length,
			checked: result.checked,
			truncated: result.truncated,
			...(oldestStale
				? {
						oldestEventId: oldestStale.eventId,
						oldestEventType: oldestStale.eventType,
						oldestCreatedIso: oldestStale.createdIso,
					}
				: {}),
			...(unreflectedCheckouts[0]
				? {
						sampleCheckoutEventId: unreflectedCheckouts[0].eventId,
						sampleCheckoutReason: unreflectedCheckouts[0].reason,
					}
				: {}),
		},
	});

	return { ...result, alerted: true };
}
