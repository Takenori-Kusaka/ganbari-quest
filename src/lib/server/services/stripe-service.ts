// src/lib/server/services/stripe-service.ts
// Stripe 決済サービス (#0131)

import type Stripe from 'stripe';
import type { CheckoutReconciliationResult } from '$lib/domain/checkout-reconciliation';
import { SUBSCRIPTION_PLAN } from '$lib/domain/constants/subscription-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { MS_PER_DAY } from '$lib/domain/constants/time';
import { CHECKOUT_LABELS, PLAN_LABELS } from '$lib/domain/labels';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { getDebugCancelAtPeriodEnd } from '$lib/server/debug-plan';
import { logger } from '$lib/server/logger';
import { invalidateRequestCaches } from '$lib/server/request-context';
import { notifyStripeAlert } from '$lib/server/stripe/alert';
import { getStripeClient, isStripeEnabled } from '$lib/server/stripe/client';
import {
	CURRENCY,
	GRACE_PERIOD_DAYS,
	getPlans,
	getWebhookSecret,
	type PlanId,
	planIdFromLookupKey,
	planIdFromPriceId,
} from '$lib/server/stripe/config';
import { redactPii } from '$lib/server/stripe/pii-redaction';

// ============================================================
// Checkout Session
// ============================================================

export interface CreateCheckoutInput {
	tenantId: string;
	/**
	 * Stripe Checkout 対象プラン。
	 * #2719 (Phase 7 PR-3b prerequisite): 年額廃止に伴い `PlanId` は monthly 2 種のみ。
	 * `SUBSCRIPTION_PLAN.YEARLY` / `FAMILY_YEARLY` / `LIFETIME` は新規 checkout 対象外。
	 */
	planId: PlanId;
	successUrl: string;
	cancelUrl: string;
}

export type CreateCheckoutResult =
	| { url: string }
	| { error: 'STRIPE_DISABLED' }
	| { error: 'TENANT_NOT_FOUND' }
	| { error: 'ALREADY_SUBSCRIBED' }
	| { error: 'INVALID_PLAN' };

export async function createCheckoutSession(
	input: CreateCheckoutInput,
): Promise<CreateCheckoutResult> {
	if (!isStripeEnabled()) return { error: 'STRIPE_DISABLED' };

	const repos = getRepos();
	const tenant = await repos.auth.findTenantById(input.tenantId);
	if (!tenant) return { error: 'TENANT_NOT_FOUND' };

	if (tenant.stripeSubscriptionId) return { error: 'ALREADY_SUBSCRIBED' };

	const plans = getPlans();
	const plan = plans[input.planId];
	// #2719: yearly 廃止後、`PlanId` 型は monthly 2 種のみだが、`tenants.plan` 由来の
	// historical record 値が input.planId として渡る可能性に備え undefined ガード追加。
	if (!plan?.priceId) return { error: 'INVALID_PLAN' };

	const stripe = getStripeClient();

	// #314: Stripe 側 trial_period_days を廃止（アプリ側一元管理に移行）
	const tierLabel = PLAN_LABELS[plan.tier as keyof typeof PLAN_LABELS] ?? plan.tier;

	// #928: Stripe SDK v22 の `create(params?, requestOptions?)` オーバーロードにより
	// `Parameters<>[0]` が `SessionCreateParams | RequestOptions | undefined` になる。
	// Stripe.Checkout.SessionCreateParams を直接指定して型安全性を確保する。
	const sessionParams: Stripe.Checkout.SessionCreateParams = {
		mode: 'subscription',
		payment_method_types: ['card'],
		line_items: [{ price: plan.priceId, quantity: 1 }],
		locale: 'ja',
		// #2346 (景品表示法 critical fix): CHECKOUT_LABELS SSOT 経由で
		// 「お選びのプランの機能」文言を適用。景品表示法 5 条 1 号 (優良誤認) +
		// 特商法 2022-06 改正最終確認画面ガイドライン 二重抵触可能性を構造的解消。
		custom_text: {
			submit: {
				message: CHECKOUT_LABELS.submitMessage,
			},
			after_submit: {
				message: CHECKOUT_LABELS.afterSubmitMessage,
			},
		},
		consent_collection: {
			terms_of_service: 'required',
		},
		allow_promotion_codes: true,
		expires_at: Math.floor(Date.now() / 1000) + 1800, // 30分
		after_expiration: {
			recovery: {
				enabled: true,
				allow_promotion_codes: true,
			},
		},
		subscription_data: {
			metadata: { tenantId: input.tenantId },
			description: `がんばりクエスト ${tierLabel}`,
		},
		success_url: input.successUrl,
		cancel_url: input.cancelUrl,
		currency: CURRENCY,
		metadata: { tenantId: input.tenantId, planId: input.planId },
	};

	if (tenant.stripeCustomerId) {
		sessionParams.customer = tenant.stripeCustomerId;
	}

	const session = await stripe.checkout.sessions.create(sessionParams);
	if (!session.url) return { error: 'INVALID_PLAN' };

	logger.info(
		`[STRIPE] Checkout session created for tenant=${input.tenantId} plan=${input.planId}`,
	);
	return { url: session.url };
}

// ============================================================
// Customer Portal
// ============================================================

export type CreatePortalResult =
	| { url: string }
	| { error: 'STRIPE_DISABLED' }
	| { error: 'TENANT_NOT_FOUND' }
	| { error: 'NO_STRIPE_CUSTOMER' };

export async function createPortalSession(
	tenantId: string,
	returnUrl: string,
): Promise<CreatePortalResult> {
	if (!isStripeEnabled()) return { error: 'STRIPE_DISABLED' };

	const repos = getRepos();
	const tenant = await repos.auth.findTenantById(tenantId);
	if (!tenant) return { error: 'TENANT_NOT_FOUND' };
	if (!tenant.stripeCustomerId) return { error: 'NO_STRIPE_CUSTOMER' };

	const stripe = getStripeClient();
	const session = await stripe.billingPortal.sessions.create({
		customer: tenant.stripeCustomerId,
		return_url: returnUrl,
	});

	return { url: session.url };
}

// ============================================================
// Subscription Cancellation (#741)
// ============================================================

export type CancelSubscriptionResult =
	| { status: 'cancelled'; subscriptionId: string }
	| { status: 'already_cancelled'; subscriptionId: string }
	| { status: 'not_subscribed' };

/**
 * テナントの Stripe Subscription を**即時**キャンセルする (#741) — **退会 (アカウント削除) 専用**。
 *
 * #3991: 解約 (subscription を終わらせるが家族データは残す) は
 * `scheduleCancellationAtPeriodEnd()` の期末解約が正 (FR-1)。本関数は
 * **退会 (アカウント削除)** の軸でのみ使う。退会は家族データそのものを消すので、
 * 支払済期間の残りを使わせる意味が無く、即時停止が正しい (残期間の課金継続は
 * 「削除したアカウントに請求が続く」クレームになる)。
 *
 * アカウント削除フローから呼び出される。DB 削除の前に必ず呼び出し、
 * Stripe 側の呼び出しで予期しないエラーが発生した場合は例外を投げて
 * DB 削除を中断させる（課金継続クレームを防ぐため）。
 *
 * 冪等性: すでに削除済み・存在しない subscription の場合は
 * 'already_cancelled' を返し、例外は投げない。
 */
