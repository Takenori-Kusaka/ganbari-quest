<script lang="ts">
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { APP_LABELS, BILLING_LABELS, OYAKAGI_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

const stripeEnabled = $derived(data.stripeEnabled);
const hasSubscription = $derived(data.hasSubscription);
const hasCustomer = $derived(data.hasCustomer);
const canAccessPortal = $derived(stripeEnabled && hasCustomer);
// #771: PIN 設定済みなら PIN 必須、未設定なら確認フレーズ
const pinConfigured = $derived(data.pinConfigured);

let portalLoading = $state(false);
let portalError = $state<string | null>(null);

// #771 Portal を開く前の PIN / 確認フレーズ入力
const CONFIRM_PHRASE = 'プランを変更します';
let showPortalConfirm = $state(false);
let portalPinValue = $state('');
let portalConfirmPhrase = $state('');

function requestPortal() {
	portalPinValue = '';
	portalConfirmPhrase = '';
	portalError = null;
	showPortalConfirm = true;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
async function openPortal() {
	portalError = null;

	// 事前バリデーション (サーバーと同じ判定だが UX のため先に弾く)
	if (pinConfigured) {
		if (
			!portalPinValue ||
			portalPinValue.length < 4 ||
			portalPinValue.length > 6 ||
			!/^\d+$/.test(portalPinValue)
		) {
			portalError = OYAKAGI_LABELS.formatError;
			return;
		}
	} else {
		if (portalConfirmPhrase !== CONFIRM_PHRASE) {
			portalError = `「${CONFIRM_PHRASE}」と入力してください`;
			return;
		}
	}

	portalLoading = true;
	try {
		const res = await fetch('/api/stripe/portal', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(
				pinConfigured ? { pin: portalPinValue } : { confirmPhrase: portalConfirmPhrase },
			),
		});
		if (!res.ok) {
			let message = BILLING_LABELS.openPortalError;
			try {
				const body = (await res.json()) as { message?: string };
				const raw = body.message ?? '';
				if (raw === 'INVALID_PIN' || raw === 'PIN_REQUIRED') {
					message = OYAKAGI_LABELS.invalidError;
				} else if (raw.startsWith('LOCKED_OUT')) {
					message = OYAKAGI_LABELS.lockedError;
				} else if (raw === 'CONFIRM_PHRASE_REQUIRED') {
					message = `「${CONFIRM_PHRASE}」と入力してください`;
				} else if (raw) {
					message = raw;
				}
			} catch {
				/* noop */
			}
			portalError = message;
			// セキュリティのため PIN 入力値をクリア
			portalPinValue = '';
			return;
		}
		const body = (await res.json()) as { url?: string };
		if (body.url) {
			window.location.href = body.url;
		}
	} catch (err) {
		portalError = err instanceof Error ? err.message : BILLING_LABELS.openPortalError;
	} finally {
		portalLoading = false;
	}
}

const statusLabel = $derived.by(() => {
	switch (data.status) {
		case SUBSCRIPTION_STATUS.ACTIVE:
			return { text: BILLING_LABELS.statusActive, icon: '✅' };
		case SUBSCRIPTION_STATUS.GRACE_PERIOD:
			return { text: BILLING_LABELS.statusGracePeriod, icon: '⚠️' };
		case SUBSCRIPTION_STATUS.SUSPENDED:
			return { text: BILLING_LABELS.statusSuspended, icon: '⏸️' };
		case SUBSCRIPTION_STATUS.TERMINATED:
			return { text: BILLING_LABELS.statusTerminated, icon: '❌' };
		default:
			return { text: data.status, icon: '❓' };
	}
});
</script>

<svelte:head>
	<title>{PAGE_TITLES.billing}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-lg font-bold text-[var(--color-text-primary)]">{BILLING_LABELS.pageHeading}</h1>

	<!-- サブスクリプション概要 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h2 class="text-base font-semibold text-[var(--color-text-secondary)] mb-4">{BILLING_LABELS.subscriptionOverviewTitle}</h2>

		<div class="billing-info-grid">
			<div class="billing-info-item">
				<span class="billing-info-label">{BILLING_LABELS.statusLabel}</span>
				<span class="billing-info-value">{statusLabel.icon} {statusLabel.text}</span>
			</div>

			{#if hasSubscription}
				<div class="billing-info-item">
					<span class="billing-info-label">{BILLING_LABELS.stripeConnectionLabel}</span>
					<span class="billing-info-value">{BILLING_LABELS.stripeConnected}</span>
				</div>
			{:else}
				<div class="billing-info-item">
					<span class="billing-info-label">{BILLING_LABELS.stripeConnectionLabel}</span>
					<span class="billing-info-value">{BILLING_LABELS.stripeNotConnected}</span>
				</div>
			{/if}

			{#if data.planExpiresAt}
				<div class="billing-info-item">
					<span class="billing-info-label">{BILLING_LABELS.expiresLabel}</span>
					<span class="billing-info-value">
						{new Date(data.planExpiresAt).toLocaleDateString('ja-JP')}
					</span>
				</div>
			{/if}
		</div>
		{/snippet}
	</Card>

	<!-- Stripe Customer Portal セクション -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h2 class="text-base font-semibold text-[var(--color-text-secondary)] mb-2">{BILLING_LABELS.billingPortalTitle}</h2>
		<p class="text-sm text-[var(--color-text-muted)] mb-4">
			{BILLING_LABELS.billingPortalDesc}
		</p>

		<ul class="billing-feature-list">
			<li>{BILLING_LABELS.featureInvoices}</li>
			<li>{BILLING_LABELS.featurePaymentMethod}</li>
			<li>{BILLING_LABELS.featurePlanSwitch}</li>
			<li>{BILLING_LABELS.featureNextBilling}</li>
		</ul>

		{#if portalError && !showPortalConfirm}
			<Alert variant="danger" class="mb-3">
				{#snippet children()}
				{portalError}
				{/snippet}
			</Alert>
		{/if}

		{#if !stripeEnabled}
			<Alert variant="info" class="mb-3">
				{#snippet children()}
				{BILLING_LABELS.notReadyAlert}
				{/snippet}
			</Alert>
		{:else if canAccessPortal}
			<Button
				variant="primary"
				size="md"
				class="w-full"
				disabled={portalLoading}
				data-testid="billing-open-portal"
				onclick={requestPortal}
			>
				{portalLoading ? BILLING_LABELS.openPortalLoading : BILLING_LABELS.openPortalButton}
			</Button>
			<p class="text-xs text-[var(--color-text-tertiary)] text-center mt-2">
				{BILLING_LABELS.openPortalNote}
			</p>
			<p class="text-xs text-[var(--color-feedback-warning-text)] text-center mt-1">
				{BILLING_LABELS.openPortalPinRequired(pinConfigured ? BILLING_LABELS.openPortalPinRequiredPin : BILLING_LABELS.openPortalPinRequiredPhrase)}
			</p>
		{:else}
			<Alert variant="info" class="mb-3">
				{#snippet children()}
				{#if !hasCustomer}
					{BILLING_LABELS.noCustomerAlert}
					<a href="/admin/license" class="underline text-[var(--color-text-link)]">{BILLING_LABELS.noCustomerAlertSelectPlan}</a>{BILLING_LABELS.noCustomerAlertSuffix}
				{:else}
					{BILLING_LABELS.noSubscriptionAlert}
				{/if}
				{/snippet}
			</Alert>
		{/if}
		{/snippet}
	</Card>

	<!-- /admin/license へのリンク -->
	<div class="billing-nav-links">
		<a href="/admin/license" class="billing-nav-link" data-testid="billing-to-license">
			<span class="billing-nav-link__icon">💎</span>
			<span class="billing-nav-link__text">
				<span class="billing-nav-link__title">{BILLING_LABELS.navLinkTitle}</span>
				<span class="billing-nav-link__hint">{BILLING_LABELS.navLinkHint}</span>
			</span>
			<span class="billing-nav-link__arrow">&rarr;</span>
		</a>
	</div>
</div>

<!-- #771: 請求管理画面を開く前の PIN / 確認フレーズ確認ダイアログ -->
<Dialog bind:open={showPortalConfirm} title="請求管理画面を開く">
	{#snippet children()}
	<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
		<p>
			{BILLING_LABELS.dialogDesc}
		</p>
		<p class="text-[var(--color-feedback-warning-text)] font-semibold">
			{BILLING_LABELS.dialogPinRequired(pinConfigured ? OYAKAGI_LABELS.inputLabel : BILLING_LABELS.dialogPinOrPhrase)}
		</p>

		{#if pinConfigured}
			<div class="space-y-2">
				<label for="billing-portal-pin" class="block text-sm font-medium text-[var(--color-text-primary)]">
					{OYAKAGI_LABELS.inputLabel}
				</label>
				<input
					id="billing-portal-pin"
					type="password"
					inputmode="numeric"
					pattern="[0-9]*"
					maxlength={6}
					minlength={4}
					bind:value={portalPinValue}
					placeholder={OYAKAGI_LABELS.inputPlaceholder}
					autocomplete="off"
					data-testid="billing-portal-pin-input"
					class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
				/>
			</div>
		{:else}
			<div class="space-y-2">
				<label for="billing-portal-confirm-phrase" class="block text-sm font-medium text-[var(--color-text-primary)]">
					{BILLING_LABELS.dialogConfirmPhraseLabel(CONFIRM_PHRASE)}
				</label>
				<input
					id="billing-portal-confirm-phrase"
					type="text"
					bind:value={portalConfirmPhrase}
					placeholder={CONFIRM_PHRASE}
					autocomplete="off"
					data-testid="billing-portal-confirm-phrase-input"
					class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
				/>
			</div>
		{/if}

		{#if portalError}
			<Alert variant="danger">
				{#snippet children()}
				{portalError}
				{/snippet}
			</Alert>
		{/if}
	</div>
	<div class="mt-4 flex justify-end gap-2">
		<Button
			type="button"
			variant="secondary"
			size="md"
			onclick={() => {
				showPortalConfirm = false;
				portalPinValue = '';
				portalConfirmPhrase = '';
				portalError = null;
			}}
			disabled={portalLoading}
		>
			{BILLING_LABELS.dialogCancelButton}
		</Button>
		<Button
			type="button"
			variant="primary"
			size="md"
			onclick={openPortal}
			disabled={portalLoading}
			data-testid="billing-portal-confirm-button"
		>
			{portalLoading ? BILLING_LABELS.dialogConfirmLoading : BILLING_LABELS.dialogConfirmButton}
		</Button>
	</div>
	{/snippet}
</Dialog>

<style>
	.billing-info-grid {
		display: grid;
		gap: 0.75rem;
	}

	.billing-info-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-border-light);
	}

	.billing-info-item:last-child {
		border-bottom: none;
	}

	.billing-info-label {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.billing-info-value {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.billing-feature-list {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: grid;
		gap: 0.5rem;
	}

	.billing-feature-list li {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		padding-left: 1.25rem;
		position: relative;
	}

	.billing-feature-list li::before {
		content: '✓';
		position: absolute;
		left: 0;
		color: var(--color-action-success);
		font-weight: 700;
	}

	.billing-nav-links {
		display: grid;
		gap: 0.5rem;
	}

	.billing-nav-link {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg, 12px);
		text-decoration: none;
		transition: border-color 0.15s;
	}

	.billing-nav-link:hover {
		border-color: var(--color-border-focus);
	}

	.billing-nav-link__icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.billing-nav-link__text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.billing-nav-link__title {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.billing-nav-link__hint {
		font-size: 0.7rem;
		color: var(--color-text-tertiary);
	}

	.billing-nav-link__arrow {
		font-size: 0.85rem;
		color: var(--color-text-tertiary);
		flex-shrink: 0;
	}
</style>
