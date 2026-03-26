// src/lib/server/services/stripe-service.ts
// Stripe 決済サービス (#0131)

import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { getStripeClient, isStripeEnabled } from '$lib/server/stripe/client';
import {
	CURRENCY,
	GRACE_PERIOD_DAYS,
	TRIAL_PERIOD_DAYS,
	getPlans,
	getWebhookSecret,
	planIdFromPriceId,
} from '$lib/server/stripe/config';
import type Stripe from 'stripe';

// ============================================================
// Checkout Session
// ============================================================

export interface CreateCheckoutInput {
	tenantId: string;
	planId: 'monthly' | 'yearly';
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

	// Trial abuse prevention: only grant trial once per tenant
	const trialDays = tenant.trialUsedAt ? undefined : TRIAL_PERIOD_DAYS;

	const sessionParams: Stripe.Checkout.SessionCreateParams = {
		mode: 'subscription',
		payment_method_types: ['card'],
		line_items: [{ price: plan.priceId, quantity: 1 }],
		subscription_data: {
			trial_period_days: trialDays,
			metadata: { tenantId: input.tenantId },
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

	const repos = getRepos();
	await repos.auth.updateTenantStripe(tenantId, {
		stripeCustomerId: customerId ?? undefined,
		stripeSubscriptionId: subscriptionId ?? undefined,
		plan: (planId as Tenant['plan']) ?? 'monthly',
		status: 'active',
		trialUsedAt: new Date().toISOString(),
	});

	logger.info(
		`[STRIPE] Checkout completed: tenant=${tenantId} customer=${customerId} subscription=${subscriptionId}`,
	);
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
