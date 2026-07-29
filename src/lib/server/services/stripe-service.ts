// src/lib/server/services/stripe-service.ts
// Stripe 決済サービス (#0131)

import type Stripe from 'stripe';
import { SUBSCRIPTION_PLAN } from '$lib/domain/constants/subscription-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { MS_PER_DAY } from '$lib/domain/constants/time';
import { CHECKOUT_LABELS, PLAN_LABELS } from '$lib/domain/labels';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { notifyBillingEvent } from '$lib/server/services/discord-notify-service';
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
 * テナントの Stripe Subscription を即時キャンセルする (#741)
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
		const errorCode =
			(err as { code?: string; raw?: { code?: string } })?.code ??
			(err as { raw?: { code?: string } })?.raw?.code;
		if (errorCode === 'resource_missing') {
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
// Webhook Processing
// ============================================================

export async function verifyWebhookSignature(
	body: string | Buffer,
	signature: string,
): Promise<Stripe.Event> {
	const stripe = getStripeClient();
	return stripe.webhooks.constructEvent(body, signature, getWebhookSecret());
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
	switch (event.type) {
		case 'checkout.session.completed':
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
		default:
			logger.info(`[STRIPE] Unhandled event type: ${event.type}`);
	}
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

	notifyBillingEvent(tenantId, 'checkout_completed', `plan=${planId}`).catch(() => {});
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
		{ mode: 'current-contract', subscriptionId: subscription.id },
		'invoice.paid',
		() => ({
			status: SUBSCRIPTION_STATUS.ACTIVE,
			// #3960: plan 未解決時は silent fallback せず **既存 plan を保持** する
			// (`plan: undefined` は repo 実装で「更新しない」として扱われる)。
			...planUpdateOrKeep(plan, tenant, 'invoice.paid', subscription.id),
		}),
	);
	if (!applied) return;

	logger.info(`[STRIPE] Invoice paid: tenant=${tenant.tenantId} plan=${plan ?? 'unresolved'}`);

	notifyBillingEvent(tenant.tenantId, 'invoice_paid', `plan=${plan ?? 'unknown'}`).catch(() => {});
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

	const graceExpires = new Date(Date.now() + GRACE_PERIOD_DAYS * MS_PER_DAY).toISOString();
	const applied = await applyTenantContractState(
		tenant,
		{ mode: 'current-contract', subscriptionId: subscription.id },
		'invoice.payment_failed',
		() => ({
			status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
			planExpiresAt: graceExpires,
		}),
	);
	if (!applied) return;

	logger.warn(`[STRIPE] Payment failed: tenant=${tenant.tenantId}, grace until ${graceExpires}`);

	notifyBillingEvent(tenant.tenantId, 'payment_failed', `猶予期間: ${graceExpires}`).catch(
		() => {},
	);
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
	const target = { mode: 'current-contract', subscriptionId: subscription.id } as const;

	if (isSubscriptionTerminal(subscription)) {
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
		notifyBillingEvent(
			tenant.tenantId,
			'subscription_updated',
			`status=${SUBSCRIPTION_STATUS.SUSPENDED}, plan=cleared`,
		).catch(() => {});
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
		}),
	);
	if (!applied) return;

	logger.info(`[STRIPE] Subscription updated: tenant=${tenant.tenantId} status=${status}`);

	notifyBillingEvent(
		tenant.tenantId,
		'subscription_updated',
		`status=${status}, plan=${plan ?? 'unknown'}`,
	).catch(() => {});
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
	const tenantId = subscription.metadata?.tenantId;
	const tenant = tenantId
		? await getRepos().auth.findTenantById(tenantId)
		: (await resolveSubscriptionContext(subscription.id))?.tenant;
	if (!tenant) return;

	const applied = await applyTenantContractState(
		tenant,
		{ mode: 'current-contract', subscriptionId: subscription.id },
		'customer.subscription.deleted',
		() => TERMINAL_CONTRACT_STATE,
	);
	if (!applied) return;

	logger.info(`[STRIPE] Subscription deleted: tenant=${tenant.tenantId}`);

	notifyBillingEvent(tenant.tenantId, 'subscription_deleted').catch(() => {});
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
 */
type ContractEventTarget =
	| { mode: 'current-contract'; subscriptionId: string }
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
			notifyContractTargetMismatch(tenant, target.subscriptionId, eventType, current);
			return false;
		}
	}

	await getRepos().auth.updateTenantStripe(tenant.tenantId, buildPatch());
	return true;
}

/**
 * event 対象が現行契約でなかったことを観測可能にする (#4026)。
 *
 * 2 つの事実を区別する。潰すと「解約済みに後着した正常な event」で alert が鳴り続け、
 * 本当に危険な「別契約の event」が埋もれる:
 * - 割り当て無し (`null`) = 契約未確立 (checkout 前) or 解約済み。**正常な skip** なので warn のみ
 * - 別 subscription = 旧契約の後着 or tenant 同定ミス。**現行契約を壊しかけた**ので alert
 */
function notifyContractTargetMismatch(
	tenant: Pick<Tenant, 'tenantId'>,
	eventSubscriptionId: string,
	eventType: string,
	currentSubscriptionId: string | null,
): void {
	logger.warn(
		`[STRIPE] ${eventType} — event 対象が tenant の現行契約ではないため状態を更新しません: ` +
			`tenant=${tenant.tenantId} eventSubscription=${eventSubscriptionId} ` +
			`currentSubscription=${currentSubscriptionId ?? 'none'}`,
	);
	if (currentSubscriptionId === null) return;

	notifyStripeAlert({
		kind: 'stripe-contract-target-mismatch',
		message: `${eventType} が tenant の現行契約とは別の subscription を指しています (適用せず skip)`,
		errorSummary: `contract_target_mismatch:${eventType}:${eventSubscriptionId}`,
		tags: {
			tenantId: tenant.tenantId,
			event: eventType,
			eventSubscriptionId,
			currentSubscriptionId,
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
	try {
		const stripe = getStripeClient();
		const subscription = await stripe.subscriptions.retrieve(subscriptionId);
		const customerId =
			typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
		if (!customerId) return undefined;
		const tenant = await getRepos().auth.findTenantByStripeCustomerId(customerId);
		if (!tenant) return undefined;
		return { tenant, subscription };
	} catch {
		return undefined;
	}
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
	const price = subscription.items?.data?.[0]?.price;
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