export async function cancelSubscription(tenantId: string): Promise<CancelSubscriptionResult> {
	const repos = getRepos();
	const tenant = await repos.auth.findTenantById(tenantId);

	if (!tenant?.stripeSubscriptionId) {
		logger.info(`[STRIPE] cancelSubscription skipped (no subscription): tenant=${tenantId}`);
		return { status: 'not_subscribed' };
	}

	// Stripe が無効な場合、subscription が存在するのにキャンセルできない
	// → 課金継続クレームの温床になるため例外で中断する (#741 Copilot [must])
	if (!isStripeEnabled()) {
		const msg = `[STRIPE] Cannot cancel subscription ${tenant.stripeSubscriptionId}: Stripe is disabled but tenant has active subscription`;
		logger.error(msg);
		throw new Error(msg);
	}

	const subscriptionId = tenant.stripeSubscriptionId;
	const stripe = getStripeClient();

	try {
		await stripe.subscriptions.cancel(subscriptionId);
		logger.info(
			`[STRIPE] Subscription cancelled: tenant=${tenantId} subscription=${subscriptionId}`,
		);
		return { status: 'cancelled', subscriptionId };
	} catch (err) {
		// Stripe returns 'resource_missing' when the subscription is already gone
		if (isResourceMissing(err)) {
			logger.info(
				`[STRIPE] Subscription already cancelled: tenant=${tenantId} subscription=${subscriptionId}`,
			);
			return { status: 'already_cancelled', subscriptionId };
		}
		logger.error(`[STRIPE] Subscription cancel failed: tenant=${tenantId}`, {
			error: String(err),
		});
		throw err;
	}
}

// ============================================================
// 期末解約 / 解約取り消し (#3991 — FR-1 / NFR-2)
// ============================================================

/**
 * Stripe 上の「解約予約」状態 (#3991)。
 *
 * **「解約申請中か」の SSOT は Stripe の `cancel_at_period_end`** であり、DB の
 * `families.status` ではない (NFR-2: webhook が SSOT)。DB に別途フラグを持たせると、
 * `grace_period` が「支払い失敗の猶予」と「解約申請の猶予」を兼ねて壊れた #3986 と
 * 同じ多重定義をもう 1 本作ることになる。
 */
export interface SubscriptionCancellationState {
	subscriptionId: string;
	/** 期末解約が予約されているか */
	cancelAtPeriodEnd: boolean;
	/** 現在の請求期間の終了日時 (ISO)。予約中はこの日時まで有料機能を使える */
	currentPeriodEnd: string;
}

export type ScheduleCancellationResult =
	| { status: 'scheduled'; state: SubscriptionCancellationState }
	| { status: 'already_scheduled'; state: SubscriptionCancellationState }
	| { status: 'not_subscribed' };

export type ResumeSubscriptionResult =
	| { status: 'resumed'; state: SubscriptionCancellationState }
	| { status: 'not_scheduled'; state: SubscriptionCancellationState }
	| { status: 'not_subscribed' };

/**
 * 期間終了日時を Stripe subscription から解決する。
 *
 * apiVersion `2026-04-22.dahlia` では `current_period_end` は Subscription 直下ではなく
 * **subscription item** に載る (Stripe API 2025-03-31 の破壊的変更)。複数 item を持つ
 * 契約 (#3980 で異常として検知する形) でも「最後に切れる期間」を採れば顧客に不利にならないため
 * max を採る。
 */
function resolveCurrentPeriodEnd(subscription: Stripe.Subscription): string {
	const ends = (subscription.items?.data ?? [])
		.map((item) => (item as unknown as { current_period_end?: number }).current_period_end)
		.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	// item から取れない契約 (Stripe 側の予期しない payload) では `cancel_at` を最後の拠り所にする。
	const fallback = typeof subscription.cancel_at === 'number' ? subscription.cancel_at : undefined;
	const epochSeconds = ends.length > 0 ? Math.max(...ends) : fallback;
	// 解決できない場合は「不明な期限」を偽の日付で埋めない。呼び出し側が空文字で分岐できるようにする。
	return epochSeconds === undefined ? '' : new Date(epochSeconds * 1000).toISOString();
}

/** Stripe が「その subscription はもう存在しない」と返したか (`resource_missing`) */
function isResourceMissing(err: unknown): boolean {
	const code =
		(err as { code?: string; raw?: { code?: string } })?.code ??
		(err as { raw?: { code?: string } })?.raw?.code;
	return code === 'resource_missing';
}

function toCancellationState(subscription: Stripe.Subscription): SubscriptionCancellationState {
	return {
		subscriptionId: subscription.id,
		cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
		currentPeriodEnd: resolveCurrentPeriodEnd(subscription),
	};
}

/**
 * テナントの現行 subscription を Stripe から取得する。
 *
 * subscription を持たない / Stripe 無効 / Stripe 上に既に存在しない場合は `undefined`。
 * 「解約申請中か」の判定は必ずここを通す (DB の status を判定に使わない、NFR-2)。
 */
async function retrieveTenantSubscription(
	tenantId: string,
): Promise<Stripe.Subscription | undefined> {
	const tenant = await getRepos().auth.findTenantById(tenantId);
	if (!tenant?.stripeSubscriptionId) return undefined;
	if (!isStripeEnabled()) {
		// #741 と同じ判断: subscription があるのに Stripe を叩けない状態を成功として扱わない。
		const msg = `[STRIPE] Cannot read subscription ${tenant.stripeSubscriptionId}: Stripe is disabled but tenant has active subscription`;
		logger.error(msg);
		throw new Error(msg);
	}
	try {
		return await getStripeClient().subscriptions.retrieve(tenant.stripeSubscriptionId);
	} catch (err) {
		if (isResourceMissing(err)) {
			logger.info(
				`[STRIPE] Subscription not found on Stripe: tenant=${tenantId} subscription=${tenant.stripeSubscriptionId}`,
			);
			return undefined;
		}
		throw err;
	}
}

/**
 * 解約申請の現在状態を返す (#3991)。UI が「解約申請中 / 利用できる最終日」を出すための唯一の入口。
 *
 * 契約が無い (未購読 / 期末到来後) 場合は `null`。
 */
export async function getCancellationState(
	tenantId: string,
): Promise<SubscriptionCancellationState | null> {
	// #3991: dev 限定 override。ローカル backend は Stripe を持たないため、
	// これが無いと解約手続き中バナーを一度も目視検証できない (#758 DEBUG_PLAN と同型、本番無効)。
	const debugPeriodEnd = getDebugCancelAtPeriodEnd();
	if (debugPeriodEnd) {
		return {
			subscriptionId: 'sub_debug',
			cancelAtPeriodEnd: true,
			currentPeriodEnd: debugPeriodEnd,
		};
	}
	const subscription = await retrieveTenantSubscription(tenantId);
	return subscription ? toCancellationState(subscription) : null;
}

/**
 * 解約を**期末解約として予約**する (#3991 FR-1) — アプリ内解約の正経路。
 *
 * 旧実装は `stripe.subscriptions.cancel()` で即時キャンセルしていた。即時キャンセルは
 * `customer.subscription.deleted` を直後に発火させるため、#784 が約束した「解約後の取り消し」が
 * 一度も成立せず、かつ特商法表示「解約後は現在の請求期間終了まで引き続きご利用いただけます」
 * とも一致していなかった。
 */
export async function scheduleCancellationAtPeriodEnd(
	tenantId: string,
): Promise<ScheduleCancellationResult> {
	const subscription = await retrieveTenantSubscription(tenantId);
	if (!subscription) {
		logger.info(`[STRIPE] scheduleCancellation skipped (no subscription): tenant=${tenantId}`);
		return { status: 'not_subscribed' };
	}

	if (subscription.cancel_at_period_end === true) {
		// 二重申請は Stripe 状態を変えずに冪等に返す (再送・二重クリック対策)。
		return { status: 'already_scheduled', state: toCancellationState(subscription) };
	}

	const updated = await getStripeClient().subscriptions.update(subscription.id, {
		cancel_at_period_end: true,
	});
	const state = toCancellationState(updated);
	logger.info(
		`[STRIPE] Cancellation scheduled at period end: tenant=${tenantId} subscription=${state.subscriptionId} periodEnd=${state.currentPeriodEnd}`,
	);
	return { status: 'scheduled', state };
}

