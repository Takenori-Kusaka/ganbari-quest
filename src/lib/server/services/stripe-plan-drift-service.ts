// src/lib/server/services/stripe-plan-drift-service.ts
//
// #4128: plan 逆引き不能で**滞留している契約**を /ops から見えるようにする。
//
// `resolvePlanFromSubscription` が null を返すと、webhook handler は既存 plan を保持したまま
// 正常終了する (silent fallback を廃した #3960 の設計)。`stripe-plan-unresolved` alert は鳴るが、
// alert は **その瞬間の 1 通** でしかない。Stripe 側で Price を差し替えて env の更新を忘れた、
// のような状態は放っておくと **顧客が「払っている額」と「使える機能」が食い違ったまま滞留する**。
// 復旧すべき対象がどこにも一覧されていないと、対応が人の記憶に依存する (Issue #4128 No-gos)。
//
// そこで「今この瞬間、どの tenant がどの price で解決不能なのか」を Stripe と DB から**その場で
// 突き合わせて**返す。過去の alert ログを溜めるのではなく現在の状態を見るのは、
//   - 滞留は「解決するまで続く状態」であって「起きた瞬間の event」ではない
//   - 復旧したかどうかを同じ画面で確認できる (溜めた log は消し込みが必要になる)
// ため。新規テーブルも新規 cron も要らない (ADR-0010 Pre-PMF)。
//
// 判定は webhook 側と同一の `resolvePlanFromSubscriptionItems` を使う。ops 用に別実装を書くと
// 「alert は出るが /ops には出ない」食い違いが生まれる。

import type Stripe from 'stripe';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { getStripeClient, isStripeEnabled } from '$lib/server/stripe/client';
import { resolvePlanFromSubscriptionItems } from './stripe-service';

/**
 * 検査対象の subscription status。
 *
 * 「顧客が課金対象になっている / 機能を使える想定の契約」だけを見る。`canceled` / `incomplete_expired`
 * は plan を解決できなくても顧客影響が無いため、滞留として並べるとノイズになる。
 */
const ACTIVE_STATUSES: readonly string[] = ['active', 'trialing', 'past_due', 'unpaid'];

/** 1 回の照会で Stripe から取得する subscription の上限 (ページングしない)。 */
export const MAX_SUBSCRIPTIONS_PER_CHECK = 100;

export interface PlanUnresolvedSubscription {
	subscriptionId: string;
	subscriptionStatus: string;
	/** 逆引きできた tenant (customer から解決できなければ null)。PII ではない内部 ID */
	tenantId: string | null;
	/** DB 側で保持されたままの plan (= 課金と食い違っている可能性がある値) */
	currentPlan: string | null;
	/** 解決できなかった Price。env / lookup_key のどちらを直せばよいかの手掛かり */
	priceId: string | null;
	lookupKey: string | null;
	/** item が 2 件以上なら先頭参照の前提自体が崩れている (#3980) */
	itemCount: number;
}

export interface PlanDriftReport {
	/** Stripe が無効な環境 (staging / NUC / local) では検査せず終了する */
	skipped: 'stripe-disabled' | null;
	/** 走査した subscription 数 */
	checked: number;
	/** 上限に達したか (取りこぼしの可能性) */
	truncated: boolean;
	/** plan を確定できず滞留している契約 */
	unresolved: PlanUnresolvedSubscription[];
	/** 照会自体が失敗した場合の理由 (画面に出す。握り潰して「0 件」に見せない) */
	error: string | null;
}

function customerIdOf(subscription: Stripe.Subscription): string | null {
	const customer = subscription.customer;
	if (!customer) return null;
	return typeof customer === 'string' ? customer : customer.id;
}

/**
 * plan を確定できない契約の一覧を、Stripe と DB を突き合わせて返す。
 *
 * 失敗しても throw しない (/ops の他セクションを巻き添えにしない) が、**握り潰さない**。
 * `error` に理由を載せ、画面は「0 件」ではなく「確認できなかった」と表示する。
 */
export async function checkPlanResolution(): Promise<PlanDriftReport> {
	const base: PlanDriftReport = {
		skipped: null,
		checked: 0,
		truncated: false,
		unresolved: [],
		error: null,
	};

	if (!isStripeEnabled()) {
		return { ...base, skipped: 'stripe-disabled' };
	}

	try {
		const stripe = getStripeClient();
		const list = await stripe.subscriptions.list({
			status: 'all',
			limit: MAX_SUBSCRIPTIONS_PER_CHECK,
		});
		const subscriptions = (list.data ?? []).filter((sub) =>
			ACTIVE_STATUSES.includes(sub.status),
		);

		const unresolved: PlanUnresolvedSubscription[] = [];
		for (const subscription of subscriptions) {
			const items = subscription.items?.data ?? [];
			if (resolvePlanFromSubscriptionItems(items)) continue;

			const customerId = customerIdOf(subscription);
			const tenant = customerId
				? await getRepos().auth.findTenantByStripeCustomerId(customerId)
				: undefined;

			unresolved.push({
				subscriptionId: subscription.id,
				subscriptionStatus: subscription.status,
				tenantId: tenant?.tenantId ?? null,
				currentPlan: tenant?.plan ?? null,
				priceId: items[0]?.price?.id ?? null,
				lookupKey: items[0]?.price?.lookup_key ?? null,
				itemCount: items.length,
			});
		}

		return {
			...base,
			checked: subscriptions.length,
			truncated: (list.data ?? []).length >= MAX_SUBSCRIPTIONS_PER_CHECK,
			unresolved,
		};
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		logger.error(`[stripe-plan-drift] plan 解決状況の照会に失敗しました: ${detail}`, {
			service: 'stripe',
			error: detail,
		});
		// 例外の生 message は画面に出さない (接続情報 / token 断片を含みうる、#4101 整合)。
		return { ...base, error: err instanceof Error ? err.name : 'UnknownError' };
	}
}
