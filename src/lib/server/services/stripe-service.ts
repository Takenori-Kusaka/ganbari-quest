// src/lib/server/services/stripe-service.ts
// Stripe 決済サービス (#0131)

import type Stripe from 'stripe';
import { PLAN_LABELS } from '$lib/domain/labels';
import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { notifyBillingEvent } from '$lib/server/services/discord-notify-service';
import { sendLicenseKeyEmail } from '$lib/server/services/email-service';
import { issueLicenseKey } from '$lib/server/services/license-key-service';
import { getStripeClient, isStripeEnabled } from '$lib/server/stripe/client';
import {
	CURRENCY,
	GRACE_PERIOD_DAYS,
	getPlans,
	getWebhookSecret,
	planIdFromPriceId,
} from '$lib/server/stripe/config';

// ============================================================
// Checkout Session
// ============================================================

export interface CreateCheckoutInput {
	tenantId: string;
	planId: 'monthly' | 'yearly' | 'family-monthly' | 'family-yearly';
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
	if (!plan.priceId) return { error: 'INVALID_PLAN' };

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
		custom_text: {
			submit: {
				message: 'お支払い後、すぐにすべての機能をご利用いただけます。',
			},
			after_submit: {
				message: 'アプリに戻ってすべての機能をお楽しみください。',
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

	const plan = (planId as Tenant['plan']) ?? 'monthly';
	const repos = getRepos();
	await repos.auth.updateTenantStripe(tenantId, {
		stripeCustomerId: customerId ?? undefined,
		stripeSubscriptionId: subscriptionId ?? undefined,
		plan,
		status: 'active',
		trialUsedAt: new Date().toISOString(),
	});

	// ライセンスキー発行 (#0247, #801)
	// #801: Stripe 経由の発行は常に 'purchase' 種別。buyer tenant にロックされ、
	// 同じ tenant でのみ consume 可能（返金後の他 tenant への流用を防ぐ）。
	try {
		const licenseRecord = await issueLicenseKey({
			tenantId,
			plan: plan ?? 'monthly',
			stripeSessionId: session.id,
			kind: 'purchase',
			issuedBy: `stripe:${session.id}`,
		});

		// テナントにライセンスキーを紐付け
		await repos.auth.updateTenantStripe(tenantId, { licenseKey: licenseRecord.licenseKey });

		// Stripe Customer のメールアドレスにキーを送信
		const customerEmail = session.customer_details?.email ?? session.customer_email;
		if (customerEmail) {
			sendLicenseKeyEmail(customerEmail, licenseRecord.licenseKey, plan ?? 'monthly').catch(
				(err) => {
					logger.warn('[STRIPE] License key email failed', { error: String(err) });
				},
			);
		}
	} catch (err) {
		logger.error('[STRIPE] License key issuance failed', { error: String(err) });
		// キー発行失敗でも決済自体は成功扱い（手動対応で補完可能）
	}

	logger.info(
		`[STRIPE] Checkout completed: tenant=${tenantId} customer=${customerId} subscription=${subscriptionId}`,
	);

	notifyBillingEvent(tenantId, 'checkout_completed', `plan=${planId}`).catch(() => {});
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
	const subscriptionId = extractSubscriptionId(invoice);
	if (!subscriptionId) return;

	const tenant = await findTenantBySubscription(subscriptionId);
	if (!tenant) {
		logger.warn(`[STRIPE] invoice.paid — tenant not found for subscription=${subscriptionId}`);
		return;
	}

	// Determine plan from invoice line items
	const lineItem = invoice.lines?.data?.[0];
	const priceDetails = lineItem?.pricing?.price_details;
	const priceId =
		typeof priceDetails?.price === 'string' ? priceDetails.price : priceDetails?.price?.id;
	const plan = priceId ? planIdFromPriceId(priceId) : null;

	const repos = getRepos();
	await repos.auth.updateTenantStripe(tenant.tenantId, {
		status: 'active',
		plan: plan ?? tenant.plan ?? 'monthly',
	});

	logger.info(`[STRIPE] Invoice paid: tenant=${tenant.tenantId}`);

	notifyBillingEvent(tenant.tenantId, 'invoice_paid', `plan=${plan ?? 'unknown'}`).catch(() => {});
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
	const subscriptionId = extractSubscriptionId(invoice);
	if (!subscriptionId) return;

	const tenant = await findTenantBySubscription(subscriptionId);
	if (!tenant) {
		logger.warn(
			`[STRIPE] invoice.payment_failed — tenant not found for subscription=${subscriptionId}`,
		);
		return;
	}

	const repos = getRepos();
	const graceExpires = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
	await repos.auth.updateTenantStripe(tenant.tenantId, {
		status: 'grace_period',
		planExpiresAt: graceExpires,
	});

	logger.warn(`[STRIPE] Payment failed: tenant=${tenant.tenantId}, grace until ${graceExpires}`);

	notifyBillingEvent(tenant.tenantId, 'payment_failed', `猶予期間: ${graceExpires}`).catch(
		() => {},
	);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
	const tenantId = subscription.metadata?.tenantId;
	const tenant = tenantId
		? await getRepos().auth.findTenantById(tenantId)
		: await findTenantBySubscription(subscription.id);
	if (!tenant) return;

	const item = subscription.items?.data?.[0];
	const priceId = item?.price?.id;
	const plan = priceId ? planIdFromPriceId(priceId) : null;

	const repos = getRepos();
	const status =
		subscription.status === 'active' || subscription.status === 'trialing'
			? 'active'
			: subscription.status === 'past_due'
				? 'grace_period'
				: 'suspended';

	await repos.auth.updateTenantStripe(tenant.tenantId, {
		plan: plan ?? tenant.plan ?? 'monthly',
		status: status as Tenant['status'],
	});

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
		: await findTenantBySubscription(subscription.id);
	if (!tenant) return;

	const repos = getRepos();
	await repos.auth.updateTenantStripe(tenant.tenantId, {
		stripeSubscriptionId: undefined,
		plan: undefined,
		status: 'suspended',
	});

	logger.info(`[STRIPE] Subscription deleted: tenant=${tenant.tenantId}`);

	notifyBillingEvent(tenant.tenantId, 'subscription_deleted').catch(() => {});
}

// ============================================================
// Helpers
// ============================================================

/** Invoice から subscription ID を抽出（Stripe SDK v21: parent.subscription_details） */
function extractSubscriptionId(invoice: Stripe.Invoice): string | undefined {
	const subDetails = invoice.parent?.subscription_details;
	if (!subDetails) return undefined;
	const sub = subDetails.subscription;
	return typeof sub === 'string' ? sub : sub?.id;
}

async function findTenantBySubscription(subscriptionId: string): Promise<Tenant | undefined> {
	// Look up via Stripe API to get customer, then find tenant by customer ID
	try {
		const stripe = getStripeClient();
		const sub = await stripe.subscriptions.retrieve(subscriptionId);
		const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
		if (!customerId) return undefined;
		return await getRepos().auth.findTenantByStripeCustomerId(customerId);
	} catch {
		return undefined;
	}
}