/**
 * 期末解約の予約を取り消す (#3991) — #784 が約束していた「解約の取り消し」の実体。
 *
 * 契約は生きたままなので Checkout をやり直す必要がない。DB は一切書き換えない
 * (status は解約申請中も `active` のままであり、変える必要が無い)。
 */
export async function resumeSubscription(tenantId: string): Promise<ResumeSubscriptionResult> {
	const subscription = await retrieveTenantSubscription(tenantId);
	if (!subscription) {
		logger.info(`[STRIPE] resumeSubscription skipped (no subscription): tenant=${tenantId}`);
		return { status: 'not_subscribed' };
	}

	if (subscription.cancel_at_period_end !== true) {
		// #3986: 支払い失敗で dunning 中 (status=grace_period) のテナントはここで止まる。
		// 旧実装は DB の `status === grace_period` を「解約申請中」と読んでいたため、
		// dunning 中のテナントが本 API を通過して ACTIVE に戻り、未払いのまま有料機能が復活していた。
		return { status: 'not_scheduled', state: toCancellationState(subscription) };
	}

	const updated = await getStripeClient().subscriptions.update(subscription.id, {
		cancel_at_period_end: false,
	});
	logger.info(`[STRIPE] Cancellation reverted: tenant=${tenantId} subscription=${subscription.id}`);
	return { status: 'resumed', state: toCancellationState(updated) };
}

// ============================================================
// Webhook Processing
// ============================================================

export async function verifyWebhookSignature(
	body: string | Buffer,
	signature: string,
): Promise<Stripe.Event> {
	const stripe = getStripeClient();
	return stripe.webhooks.constructEvent(body, signature, getWebhookSecret());
}

/**
 * 「処理中」のまま放置された処理権を、死んだものとみなして引き取るまでの時間 (分、#4128)。
 *
 * insert-first にすると、処理権を取った直後に Lambda が死ぬと `'processing'` の row が残り、
 * 以後の再送がすべて dedup されて event が恒久的に失われる。これを避けるため一定時間で
 * 引き取り可能にする。
 *
 * 15 分は Lambda の最大実行時間 (15 分) と同じで、**正常に走っている処理を横から奪わない**
 * 下限。Stripe の再送は 3 日続くため、この待ち時間で復旧機会を失うことはない。
 */
export const WEBHOOK_CLAIM_STALE_MINUTES = 15;

/**
 * Stripe webhook の単一 dedup 点 (#3985)。
 *
 * Stripe の at-least-once delivery では **同一 `event.id` の再到達が正規動作**
 * (<https://docs.stripe.com/webhooks#handle-duplicate-events>)。dedup が無いと
 * welcome メール 2 通 / past_due ↔ active の振動 / 解約 → 再活性化の振動が素通しになる。
 *
 * dedup は event 型ごとに分散させず **dispatcher 入口 1 箇所**で行う
 * (設計 SSOT: `billing-redesign/phase5-webhook-idempotency-architecture.md` §2 / §4.1)。
 * 新しい event 型が増えても dedup の書き忘れが構造的に起きない。
 *
 * 処理順序と失敗時の保証 (#4128 で insert-first 化):
 *
 * 1. **先に処理権を取る** (`claim`)。取れなければ **handler を呼ばず** retry_count を +1 して
 *    return する。呼び出し元 (`+server.ts`) は 200 を返す (4xx/5xx は Stripe の retry を誘発
 *    する、§2)。
 *    - 旧実装は `findByEventId` → handler → `insert` の 3 段で、find と insert の間の await
 *      境界を同一 event.id が 2 通すり抜けると handler が二重実行された。しかも `insert` は
 *      `ON CONFLICT DO NOTHING` なので**痕跡が残らない**。処理権の取得を 1 文に閉じ込め、
 *      勝者を DB の原子性で決める。
 * 2. 処理権を得た側だけが handler を実行し、完了後に `finalize` で結果を確定する。
 *    - handler が throw した場合は `releaseClaim` で row を消してから例外を伝播する。
 *      次回到達で再処理され、呼び出し元は 500 を返して Stripe の retry に載る。
 *    - 設計書 §4.2 の選択肢 A (handler 失敗時も row を残し 200 を返す) は**採らない**。
 *      A は一過性の障害 (DB / Stripe API の瞬断) で event を恒久的に失う。実際 2026-07-26 の
 *      配信失敗 22 分は Stripe の再送で復旧しており、retry 経路を潰す副作用の方が大きい。
 *      結果として `stripe_webhook_events` は「**完了した** event の台帳」を意味する。
 * 3. 解放そのものが失敗した場合 (Lambda kill / DB 断) は `'processing'` の row が残るが、
 *    `WEBHOOK_CLAIM_STALE_MINUTES` 経過後は次の到達が引き取る。これが無いと insert-first は
 *    「一度掴んで死んだ event を永久に捨てる」機構になってしまう。
 *
 * 単一 tenant の契約状態を書く側のガード (event 対象と現行契約の突合) は別レイヤーの防御であり、
 * 本 dedup はそれを代替しない (逆も同じ)。
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
	const webhookEvents = getRepos().webhookEvent;
	const claimedAt = new Date();
	const staleClaimBefore = new Date(
		claimedAt.getTime() - WEBHOOK_CLAIM_STALE_MINUTES * 60_000,
	).toISOString();

	const claimed = await webhookEvents.claim(
		{
			eventId: event.id,
			eventType: event.type,
			processedAt: claimedAt.toISOString(),
			handlerResult: 'processing',
			errorMessage: null,
			retryCount: 0,
			tenantId: resolveEventTenantId(event),
		},
		staleClaimBefore,
	);

	if (!claimed) {
		await webhookEvents.incrementRetryCount(event.id);
		const existing = await webhookEvents.findByEventId(event.id);
		logger.info(
			`[STRIPE] Duplicate webhook event skipped: ${event.id} type=${event.type} ` +
				`retry=${existing?.retryCount ?? 'unknown'} firstResult=${existing?.handlerResult ?? 'unknown'}`,
		);
		return;
	}

	let handlerResult: 'success' | 'skipped';
	try {
		handlerResult = await dispatchWebhookEvent(event);
	} catch (err) {
		// 掴んだままにすると次回到達が dedup され、Stripe の再送で復旧する経路を自分で潰す。
		// 解放自体が失敗しても throw は握り潰さない (stale claim の引き取りが最後の逃げ道)。
		try {
			await webhookEvents.releaseClaim(event.id);
		} catch (releaseErr) {
			logger.error(
				`[STRIPE] 処理権の解放に失敗しました (${WEBHOOK_CLAIM_STALE_MINUTES} 分後に stale claim として引き取られます): ` +
					`${event.id} ${releaseErr instanceof Error ? releaseErr.message : String(releaseErr)}`,
			);
		}

		// 台帳に残さず再 throw する (§4.2) 以上、失敗の観測は Stripe の再送が尽きる前に
		// 人に届く必要がある。Stripe は 3 日で配信を諦めるため、log だけでは
		// 「誰も気づかないまま課金 event が消える」経路が残る。
		//
		// 初回失敗の時点で alert する (N 回まで待たない)。同一 event.id の反復は
		// `sendDiscordAlert` の throttle (errorSummary key / 5 分 window / 3 件でまとめ通知)
		// が抑制するため、新規の計数機構を持たない。
		notifyStripeAlert({
			kind: 'stripe-webhook-handler-failed',
			message: `webhook handler が失敗 (台帳に残さず Stripe の再送に載せる): ${event.type}`,
			errorSummary: `webhook-handler-failed:${event.id}`,
			tags: {
				eventId: event.id,
				eventType: event.type,
				error: err instanceof Error ? err.message : String(err),
			},
		});
		throw err;
	}

	await webhookEvents.finalize(event.id, handlerResult, new Date().toISOString());
}

/**
 * event 型ごとの handler dispatch (dedup 判定を通過した初回到達のみ到達する)。
 *
 * @returns 未購読 event 型なら `'skipped'`、購読済なら `'success'` (例外は伝播する)
 */
async function dispatchWebhookEvent(event: Stripe.Event): Promise<'success' | 'skipped'> {
	switch (event.type) {
		case 'checkout.session.completed':
			await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
			return 'success';
		case 'invoice.paid':
			await handleInvoicePaid(event.data.object as Stripe.Invoice);
			return 'success';
		case 'invoice.payment_failed':
			await handlePaymentFailed(event.data.object as Stripe.Invoice);
			return 'success';
		case 'customer.subscription.updated':
			await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
			return 'success';
		case 'customer.subscription.deleted':
			await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
			return 'success';
		default:
			logger.info(`[STRIPE] Unhandled event type: ${event.type}`);
			return 'skipped';
	}
}

/**
 * dedup row の analytics 属性 `tenant_id` を payload から解決する (解決不能なら null)。
 *
 * PII は載せない (interface SSOT)。tenant を payload に持つのは checkout のみで、他の event 型は
 * subscription / customer から DB 逆引きする必要があるため、ここでは解決しない。
 */
function resolveEventTenantId(event: Stripe.Event): string | null {
	if (event.type === 'checkout.session.completed') {
		return (event.data.object as Stripe.Checkout.Session).metadata?.tenantId ?? null;
	}
	return null;
}

// ============================================================
// Checkout Reconciliation (#3958)
// ============================================================

/** Stripe Checkout Session ID の形式 (`cs_test_…` / `cs_live_…`)。 */
const CHECKOUT_SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{8,255}$/;

/**
 * 支払いが確定したとみなす `payment_status`。
 * 100% OFF クーポン適用時の subscription checkout は `no_payment_required` で完了する
 * (`handleCheckoutCompleted` も同じ session を通常購入として扱う、#803)。
 */
const PAID_PAYMENT_STATUSES: readonly string[] = ['paid', 'no_payment_required'];

/**
 * checkout 完了を `success_url` の `session_id` から照合して反映する (#3958)。
 *
 * webhook (`checkout.session.completed`) が唯一の反映経路だったため、webhook が 1 通落ちると
 * 顧客は支払い済みのまま無料プランに据え置かれ、**自力で復旧する手段が無かった**
 * (2026-07-26 本番 incident、root cause は #3957)。本経路は顧客自身の画面復帰を救済経路にする。
 *
 * 設計上の制約:
 * - 照合は必ずサーバー側で Stripe API に問い合わせる。`session_id` は URL に露出するため、
 *   ブラウザからの申告 (payment_status / plan / tenantId) を一切信用しない
 * - 反映の書き込みは webhook handler (`handleCheckoutCompleted`) に合流させる。契約状態の
 *   書き手を増やさない (二重実装 = 片方だけ直る不整合の温床)
 * - 冪等は「反映前に現契約と突合し、一致していれば何もしない」で担保する。webhook 先着 /
 *   同じ URL の再訪 / リロードのいずれも `already_applied` に落ちる
 * - 例外は投げない。`session_id` が不正でも既存のプラン表示にフォールバックさせる (AC)
 */
export async function reconcileCheckoutSession(input: {
	tenantId: string;
	sessionId: string;
}): Promise<CheckoutReconciliationResult> {
	const { tenantId, sessionId } = input;
	if (!isStripeEnabled()) return { status: 'unavailable' };

	if (!CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) {
		logger.warn(`[STRIPE] reconcile: malformed session_id for tenant=${tenantId}`);
		return { status: 'not_found' };
	}

	let session: Stripe.Checkout.Session;
	try {
		session = await getStripeClient().checkout.sessions.retrieve(sessionId);
	} catch (err) {
		// resource_missing (期限切れ / 存在しない) も API 障害も、顧客には同じ
		// 「反映できなかった」で返す。500 にすると既存のプラン表示ごと落ちる。
		logger.warn(`[STRIPE] reconcile: session retrieve failed tenant=${tenantId}`, {
			error: String(err),
		});
		return { status: 'not_found' };
	}

	// 他人の session_id を URL に貼っても契約が付与されないことを保証する境界。
	if (session.metadata?.tenantId !== tenantId) {
		logger.warn(
			`[STRIPE] reconcile: tenant mismatch — session belongs to another tenant (requested by tenant=${tenantId})`,
		);
		return { status: 'tenant_mismatch' };
	}

	if (!PAID_PAYMENT_STATUSES.includes(session.payment_status)) {
		logger.info(
			`[STRIPE] reconcile: not paid yet tenant=${tenantId} payment_status=${session.payment_status}`,
		);
		return { status: 'pending' };
	}

	const tenant = await getRepos().auth.findTenantById(tenantId);
	if (!tenant) return { status: 'not_found' };

	const subscriptionId =
		typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
	const desiredPlan = (session.metadata?.planId as Tenant['plan']) ?? SUBSCRIPTION_PLAN.MONTHLY;
	// 冪等判定。subscription が確定していればそれが最も強い同一性の根拠、無い場合のみ
	// plan / status の一致で代替する。
	const alreadyApplied = subscriptionId
		? tenant.stripeSubscriptionId === subscriptionId
		: tenant.status === SUBSCRIPTION_STATUS.ACTIVE && tenant.plan === desiredPlan;
	if (alreadyApplied) {
		logger.info(`[STRIPE] reconcile: already applied tenant=${tenantId}`);
		return { status: 'already_applied' };
	}

	// 既存 binding があり、session が別の subscription を指す場合は反映しない。
	// reconcile は binding を「埋める / 確認する」だけで、「差し替える」権限を持たない。
	if (
		tenant.stripeSubscriptionId &&
		subscriptionId &&
		tenant.stripeSubscriptionId !== subscriptionId
	) {
		logger.warn(
			`[STRIPE] reconcile: 既存 binding と別 subscription のため反映しません: tenant=${tenantId} current=${tenant.stripeSubscriptionId} session=${subscriptionId}`,
		);
		return { status: 'unresolved' };
	}

	// #4081: `handleCheckoutCompleted` (assign-contract) は「checkout.session.completed は
	// 購入時に 1 回だけ配信される」前提で突合を行わない。reconcileCheckoutSession はこの前提を
	// 「顧客が success_url を何度でも再訪できる経路」に接続しているため、以下の replay で
	// 二重課金が成立し得る:
	//   - 解約済みテナント (stripeSubscriptionId=null) が古い session_id を再訪 → 契約が復活する
	//   - 再購読済みテナント (stripeSubscriptionId=sub_new) が古い session_id を再訪 →
	//     現行契約が古い subscription で上書きされ、`createCheckoutSession()` の
	//     ALREADY_SUBSCRIBED ガードが外れて二重課金の温床になる
	// session が指す subscription を Stripe から re-retrieve し、終端状態
	// (canceled / incomplete_expired、#3982 `isSubscriptionTerminal` と同一基準) なら
	// handleCheckoutCompleted に合流させない。
	if (subscriptionId) {
		let subscription: Stripe.Subscription;
		try {
			subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
		} catch (err) {
			logger.warn(`[STRIPE] reconcile: subscription retrieve failed tenant=${tenantId}`, {
				error: String(err),
			});
			return { status: 'not_found' };
		}
		if (isSubscriptionTerminal(subscription)) {
			logger.warn(
				`[STRIPE] reconcile: subscription が終端状態 (${subscription.status}) のため反映しません: ` +
					`tenant=${tenantId} subscription=${subscriptionId}`,
			);
			return { status: 'unresolved' };
		}
	}

	await handleCheckoutCompleted(session);
	// hooks.server.ts が解決済みの entitlement / planTier は本 request 内で古くなる。
	// 破棄しないと「反映したのに画面は無料プランのまま」という本 Issue の症状が残る。
	invalidateRequestCaches(tenantId);

	logger.info(`[STRIPE] reconcile: applied via success_url tenant=${tenantId}`);
	return { status: 'applied' };
}

// --- Webhook handlers ---

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
	const tenantId = session.metadata?.tenantId;
	if (!tenantId) {
		logger.warn('[STRIPE] checkout.session.completed without tenantId in metadata');
		return;
	}

	const planId = session.metadata?.planId;
	const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
	const subscriptionId =
		typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

	// entitlement (Stripe Subscription) を確定する。
	// `tenant.status=ACTIVE` + `plan` が有料機能の唯一の SSOT であり、
	// 認可は `tenant.stripeSubscriptionId` + `tenant.status` から計算される
	// (license key を読まない)。Phase 1 補強 3 §3.3 でライセンスキー発行 +
	// メール送信の冗長層 (issueLicenseKey / sendLicenseKeyEmail) を削除した。
	//
	// #3960: `planId` は自前で `metadata` に載せた値なので通常必ず解決するが、
	// 旧 silent fallback (`?? MONTHLY`) は「未知の planId が来たらスタンダードとして
	// 課金確定する」挙動だった。未知値は plan を書かずに alert を上げ、
	// status のみ ACTIVE にする (support で正しい plan を確定させる)。
	const plan = isKnownPlanId(planId) ? planId : null;
	if (!plan) {
		notifyStripeAlert({
			kind: 'stripe-plan-unresolved',
			message: `checkout.session.completed の metadata.planId が未知のため plan を更新しませんでした (status のみ ACTIVE)`,
			errorSummary: `plan_unresolved:checkout.session.completed:${session.id}`,
			tags: { tenantId, event: 'checkout.session.completed', receivedPlanId: String(planId) },
		});
	}
	// checkout は契約を**新規割り当て**する event なので突合対象がまだ存在しない (#4026)。
	await applyTenantContractState(
		{ tenantId, stripeSubscriptionId: undefined },
		{ mode: 'assign-contract' },
		'checkout.session.completed',
		() => ({
			stripeCustomerId: customerId ?? undefined,
			stripeSubscriptionId: subscriptionId ?? undefined,
			plan: plan ?? undefined,
			status: SUBSCRIPTION_STATUS.ACTIVE,
			trialUsedAt: new Date().toISOString(),
		}),
	);

	logger.info(
		`[STRIPE] Checkout completed: tenant=${tenantId} customer=${customerId} subscription=${subscriptionId}`,
	);

	// #4192: 課金**成功**の Discord 通知は持たないと決めた (#4174 Q2)。上の logger.info が事実を残す。
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
	const subscriptionId = extractSubscriptionId(invoice);
	if (!subscriptionId) return;

	const context = await resolveSubscriptionContext(subscriptionId);
	if (!context) {
		logger.warn(`[STRIPE] invoice.paid — tenant not found for subscription=${subscriptionId}`);
		return;
	}
	const { tenant, subscription } = context;

	// #3982: Stripe は配信順序を保証しないため、解約後に当期分の invoice.paid が**後着**し得る。
	// `subscription` は Stripe から retrieve した現行状態なので、terminal ならその契約は
	// 二度と復活しない (Stripe 仕様)。ここで ACTIVE を書くと `customer.subscription.deleted` が
	// 確定させた終端状態を巻き戻し、**解約済みテナントが課金中として復活する**。
	// 到着順に依らず終端へ収束させるため skip する (#3960 と同じ「現行 subscription が SSOT」原則)。
	if (isSubscriptionTerminal(subscription)) {
		logger.warn(
			`[STRIPE] invoice.paid — subscription が終端状態 (${subscription.status}) のため状態を更新しません: ` +
				`tenant=${tenant.tenantId} subscription=${subscription.id}`,
		);
		return;
	}

	// #3960: plan は invoice の line item から推測せず、**subscription の現行 price** を SSOT とする。
	//
	// 旧実装は `invoice.lines.data[0]` を盲目参照していた。プラン変更 (proration) の invoice は
	// 複数行になり、`data[0]` は「変更前プランの未使用分クレジット行」であるため、
	// スタンダード → プレミアムの変更で `plan=monthly` (変更前) を書き込んでいた。
	// Stripe は `customer.subscription.updated` と `invoice.paid` の配信順序を保証しないので、
	// invoice.paid が後着すると正しく書かれた plan を巻き戻すレースになる (#3960 実測)。
	// subscription を SSOT にすれば、どちらの順序でも最終状態は現行 price に収束する。
	const plan = resolvePlanFromSubscription(subscription);

	const applied = await applyTenantContractState(
		tenant,
		// ここに到達する時点で終端でないことは上で確定済 (#4077 観測レベルの出し分けに使う)
		{ mode: 'current-contract', subscriptionId: subscription.id, subscriptionTerminal: false },
		'invoice.paid',
		() => ({
			status: SUBSCRIPTION_STATUS.ACTIVE,
			// #4118: 猶予終了日を消す。支払い失敗で `grace_period` + `planExpiresAt` が書かれた
			// テナントが支払い成功で復帰するとき、期限だけ残すと **契約は生きているのに期限がある**
			// (contract-state-matrix X3 =「dunning の残骸」) になる。この列を読む導出値は
			// 支払い済みの顧客に「あと N 日で使えなくなります」と表示しうる。
			// status を戻すなら、その status が持ってはいけない列も同時に落とす。
			planExpiresAt: null,
			// #3960: plan 未解決時は silent fallback せず **既存 plan を保持** する
			// (`plan: undefined` は repo 実装で「更新しない」として扱われる)。
			...planUpdateOrKeep(plan, tenant, 'invoice.paid', subscription.id),
		}),
	);
	if (!applied) return;

	logger.info(`[STRIPE] Invoice paid: tenant=${tenant.tenantId} plan=${plan ?? 'unresolved'}`);

	// #4192: 支払い成功の Discord 通知は持たないと決めた (#4174 Q2)。
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
	const subscriptionId = extractSubscriptionId(invoice);
	if (!subscriptionId) return;

	const context = await resolveSubscriptionContext(subscriptionId);
	if (!context) {
		logger.warn(
			`[STRIPE] invoice.payment_failed — tenant not found for subscription=${subscriptionId}`,
		);
		return;
	}
	const { tenant, subscription } = context;

	// #3982: invoice.paid と同様、解約後に後着した payment_failed で
	// 終端状態 (suspended + subscription 参照なし) を grace_period へ巻き戻さない。
	if (isSubscriptionTerminal(subscription)) {
		logger.warn(
			`[STRIPE] invoice.payment_failed — subscription が終端状態 (${subscription.status}) のため状態を更新しません: ` +
				`tenant=${tenant.tenantId} subscription=${subscription.id}`,
		);
		return;
	}

	// #3986 / #3991: `grace_period` の書き手は **支払い失敗 (dunning) 経路だけ** に一意化された。
	// 旧実装では `/api/v1/admin/tenant/cancel` も同じ値を書いていたため、`grace_period` は
	// 「支払い失敗の猶予」と「解約申請の猶予」の 2 概念を兼ね、`reactivate` が両者を区別できず
	// **dunning 中のテナントが未払いのまま ACTIVE に戻せる**状態になっていた。
	// 案 A (期末解約) で解約申請の SSOT が Stripe の `cancel_at_period_end` に移り、
	// 解約経路は DB status を一切書かなくなった。以後この状態を書いてよいのは本 handler と、
	// 同じ dunning を表す `handleSubscriptionUpdated` の `past_due` 分岐だけである
	// (いずれも #4077 の単一強制点 `applyTenantContractState` を経由する)。
	const graceExpires = new Date(Date.now() + GRACE_PERIOD_DAYS * MS_PER_DAY).toISOString();
	const applied = await applyTenantContractState(
		tenant,
		// 同上: 終端は上で早期 return 済
		{ mode: 'current-contract', subscriptionId: subscription.id, subscriptionTerminal: false },
		'invoice.payment_failed',
		() => ({
			status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
			planExpiresAt: graceExpires,
		}),
	);
	if (!applied) return;

	logger.warn(`[STRIPE] Payment failed: tenant=${tenant.tenantId}, grace until ${graceExpires}`);

	// #4192 / #4174 Q2:「課金の**失敗**は incident に含めるべきで、成功は通知不要」。billing チャネルは
	// 落としたが、支払い失敗だけは運用者が行動を変える事象なので incident 側の単一チャネルに残す。
	// **tenantId は載せない** (#4174 Q3) — どの家族かは上の logger.warn (tenant= 付き) から引く。
	notifyStripeAlert({
		kind: 'stripe-payment-failed',
		message: '支払いが失敗し猶予期間に入りました (対象は CloudWatch Logs / Stripe で確認)',
		errorSummary: 'stripe-payment-failed',
	});
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
	const tenantId = subscription.metadata?.tenantId;
	const tenant = tenantId
		? await getRepos().auth.findTenantById(tenantId)
		: (await resolveSubscriptionContext(subscription.id))?.tenant;
	if (!tenant) return;

	// #3982: `customer.subscription.deleted` と `customer.subscription.updated` (status=canceled) は
	// 解約時に**両方**飛び、Stripe は到着順を保証しない。updated 側が後着したときに plan だけ
	// 書き戻すと「subscription 参照なし・plan あり」という DB 上ありえない組み合わせが残る。
	// canceled は Stripe 上 revert しない終端状態なので、**deleted と同じ終端状態へ収束**させる。
	// これで deleted→updated / updated→deleted のどちらの順序でも最終状態が一致する。
	const terminal = isSubscriptionTerminal(subscription);
	const target = {
		mode: 'current-contract',
		subscriptionId: subscription.id,
		subscriptionTerminal: terminal,
	} as const;

	if (terminal) {
		const cleared = await applyTenantContractState(
			tenant,
			target,
			'customer.subscription.updated',
			() => TERMINAL_CONTRACT_STATE,
		);
		if (!cleared) return;
		logger.info(
			`[STRIPE] Subscription updated (terminal=${subscription.status}): ` +
				`tenant=${tenant.tenantId} — subscription 参照と plan をクリアし suspended へ収束`,
		);
		// #4192: プラン変更の Discord 通知は持たないと決めた (#4174 Q2)。上の logger.info が事実を残す。
		return;
	}

	const plan = resolvePlanFromSubscription(subscription);

	// Stripe SDK 側の subscription.status ('active'|'trialing'|'past_due'|…) を
	// アプリ内部の SUBSCRIPTION_STATUS に正規化する。
	const status: Tenant['status'] =
		subscription.status === 'active' || subscription.status === 'trialing'
			? SUBSCRIPTION_STATUS.ACTIVE
			: subscription.status === 'past_due'
				? SUBSCRIPTION_STATUS.GRACE_PERIOD
				: SUBSCRIPTION_STATUS.SUSPENDED;

	// #4055: 終端判定は payload の status を見るため、`deleted` の後に非終端の `updated`
	// (例 status=active) が後着すると、この分岐に入る。突合 (#4026) が
	// 「割り当て済みの契約でない」として弾くので、終端状態が巻き戻らない。
	const applied = await applyTenantContractState(
		tenant,
		target,
		'customer.subscription.updated',
		() => ({
			// #3960: silent fallback (`?? MONTHLY`) 廃止。未解決時は既存 plan を保持 + alert。
			...planUpdateOrKeep(plan, tenant, 'customer.subscription.updated', subscription.id),
			status,
			// #4181: `active` に戻ったら猶予終了日を消す。
			//
			// 消さないと `status=active` + `planExpiresAt` あり = **X3 (契約が無いのに期限だけ残る)**
			// を書く (contract-state-matrix.md §4 不正状態)。`planExpiresAt` は W3
			// (`invoice.payment_failed`) が猶予終了日として書く列で、**猶予が明けたら意味を失う**。
			// 残すと dunning の残骸として後続の判定に効き続ける。
			//
			// `grace_period` は W3 が書いた期限を保持し、`suspended` は matrix で「任意」なので触らない
			// (`undefined` = 更新しない)。
			...(status === SUBSCRIPTION_STATUS.ACTIVE ? { planExpiresAt: null } : {}),
		}),
	);
	if (!applied) return;

	logger.info(`[STRIPE] Subscription updated: tenant=${tenant.tenantId} status=${status}`);

	// #4192: プラン変更の Discord 通知は持たないと決めた (#4174 Q2)。上の logger.info が事実を残す。
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
	const tenantId = subscription.metadata?.tenantId;
	const tenant = tenantId
		? await getRepos().auth.findTenantById(tenantId)
		: (await resolveSubscriptionContext(subscription.id))?.tenant;
	if (!tenant) return;

	const applied = await applyTenantContractState(
		tenant,
		// deleted は契約消滅の確定通知なので、payload の status に依らず終端として扱う (#4077)
		{ mode: 'current-contract', subscriptionId: subscription.id, subscriptionTerminal: true },
		'customer.subscription.deleted',
		() => TERMINAL_CONTRACT_STATE,
	);
	if (!applied) return;

	logger.info(`[STRIPE] Subscription deleted: tenant=${tenant.tenantId}`);

	// #4192: 解約 (subscription 消滅) の Discord 通知は持たないと決めた (#4174 Q2)。
}

// ============================================================
// Helpers
// ============================================================

/**
 * Stripe subscription の **終端状態** (#3982)。
 *
 * この 2 値は Stripe 上で二度と他の status に戻らない (公式: Subscription lifecycle)。
 * よって「この subscription はもう契約として存在しない」ことが確定した印として使える。
 *
 * Stripe は webhook の配信順序を保証しないため、解約後に `invoice.paid` /
 * `invoice.payment_failed` / `customer.subscription.updated` が後着し得る。
 * 終端状態を検出したハンドラは、契約ありきの状態 (ACTIVE / GRACE_PERIOD / plan) を
 * **書き戻さない**。これにより到着順に依らず最終状態が一致する。
 *
 * `paused` / `unpaid` / `incomplete` は復帰し得るため終端に含めない。
 */
const TERMINAL_SUBSCRIPTION_STATUSES = [
	'canceled',
	'incomplete_expired',
] as const satisfies readonly Stripe.Subscription.Status[];

function isSubscriptionTerminal(subscription: Stripe.Subscription): boolean {
	return (TERMINAL_SUBSCRIPTION_STATUSES as readonly string[]).includes(subscription.status);
}

// ============================================================
// 契約状態の単一強制点 (#4026)
// ============================================================

/** 契約状態 (families の status / plan / stripe_subscription_id / plan_expires_at) の更新差分 */
type TenantContractStatePatch = Parameters<
	ReturnType<typeof getRepos>['auth']['updateTenantStripe']
>[1];

/**
 * 解約が確定した契約の**終端状態** (contract-state-matrix.md S5、#4026)。
 *
 * 「終端」を handler ごとに列挙すると、書き忘れた列が孤児として残る。実際に
 * `/api/v1/admin/tenant/cancel` が `status=grace_period` + `planExpiresAt=+30d` を書いた直後の
 * `deleted` は `planExpiresAt` を書かず、**契約が無いのに期限だけ残る** (X3) 状態を作っていた。
 * 終端状態は列の集合として 1 箇所で定義し、全列を網羅的に書く。
 *
 * `stripeCustomerId` は意図的に残す: 同一顧客の再購読で Stripe customer を再利用するため
 * (`resolveSubscriptionContext` の customer 逆引きの鍵でもあり、消すと後続 webhook が
 * tenant を解決できなくなる)。
 */
const TERMINAL_CONTRACT_STATE = {
	stripeSubscriptionId: null,
	plan: null,
	status: SUBSCRIPTION_STATUS.SUSPENDED,
	planExpiresAt: null,
} as const satisfies TenantContractStatePatch;

/**
 * 契約状態の書き換えが「どの契約に対する event か」(#4026)。
 *
 * - `current-contract`: 既存契約に対する後続 event。**tenant の現行 subscription と一致する
 *   ときだけ適用する**。Stripe は配信順序を保証せず、tenant の同定も
 *   `metadata.tenantId` / customer 逆引きで行うため、突合しないと旧 subscription の後着 event が
 *   現行契約を壊す (解約 → 再購読済み tenant の subscription 参照が NULL 化し、
 *   `createCheckoutSession()` の ALREADY_SUBSCRIBED ガードが外れて二重課金が成立し得る)。
 * - `assign-contract`: `checkout.session.completed` のみ。契約を**新規に割り当てる** event なので
 *   突合対象がまだ存在しない (突合すると新規購入が永久に適用されなくなる)。
 *
 * `subscriptionTerminal` は「その event が指す subscription が Stripe 上でもう生きていないか」
 * (#4077)。突合しなかったときの**観測レベルの出し分け**にだけ使う (適用可否は変えない)。
 */
type ContractEventTarget =
	| { mode: 'current-contract'; subscriptionId: string; subscriptionTerminal: boolean }
	| { mode: 'assign-contract' };

/**
 * **契約状態を書き換える唯一の経路** (#4026)。
 *
 * `stripe-service.ts` から `updateTenantStripe` を直接呼ぶことは
 * `tests/unit/architecture/stripe-contract-write-single-enforcement.test.ts` が禁止する。
 * これにより、新しい handler が増えても「event 対象と現行契約の突合」を迂回できない
 * (ADR-0061 fitness function — 再発防止を人の注意に依存させない)。
 *
 * `buildPatch` は**突合を通過したときだけ**評価する。差分の組み立て自体が観測を伴う
 * (`planUpdateOrKeep` は plan 未解決 alert を上げる) ため、適用しない event で
 * alert を鳴らさないための順序である。
 *
 * @returns 適用したら true、現行契約でないため skip したら false
 */
async function applyTenantContractState(
	tenant: Pick<Tenant, 'tenantId' | 'stripeSubscriptionId'>,
	target: ContractEventTarget,
	eventType: string,
	buildPatch: () => TenantContractStatePatch,
): Promise<boolean> {
	if (target.mode === 'current-contract') {
		const current = tenant.stripeSubscriptionId ?? null;
		if (current !== target.subscriptionId) {
			notifyContractTargetMismatch(tenant, target, eventType, current);
			return false;
		}
	}

	await getRepos().auth.updateTenantStripe(tenant.tenantId, buildPatch());
	return true;
}

/**
 * event 対象が現行契約でなかったことを観測可能にする (#4026 / #4077)。
 *
 * 3 つの事実を区別する。潰すと「解約済みに後着した正常な event」で alert が鳴り続け、
 * 本当に危険な mismatch が埋もれる:
 * - 割り当て無し (`null`) × 終端 event = 解約済み契約への正常な後着。**正常な skip** なので warn のみ
 * - 割り当て無し (`null`) × 非終端 event = **Stripe 上は生きている契約なのに DB に紐付いていない**。
 *   親は課金明細だけ増え、有料機能は開かないまま顧客からは原因が見えない。必ず人が介入するので alert
 *   (#4077 PO 決裁 Q1 条件。checkout webhook の恒久失敗 / Dashboard 手動作成が代表的な発生源)
 * - 別 subscription = 旧契約の後着 or tenant 同定ミス。**現行契約を壊しかけた**ので alert
 */
function notifyContractTargetMismatch(
	tenant: Pick<Tenant, 'tenantId'>,
	target: Extract<ContractEventTarget, { mode: 'current-contract' }>,
	eventType: string,
	currentSubscriptionId: string | null,
): void {
	const eventSubscriptionId = target.subscriptionId;
	logger.warn(
		`[STRIPE] ${eventType} — event 対象が tenant の現行契約ではないため状態を更新しません: ` +
			`tenant=${tenant.tenantId} eventSubscription=${eventSubscriptionId} ` +
			`currentSubscription=${currentSubscriptionId ?? 'none'}`,
	);
	// 終端 event が割り当て無しの tenant に後着するのは解約済みの正常系。鳴らさない。
	if (currentSubscriptionId === null && target.subscriptionTerminal) return;

	const unassigned = currentSubscriptionId === null;
	notifyStripeAlert({
		kind: 'stripe-contract-target-mismatch',
		message: unassigned
			? `${eventType} の subscription は Stripe 上で継続中ですが tenant に割り当てられていません (課金済み未紐付けの可能性、適用せず skip)`
			: `${eventType} が tenant の現行契約とは別の subscription を指しています (適用せず skip)`,
		errorSummary: `contract_target_mismatch:${eventType}:${eventSubscriptionId}`,
		tags: {
			tenantId: tenant.tenantId,
			event: eventType,
			eventSubscriptionId,
			currentSubscriptionId: currentSubscriptionId ?? 'none',
			mismatchKind: unassigned ? 'tenant-unassigned-live-subscription' : 'other-subscription',
		},
	});
}

/** Invoice から subscription ID を抽出（Stripe SDK v21: parent.subscription_details） */
function extractSubscriptionId(invoice: Stripe.Invoice): string | undefined {
	const subDetails = invoice.parent?.subscription_details;
	if (!subDetails) return undefined;
	const sub = subDetails.subscription;
	return typeof sub === 'string' ? sub : sub?.id;
}

/**
 * subscription ID から tenant と **Stripe 上の現行 subscription** を同時に解決する (#3960)。
 *
 * 旧 `findTenantBySubscription()` は同じ `subscriptions.retrieve()` を呼びながら
 * customer だけ取り出して subscription 本体を捨てていた。plan 判定の SSOT を
 * subscription の現行 price に寄せるため、retrieve 結果をそのまま返す
 * (Stripe API 呼び出し回数は従来と同じ 1 回)。
 */
async function resolveSubscriptionContext(
	subscriptionId: string,
): Promise<{ tenant: Tenant; subscription: Stripe.Subscription } | undefined> {
	let subscription: Stripe.Subscription;
	try {
		subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
	} catch (error) {
		notifyContextUnresolved('stripe_api_error', subscriptionId, error, 'Stripe API 障害');
		return undefined;
	}

	const customerId =
		typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
	if (!customerId) {
		// 障害ではなく payload の事実。alert は上げない。
		logger.warn(
			`[STRIPE] subscription に customer 参照がありません: subscription=${subscriptionId}`,
		);
		return undefined;
	}

	let tenant: Tenant | undefined;
	try {
		tenant = await getRepos().auth.findTenantByStripeCustomerId(customerId);
	} catch (error) {
		notifyContextUnresolved('repo_error', subscriptionId, error, 'データストア障害');
		return undefined;
	}

	if (!tenant) {
		// 本当に該当 tenant が無いケース。これは異常ではなく正常な結果 (他システムの
		// customer / 削除済みテナント) なので warn のみ。
		logger.warn(
			`[STRIPE] customer に対応する tenant が見つかりません (tenant 不在): ` +
				`subscription=${subscriptionId} customer=${customerId}`,
		);
		return undefined;
	}

	return { tenant, subscription };
}

/**
 * `resolveSubscriptionContext` の **障害** 経路を観測可能にする (#3981)。
 *
 * 旧実装は bare `catch {}` で全経路を `undefined` に潰しており、呼び出し側
 * (`handleInvoicePaid` 等) には「tenant not found」としか見えなかった。結果、
 * Stripe API 障害 / DB 障害が事実と異なるログに化け、`stripe-plan-unresolved`
 * alert も (context 解決の手前で return するため) 発火しなかった。
 *
 * 挙動は変えない — 返り値は従来どおり `undefined`。retry / fallback も入れない
 * (Stripe は webhook を再送するため、ここで retry すると二重処理の検討が要る)。
 */
function notifyContextUnresolved(
	reason: 'stripe_api_error' | 'repo_error',
	subscriptionId: string,
	error: unknown,
	label: string,
): void {
	const detail = redactPii(String(error));
	logger.error(
		`[STRIPE] subscription context の解決に失敗しました (${label}): ` +
			`subscription=${subscriptionId} reason=${reason} error=${detail}`,
	);
	notifyStripeAlert({
		kind: 'stripe-context-unresolved',
		// #3985 の dedup 台帳が入った後は、この経路の handler は「正常終了」として記録されるため
		// Stripe の再送 / Dashboard の Resend は同一 event.id で skip される。**再送では収束しない**。
		// 復旧後の手動突合手順は phase6-rollback-and-kill-switches.md R13 (恒久対策は #4108)。
		message: `${label}により subscription から tenant を解決できませんでした (再送では収束しないため復旧後に手動突合が必要)`,
		// throttle key は `path:errorSummary` (discord-alert.ts、5 分 window)。subscriptionId を
		// 含めると Stripe / DSQL の**広域**障害で subscription 数ぶん Discord に飛び、
		// 「本当に見るべき 1 件」が alert fatigue で埋没する (検知機構が検知で潰れる)。
		// reason 単位に集約する。切り分けに要る subscriptionId は tags と logger.error
		// (CloudWatch) に残るので情報は失われない。
		errorSummary: `context_unresolved:${reason}`,
		tags: { subscriptionId, reason },
	});
}

/**
 * subscription の現行 price から plan を解決する (#3960)。
 *
 * 解決順:
 *   1. `planIdFromPriceId()` — env var (`STRIPE_PRICE_*_MONTHLY`) 由来の priceId 逆引き
 *   2. `planIdFromLookupKey()` — `USE_LOOKUP_KEY=true` 経路で env var と異なる Price を
 *      指し得るため、Price object の `lookup_key` で 2 段目の逆引きを行う
 *
 * どちらでも確定できない場合は `null` を返し、呼び出し側は plan を更新しない。
 */
function resolvePlanFromSubscription(subscription: Stripe.Subscription): PlanId | null {
	const items = subscription.items?.data ?? [];

	// #3980: 先頭参照は「subscription item は常に 1 件」という現行の Stripe 商品構成
	// (checkout は単一 line_item / 2 Product × 各 1 Price) に依存している。add-on ・
	// 従量課金 item・年額 item の同居のいずれかが入った瞬間、`data[0]` が plan を表す
	// item である保証は消え、#3960 と同じ「課金は変わったのに plan は据え置き」に戻る。
	//
	// 前提が崩れたこと自体を検知する。plan 解決を lookup_key で選別するような一般化は
	// 意図的に行わない — 現に単一 item なので、検証できない分岐が増えるだけになる。
	if (items.length > 1) {
		notifyStripeAlert({
			kind: 'stripe-subscription-multi-item',
			message:
				'subscription item が複数あります。plan 解決は先頭 item を使うため、' +
				'plan を表す item が先頭でない場合は誤った plan を解決し得ます',
			errorSummary: `subscription_multi_item:${subscription.id}`,
			tags: {
				subscriptionId: subscription.id,
				itemCount: items.length,
				priceIds: items.map((item) => item.price?.id ?? 'unknown').join(','),
			},
		});
	}

	return resolvePlanFromSubscriptionItems(items);
}

/**
 * subscription item 群から plan を解決する副作用なしの実体 (#4128)。
 *
 * webhook 経路 (`resolvePlanFromSubscription`) と、/ops の滞留一覧
 * (`stripe-plan-drift-service`) が **同じ判定**を使うために切り出した。ops は読み取り
 * 専用なので、multi-item alert のような副作用を持たない側が要る (読むだけで Discord が
 * 鳴っては困る)。判定を 2 箇所に書くと「alert は出るが /ops には出ない」類の食い違いが生まれる。
 */
export function resolvePlanFromSubscriptionItems(
	items: readonly Stripe.SubscriptionItem[],
): PlanId | null {
	const price = items[0]?.price;
	if (!price) return null;
	return planIdFromPriceId(price.id) ?? planIdFromLookupKey(price.lookup_key);
}

/** `metadata.planId` 等の外部由来文字列が既知の PlanId か判定する (#3960) */
function isKnownPlanId(value: string | null | undefined): value is PlanId {
	return value === SUBSCRIPTION_PLAN.MONTHLY || value === SUBSCRIPTION_PLAN.FAMILY_MONTHLY;
}

/**
 * plan の更新差分を組み立てる (#3960 silent fallback 廃止の SSOT)。
 *
 * 解決できた場合は `{ plan }`、できなかった場合は **空オブジェクト**を返す。
 * `updateTenantStripe()` は `data.plan === undefined` を「更新しない」として扱うため、
 * 空オブジェクトを spread すれば既存 plan が保持される。
 *
 * 旧実装の `plan ?? tenant.plan ?? MONTHLY` は、解決失敗時に暗黙で
 * スタンダードへ落とす silent fallback であり、今回の課金 incident 系列
 * (#3957 / #3958 / #3960) で繰り返し現れたパターン。未解決は「観測すべき異常」として扱う。
 */
function planUpdateOrKeep(
	plan: PlanId | null,
	tenant: Tenant,
	eventType: string,
	subscriptionId: string,
): { plan?: PlanId } {
	if (plan) return { plan };

	logger.warn(
		`[STRIPE] ${eventType} — plan を解決できませんでした。既存 plan を保持します: ` +
			`tenant=${tenant.tenantId} subscription=${subscriptionId} currentPlan=${tenant.plan ?? 'none'}`,
	);
	notifyStripeAlert({
		kind: 'stripe-plan-unresolved',
		message: `${eventType} で subscription の現行 price から plan を確定できませんでした (既存 plan を保持)`,
		errorSummary: `plan_unresolved:${eventType}:${subscriptionId}`,
		tags: {
			tenantId: tenant.tenantId,
			event: eventType,
			subscriptionId,
			currentPlan: tenant.plan ?? 'none',
		},
	});
	return {};
}
