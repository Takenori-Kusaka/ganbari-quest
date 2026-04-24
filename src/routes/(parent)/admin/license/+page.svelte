<script lang="ts">
import { enhance } from '$app/forms';
import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { DowngradePreview } from '$lib/domain/downgrade-types';
import { APP_LABELS, LICENSE_PAGE_LABELS, OYAKAGI_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import { getLicenseHighlights } from '$lib/domain/plan-features';
import DowngradeResourceSelector from '$lib/features/admin/components/DowngradeResourceSelector.svelte';
import PlanStatusCard from '$lib/features/admin/components/PlanStatusCard.svelte';
import ChurnPreventionModal from '$lib/features/loyalty/ChurnPreventionModal.svelte';
import LoyaltyBadge from '$lib/features/loyalty/LoyaltyBadge.svelte';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data, form } = $props();

const license = $derived(data.license);
const stripeEnabled = $derived(data.stripeEnabled);
const planTier = $derived(data.planTier ?? 'free');
const planStats = $derived(data.planStats);
const trialStatus = $derived(data.trialStatus);
const isOwner = $derived(data.role === 'owner');
// #771: プラン変更時の二段階確認 (PIN 設定済みなら PIN 必須、未設定なら確認フレーズ)
const pinConfigured = $derived(data.pinConfigured);
// #736: 解約時のダウングレード先 (free) の保持期間。PLAN_LIMITS 由来の動的値。
// null = 無制限（保持期間制限なし → lostItems から除外すべきだが安全のためラベルで対応）。
const downgradeRetentionDays = $derived(data.downgradeRetentionDays);
const churnLostRetentionLabel = $derived(
	downgradeRetentionDays === null || downgradeRetentionDays === undefined
		? null
		: LICENSE_PAGE_LABELS.churnLostRetentionDays(downgradeRetentionDays),
);

let checkoutLoading = $state(false);
let portalLoading = $state(false);
let showChurnModal = $state(false);
let selectedTier = $state<'standard' | 'family'>('standard');
let billingInterval = $state<'monthly' | 'yearly'>('monthly');

// #771 Portal を開く前の PIN / 確認フレーズ入力
const DOWNGRADE_CONFIRM_PHRASE = 'プランを変更します';
let showPortalConfirm = $state(false);
let portalPinValue = $state('');
let portalConfirmPhrase = $state('');
let portalError = $state<string | null>(null);

// #738 ダウングレード前警告フロー
let downgradePreview = $state<DowngradePreview | null>(null);
let showDowngradeSelector = $state(false);
let downgradeLoading = $state(false);
let downgradeError = $state<string | null>(null);

// #796 ライセンスキー適用 UI 状態
let licenseKeyInput = $state('');
let applyLoading = $state(false);
let showApplyConfirm = $state(false);
// #799 折りたたみヘルプ・一回限り使用同意
let showLicenseHelp = $state(false);
let agreedLicenseOnce = $state(false);
let applyFormEl: HTMLFormElement | null = $state(null);
// form は startTrial と applyLicenseKey の union なので、apply キーの存在で narrow する
const applyResult = $derived(
	form && typeof form === 'object' && 'apply' in form
		? (form.apply as { error?: string; success?: boolean } | undefined)
		: undefined,
);
const applyError = $derived(applyResult?.error ?? null);
const applySuccess = $derived(applyResult?.success === true);

const planLabel = (plan: string) => {
	switch (plan) {
		case LICENSE_PLAN.MONTHLY:
			return LICENSE_PAGE_LABELS.planLabelMonthly;
		case LICENSE_PLAN.YEARLY:
			return LICENSE_PAGE_LABELS.planLabelYearly;
		case LICENSE_PLAN.FAMILY_MONTHLY:
			return LICENSE_PAGE_LABELS.planLabelFamilyMonthly;
		case LICENSE_PLAN.FAMILY_YEARLY:
			return LICENSE_PAGE_LABELS.planLabelFamilyYearly;
		case LICENSE_PLAN.LIFETIME:
			return LICENSE_PAGE_LABELS.planLabelLifetime;
		case 'free':
			return LICENSE_PAGE_LABELS.planLabelFree;
		default:
			return plan;
	}
};

const statusLabel = (status: string) => {
	switch (status) {
		case SUBSCRIPTION_STATUS.ACTIVE:
			return {
				text: LICENSE_PAGE_LABELS.statusActive,
				color:
					'bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]',
				icon: '✅',
			};
		case SUBSCRIPTION_STATUS.GRACE_PERIOD:
			return {
				text: LICENSE_PAGE_LABELS.statusGracePeriod,
				color:
					'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]',
				icon: '⚠️',
			};
		case SUBSCRIPTION_STATUS.SUSPENDED:
			return {
				text: LICENSE_PAGE_LABELS.statusSuspended,
				color:
					'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]',
				icon: '⏸️',
			};
		case SUBSCRIPTION_STATUS.TERMINATED:
			return {
				text: LICENSE_PAGE_LABELS.statusTerminated,
				color: 'bg-[var(--color-feedback-error-bg-strong)] text-[var(--color-feedback-error-text)]',
				icon: '❌',
			};
		default:
			return {
				text: status,
				color: 'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]',
				icon: '❓',
			};
	}
};

const status = $derived(statusLabel(license.status));
const hasSubscription = $derived(!!license.stripeSubscriptionId);

async function startCheckout(planId: string) {
	checkoutLoading = true;
	try {
		const res = await fetch('/api/stripe/checkout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ planId }),
		});
		const data = await res.json();
		if (data.url) {
			window.location.href = data.url;
		}
	} finally {
		checkoutLoading = false;
	}
}

// #738: ダウングレードプレビューを取得し、超過がある場合はリソース選択画面を表示
async function fetchDowngradePreview() {
	downgradeLoading = true;
	downgradeError = null;
	try {
		// free へのダウングレードプレビューを取得（最も厳しい制限）
		const res = await fetch('/api/v1/admin/downgrade-preview?targetTier=free');
		if (!res.ok) {
			downgradeError = 'ダウングレード情報の取得に失敗しました';
			return null;
		}
		return await res.json();
	} catch {
		downgradeError = 'ダウングレード情報の取得に失敗しました';
		return null;
	} finally {
		downgradeLoading = false;
	}
}

// #738: ダウングレード用リソースアーカイブを実行
async function executeDowngradeArchive(selection: {
	childIds: number[];
	activityIds: number[];
	checklistTemplateIds: number[];
}) {
	downgradeLoading = true;
	downgradeError = null;
	try {
		const res = await fetch('/api/v1/admin/downgrade-archive', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				targetTier: 'free',
				...selection,
			}),
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			downgradeError =
				(body as { message?: string }).message ?? LICENSE_PAGE_LABELS.downgradeArchiveError;
			return false;
		}
		return true;
	} catch {
		downgradeError = 'リソースのアーカイブに失敗しました';
		return false;
	} finally {
		downgradeLoading = false;
	}
}

// #771: 「プラン変更・支払い管理」ボタンは直接 Portal に行かず、まず確認ダイアログを開く。
// 子供が親端末で誤ってダウングレード・解約するのを防ぐため、PIN 再入力 (未設定時は
// 確認フレーズ入力) を要求してから Stripe Customer Portal へリダイレクトする。
// #738: 有料プランの場合、Portal 遷移前にダウングレードプレビューを取得
async function requestPortal() {
	portalPinValue = '';
	portalConfirmPhrase = '';
	portalError = null;

	// #738: 有料プランの場合、ダウングレードプレビューを先に取得
	if (planTier !== 'free') {
		const preview = await fetchDowngradePreview();
		if (preview?.hasExcess) {
			downgradePreview = preview;
			showDowngradeSelector = true;
			return;
		}
	}

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
		if (portalConfirmPhrase !== DOWNGRADE_CONFIRM_PHRASE) {
			portalError = LICENSE_PAGE_LABELS.portalConfirmPhraseError(DOWNGRADE_CONFIRM_PHRASE);
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
			// サーバーエラーメッセージ (INVALID_PIN / LOCKED_OUT / CONFIRM_PHRASE_REQUIRED)
			let message: string = LICENSE_PAGE_LABELS.portalFetchError;
			try {
				const body = (await res.json()) as { message?: string };
				const raw = body.message ?? '';
				if (raw === 'INVALID_PIN' || raw === 'PIN_REQUIRED') {
					message = OYAKAGI_LABELS.invalidError;
				} else if (raw.startsWith('LOCKED_OUT')) {
					message = OYAKAGI_LABELS.lockedError;
				} else if (raw === 'CONFIRM_PHRASE_REQUIRED') {
					message = LICENSE_PAGE_LABELS.portalConfirmPhraseError(DOWNGRADE_CONFIRM_PHRASE);
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
		portalError = err instanceof Error ? err.message : LICENSE_PAGE_LABELS.portalFetchError;
	} finally {
		portalLoading = false;
	}
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.license}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<!-- 現在のプラン -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">{LICENSE_PAGE_LABELS.currentPlanTitle}</h3>

		<div class="grid gap-4">
			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.currentPlanLabel}</span>
				<span class="text-sm font-semibold text-[var(--color-text-primary)]">{planLabel(license.plan ?? 'free')}</span>
			</div>

			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.currentPlanStatus}</span>
				<span class="text-xs font-medium px-2.5 py-1 rounded-full {status.color}">
					{status.icon} {status.text}
				</span>
			</div>

			{#if license.planExpiresAt}
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.currentPlanExpiry}</span>
					<span class="text-sm text-[var(--color-text-primary)]">
						{new Date(license.planExpiresAt).toLocaleDateString('ja-JP')}
					</span>
				</div>
			{/if}

			{#if license.licenseKey}
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.currentPlanLicenseKey}</span>
					<code class="text-xs bg-[var(--color-surface-muted)] px-2 py-1 rounded font-mono text-[var(--color-text-secondary)]">
						{license.licenseKey}
					</code>
				</div>
			{/if}

			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.currentPlanFamilyName}</span>
				<span class="text-sm text-[var(--color-text-primary)]">{license.tenantName}</span>
			</div>

			<div class="flex items-center justify-between py-2">
				<span class="text-sm text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.currentPlanCreatedAt}</span>
				<span class="text-sm text-[var(--color-text-primary)]">
					{new Date(license.createdAt).toLocaleDateString('ja-JP')}
				</span>
			</div>
		</div>
		{/snippet}
	</Card>

	<!-- プラン利用状況 -->
	{#if planStats}
		<PlanStatusCard
			{planTier}
			activityCount={planStats.activityCount}
			activityMax={planStats.activityMax}
			childCount={planStats.childCount}
			childMax={planStats.childMax}
			retentionDays={planStats.retentionDays}
			{trialStatus}
		/>
	{/if}

	<!-- ライセンスキー適用 (#796) -->
	{#if isOwner && license.plan !== 'lifetime'}
		<Card variant="default" padding="lg">
			{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-2">
				{LICENSE_PAGE_LABELS.licenseKeyTitle}
			</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">
				{LICENSE_PAGE_LABELS.licenseKeyDesc}
			</p>

			{#if applySuccess}
				<Alert variant="success" class="mb-3">
					{#snippet children()}
					{LICENSE_PAGE_LABELS.licenseKeyApplySuccess}
					{/snippet}
				</Alert>
			{/if}
			{#if applyError}
				<Alert variant="danger" class="mb-3">
					{#snippet children()}
					{applyError}
					{/snippet}
				</Alert>
			{/if}

			<form
				bind:this={applyFormEl}
				method="POST"
				action="?/applyLicenseKey"
				use:enhance={() => {
					applyLoading = true;
					return async ({ update }) => {
						await update();
						applyLoading = false;
						showApplyConfirm = false;
						if (applySuccess) {
							licenseKeyInput = '';
							agreedLicenseOnce = false;
						}
					};
				}}
			>
				<label for="licenseKey" class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
					{LICENSE_PAGE_LABELS.licenseKeyInputLabel}
				</label>
				<input
					id="licenseKey"
					name="licenseKey"
					type="text"
					bind:value={licenseKeyInput}
					placeholder="GQ-XXXX-XXXX-XXXX"
					autocomplete="off"
					data-testid="license-key-input"
					class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
				/>

				<!-- #799: 折りたたみヘルプ「ライセンスキーについて」 -->
				<div class="mt-2">
					<button
						type="button"
						class="text-xs text-[var(--color-text-link)] underline hover:no-underline"
						aria-expanded={showLicenseHelp}
						aria-controls="admin-license-help"
						onclick={() => { showLicenseHelp = !showLicenseHelp; }}
						data-testid="license-help-toggle"
					>
						{showLicenseHelp ? '▼' : '▶'} {LICENSE_PAGE_LABELS.licenseKeyHelpToggle}
					</button>
					{#if showLicenseHelp}
						<div
							id="admin-license-help"
							class="mt-2 p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-muted)] leading-relaxed space-y-1.5"
							data-testid="license-help-body"
						>
							<p><strong class="text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.licenseKeyHelpOnce}</strong>: {LICENSE_PAGE_LABELS.licenseKeyHelpOnceDesc}</p>
							<p><strong class="text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.licenseKeyHelpOverwrite}</strong>: {LICENSE_PAGE_LABELS.licenseKeyHelpOverwriteDesc}</p>
							<p><strong class="text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.licenseKeyHelpBound}</strong>: {LICENSE_PAGE_LABELS.licenseKeyHelpBoundDesc}</p>
							<p><strong class="text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.licenseKeyHelpIrreversible}</strong>: {LICENSE_PAGE_LABELS.licenseKeyHelpIrreversibleDesc}</p>
						</div>
					{/if}
				</div>

				<Button
					type="button"
					variant="primary"
					size="md"
					class="mt-3 w-full"
					disabled={!licenseKeyInput.trim() || applyLoading}
					data-testid="license-key-apply-button"
					onclick={() => {
						agreedLicenseOnce = false;
						showApplyConfirm = true;
					}}
				>
					{LICENSE_PAGE_LABELS.licenseKeyApplyButton}
				</Button>

			</form>

				<Dialog
					bind:open={showApplyConfirm}
					title={LICENSE_PAGE_LABELS.licenseKeyConfirmTitle}
					testid="license-key-confirm-dialog"
				>
					{#snippet children()}
					<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
						<p>
							{LICENSE_PAGE_LABELS.licenseKeyConfirmDesc}
						</p>
						<ul class="list-disc pl-5 text-[var(--color-text-muted)] space-y-1">
							<li><strong>{LICENSE_PAGE_LABELS.licenseKeyConfirmOnce}</strong>{LICENSE_PAGE_LABELS.licenseKeyConfirmOnceDesc}</li>
							<li>{LICENSE_PAGE_LABELS.licenseKeyConfirmPlanPrefix}<strong>{LICENSE_PAGE_LABELS.licenseKeyConfirmPlan}</strong>{LICENSE_PAGE_LABELS.licenseKeyConfirmPlanDesc}</li>
							<li>{LICENSE_PAGE_LABELS.licenseKeyConfirmBoundPrefix}<strong>{LICENSE_PAGE_LABELS.licenseKeyConfirmBoundSuffix(license.tenantName)}</strong></li>
							<li>{LICENSE_PAGE_LABELS.licenseKeyConfirmIrreversiblePrefix}<strong>{LICENSE_PAGE_LABELS.licenseKeyConfirmIrreversible}</strong></li>
						</ul>
						<div class="rounded-lg bg-[var(--color-surface-muted)] px-3 py-2">
							<p class="text-[10px] text-[var(--color-text-tertiary)] mb-0.5">{LICENSE_PAGE_LABELS.licenseKeyEnteredKey}</p>
							<p class="font-mono text-xs text-[var(--color-text-secondary)] break-all" data-testid="license-key-confirm-display">
								{licenseKeyInput}
							</p>
						</div>

						<!-- #799: 一回限り使用に同意 -->
						<label class="flex items-start gap-2 cursor-pointer pt-1">
							<input
								type="checkbox"
								bind:checked={agreedLicenseOnce}
								class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)]"
								data-testid="license-key-once-checkbox"
							/>
							<span class="text-xs text-[var(--color-text-muted)] leading-relaxed">
								{LICENSE_PAGE_LABELS.licenseKeyAgreePrefix}<strong class="text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.licenseKeyAgreeOnce}</strong>{LICENSE_PAGE_LABELS.licenseKeyAgreeOnceDesc}
							</span>
						</label>
					</div>
					<div class="mt-4 flex justify-end gap-2">
						<Button
							type="button"
							variant="secondary"
							size="md"
							onclick={() => (showApplyConfirm = false)}
							disabled={applyLoading}
						>
							{LICENSE_PAGE_LABELS.licenseKeyCancel}
						</Button>
						<Button
							type="button"
							variant="primary"
							size="md"
							disabled={applyLoading || !agreedLicenseOnce}
							data-testid="license-key-confirm-button"
							onclick={() => {
								applyFormEl?.requestSubmit();
							}}
						>
							{applyLoading ? LICENSE_PAGE_LABELS.licenseKeyApplyLoading : LICENSE_PAGE_LABELS.licenseKeyApplyConfirm}
						</Button>
					</div>
					{/snippet}
				</Dialog>
			{/snippet}
		</Card>
	{/if}

	<!-- 無料トライアル -->
	{#if planTier === 'free' && trialStatus}
		<Card variant="default" padding="lg">
			{#snippet children()}
			{#if trialStatus.isTrialActive}
				<div class="text-center">
					<p class="text-sm font-semibold text-[var(--color-feedback-info-text)] mb-1">
						{LICENSE_PAGE_LABELS.trialActiveTitle}
					</p>
					<p class="text-2xl font-bold text-[var(--color-feedback-info-text)]">
						{LICENSE_PAGE_LABELS.trialActiveDays(trialStatus.daysRemaining)}
					</p>
					<p class="text-xs text-[var(--color-text-tertiary)] mt-1">
						{LICENSE_PAGE_LABELS.trialActiveUntil(trialStatus.trialEndDate)}
					</p>
				</div>
			{:else if !trialStatus.trialUsed}
				<div class="text-center">
					<p class="text-lg font-bold text-[var(--color-text-primary)] mb-1">
						{LICENSE_PAGE_LABELS.trialStartTitle}
					</p>
					<p class="text-sm text-[var(--color-text-muted)] mb-4">
						{LICENSE_PAGE_LABELS.trialStartDesc}
					</p>
					<form method="POST" action="?/startTrial">
						<Button
							type="submit"
							variant="primary"
							size="md"
							class="w-full"
						>
							{LICENSE_PAGE_LABELS.trialStartButton}
						</Button>
					</form>
					<p class="text-xs text-[var(--color-text-tertiary)] mt-2">
						{LICENSE_PAGE_LABELS.trialStartNote}
					</p>
				</div>
			{:else}
				<p class="text-sm text-[var(--color-text-tertiary)] text-center">
					{LICENSE_PAGE_LABELS.trialUsed}
				</p>
			{/if}
			{/snippet}
		</Card>
	{/if}

	<!-- サポーターバッジ -->
	{#if data.loyaltyInfo && data.loyaltyInfo.subscriptionMonths > 0}
		<LoyaltyBadge
			subscriptionMonths={data.loyaltyInfo.subscriptionMonths}
			memoryTickets={data.loyaltyInfo.memoryTickets}
			currentTierName={data.loyaltyInfo.currentTier.name}
			nextTierMonths={data.loyaltyInfo.nextTier?.months ?? null}
			nextTierRemaining={data.loyaltyInfo.nextTier?.remaining ?? null}
			tiers={data.loyaltyInfo.tiers}
			loginBonusMultiplier={data.loyaltyInfo.loginBonusMultiplier}
		/>
	{/if}

	<!-- ステータス別メッセージ -->
	{#if license.status === SUBSCRIPTION_STATUS.GRACE_PERIOD}
		<section class="bg-[var(--color-feedback-warning-bg)] rounded-xl p-4 border border-[var(--color-feedback-warning-border)]">
			<h3 class="text-sm font-semibold text-[var(--color-feedback-warning-text)] mb-1">{LICENSE_PAGE_LABELS.gracePeriodTitle}</h3>
			<p class="text-sm text-[var(--color-feedback-warning-text)]">
				{LICENSE_PAGE_LABELS.gracePeriodDesc}
			</p>
		</section>
	{:else if license.status === SUBSCRIPTION_STATUS.SUSPENDED}
		<section class="bg-[var(--color-feedback-warning-bg)] rounded-xl p-4 border border-[var(--color-feedback-warning-border)]">
			<h3 class="text-sm font-semibold text-[var(--color-feedback-warning-text)] mb-1">{LICENSE_PAGE_LABELS.suspendedTitle}</h3>
			<p class="text-sm text-[var(--color-feedback-warning-text)]">
				{LICENSE_PAGE_LABELS.suspendedDesc}
			</p>
		</section>
	{:else if license.status === SUBSCRIPTION_STATUS.TERMINATED}
		<section class="bg-[var(--color-feedback-error-bg)] rounded-xl p-4 border border-[var(--color-feedback-error-border)]">
			<h3 class="text-sm font-semibold text-[var(--color-feedback-error-text)] mb-1">{LICENSE_PAGE_LABELS.terminatedTitle}</h3>
			<p class="text-sm text-[var(--color-feedback-error-text)]">
				{LICENSE_PAGE_LABELS.terminatedDesc}
			</p>
		</section>
	{/if}

	<!-- プラン管理 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">{LICENSE_PAGE_LABELS.planManagementTitle}</h3>

		{#if !stripeEnabled}
			<p class="text-sm text-[var(--color-text-tertiary)] text-center py-4">
				{LICENSE_PAGE_LABELS.planManagementUnavailable}
			</p>
		{:else if hasSubscription}
			<!-- サブスクリプション有り → Stripe Customer Portal で管理 (#771: PIN 再確認ゲート付き) -->
			<div class="grid gap-3">
				<Button
					onclick={requestPortal}
					disabled={portalLoading}
					variant="primary"
					size="md"
					class="w-full"
					data-testid="open-portal-button"
				>
					{LICENSE_PAGE_LABELS.portalButton(portalLoading)}
				</Button>
				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					{LICENSE_PAGE_LABELS.portalNote}
				</p>
				<p class="text-xs text-[var(--color-feedback-warning-text)] text-center">
					{LICENSE_PAGE_LABELS.portalPinNote(pinConfigured)}
				</p>
			</div>
		{:else}
			<!-- サブスクリプション無し → プラン選択 -->
			<div class="grid gap-4">
				<!-- 請求間隔切り替え -->
				<div class="flex justify-center gap-2 mb-2">
					<button
						class="interval-btn"
						class:active={billingInterval === 'monthly'}
						onclick={() => (billingInterval = 'monthly')}
					>
						{LICENSE_PAGE_LABELS.billingMonthly}
					</button>
					<button
						class="interval-btn"
						class:active={billingInterval === 'yearly'}
						onclick={() => (billingInterval = 'yearly')}
					>
						{LICENSE_PAGE_LABELS.billingYearly}
					</button>
				</div>

				<!-- スタンダードプラン -->
				<div
					class="plan-card"
					class:selected={selectedTier === 'standard'}
					role="button"
					tabindex="0"
					data-testid="standard-plan-card"
					onclick={() => (selectedTier = 'standard')}
					onkeydown={(e) => e.key === 'Enter' && (selectedTier = 'standard')}
				>
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.standardPlanName}</p>
							<p class="text-xs text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.standardPlanDesc}</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">{LICENSE_PAGE_LABELS.standardPriceMonthly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.standardPerMonth}</span></p>
						{:else}
							<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">{LICENSE_PAGE_LABELS.standardPriceYearly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.standardPerYear}</span></p>
						{/if}
					</div>
					<ul class="text-xs text-[var(--color-text-muted)] space-y-1 mb-3">
						{#each getLicenseHighlights('standard') as highlight}
							<li>{highlight}</li>
						{/each}
					</ul>
				</div>

				<!-- ファミリープラン -->
				<div
					class="plan-card"
					class:selected={selectedTier === 'family'}
					class:recommended={true}
					role="button"
					tabindex="0"
					data-testid="family-plan-card"
					onclick={() => (selectedTier = 'family')}
					onkeydown={(e) => e.key === 'Enter' && (selectedTier = 'family')}
				>
					<span class="recommend-badge">{LICENSE_PAGE_LABELS.familyRecommendBadge}</span>
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.familyPlanName}</p>
							<p class="text-xs text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.familyPlanDesc}</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-[var(--color-stat-purple)]">{LICENSE_PAGE_LABELS.familyPriceMonthly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.standardPerMonth}</span></p>
						{:else}
							<p class="text-xl font-bold text-[var(--color-stat-purple)]">{LICENSE_PAGE_LABELS.familyPriceYearly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.standardPerYear}</span></p>
						{/if}
					</div>
					<ul class="text-xs text-[var(--color-text-muted)] space-y-1 mb-3">
						{#each getLicenseHighlights('family') as highlight}
							<li>{highlight}</li>
						{/each}
					</ul>
				</div>

				<!-- 購入ボタン -->
				<Button
					onclick={() => startCheckout(selectedTier === 'family' ? `family-${billingInterval}` : billingInterval)}
					disabled={checkoutLoading}
					variant="primary"
					size="md"
					class="w-full"
				>
					{LICENSE_PAGE_LABELS.checkoutButton(selectedTier, checkoutLoading)}
				</Button>

				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					{LICENSE_PAGE_LABELS.checkoutNote}
				</p>
			</div>
		{/if}
		{/snippet}
	</Card>

	<!-- 支払い履歴 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">{LICENSE_PAGE_LABELS.paymentHistoryTitle}</h3>
		{#if hasSubscription}
			<p class="text-sm text-[var(--color-text-muted)] text-center py-4">
				{LICENSE_PAGE_LABELS.paymentHistoryPortalNote}
			</p>
			<Button
				onclick={requestPortal}
				disabled={portalLoading}
				variant="secondary"
				size="sm"
				class="w-full"
			>
				{LICENSE_PAGE_LABELS.paymentHistoryPortalButton}
			</Button>
		{:else}
			<p class="text-sm text-[var(--color-text-tertiary)] text-center py-4">
				{LICENSE_PAGE_LABELS.paymentHistoryEmpty}
			</p>
		{/if}
		<div class="mt-4 pt-3 border-t border-[var(--color-border-light)]">
			<a
				href="/admin/billing"
				class="flex items-center justify-between text-sm text-[var(--color-text-link)] hover:underline"
				data-testid="license-to-billing"
			>
				<span>{LICENSE_PAGE_LABELS.paymentHistoryBillingLink}</span>
				<span>&rarr;</span>
			</a>
		</div>
		{/snippet}
	</Card>

	<!-- #771: プラン変更 (Stripe Portal) 前の二段階確認ダイアログ -->
	<Dialog bind:open={showPortalConfirm} title={LICENSE_PAGE_LABELS.portalConfirmTitle}>
		{#snippet children()}
		<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
			<p>
				{LICENSE_PAGE_LABELS.portalConfirmDesc}
			</p>
			<p class="text-[var(--color-feedback-warning-text)] font-semibold">
				{LICENSE_PAGE_LABELS.portalConfirmWarning}{pinConfigured ? OYAKAGI_LABELS.inputLabel : LICENSE_PAGE_LABELS.portalConfirmWarningPhrase}{LICENSE_PAGE_LABELS.portalConfirmWarningPin}
			</p>

			{#if pinConfigured}
				<div class="space-y-2">
					<label for="portal-pin" class="block text-sm font-medium text-[var(--color-text-primary)]">
						{OYAKAGI_LABELS.inputLabel}
					</label>
					<input
						id="portal-pin"
						type="password"
						inputmode="numeric"
						pattern="[0-9]*"
						maxlength={6}
						minlength={4}
						bind:value={portalPinValue}
						placeholder={OYAKAGI_LABELS.inputPlaceholder}
						autocomplete="off"
						data-testid="portal-pin-input"
						class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
					/>
				</div>
			{:else}
				<div class="space-y-2">
					<label for="portal-confirm-phrase" class="block text-sm font-medium text-[var(--color-text-primary)]">
						{LICENSE_PAGE_LABELS.portalConfirmPhraseLabel(DOWNGRADE_CONFIRM_PHRASE)}
					</label>
					<input
						id="portal-confirm-phrase"
						type="text"
						bind:value={portalConfirmPhrase}
						placeholder={DOWNGRADE_CONFIRM_PHRASE}
						autocomplete="off"
						data-testid="portal-confirm-phrase-input"
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
				{LICENSE_PAGE_LABELS.portalConfirmCancel}
			</Button>
			<Button
				type="button"
				variant="primary"
				size="md"
				onclick={openPortal}
				disabled={portalLoading}
				data-testid="portal-confirm-button"
			>
				{portalLoading ? LICENSE_PAGE_LABELS.portalConfirmLoading : LICENSE_PAGE_LABELS.portalConfirmSubmit}
			</Button>
		</div>
		{/snippet}
	</Dialog>
</div>

<style>
	.interval-btn {
		padding: 6px 16px;
		font-size: 0.8rem;
		font-weight: 600;
		border-radius: 8px;
		border: 1px solid var(--color-neutral-200, #e5e7eb);
		background: white;
		color: var(--color-neutral-500, #6b7280);
		cursor: pointer;
		transition: all 0.15s;
	}

	.interval-btn.active {
		background: var(--color-violet-500, #8b5cf6);
		color: white;
		border-color: var(--color-violet-500, #8b5cf6);
	}

	.plan-card {
		position: relative;
		border: 2px solid var(--color-neutral-200, #e5e7eb);
		border-radius: 12px;
		padding: 16px;
		cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.plan-card:hover {
		border-color: var(--color-violet-300, #c4b5fd);
	}

	.plan-card.selected {
		border-color: var(--color-violet-500, #8b5cf6);
		box-shadow: 0 0 0 1px var(--color-violet-500, #8b5cf6);
	}

	.recommend-badge {
		position: absolute;
		top: -10px;
		left: 16px;
		background: var(--color-violet-500, #8b5cf6);
		color: white;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 2px 10px;
		border-radius: 9999px;
	}
</style>

<!-- Churn prevention modal -->
{#if data.loyaltyInfo && data.loyaltyInfo.subscriptionMonths > 0}
	<ChurnPreventionModal
		bind:open={showChurnModal}
		subscriptionMonths={data.loyaltyInfo.subscriptionMonths}
		lostItems={[
			...(data.loyaltyInfo.subscriptionMonths > 0 ? [LICENSE_PAGE_LABELS.churnLostItemMonthly(data.loyaltyInfo.subscriptionMonths)] : []),
			...(data.loyaltyInfo.memoryTickets > 0 ? [LICENSE_PAGE_LABELS.churnLostItemTickets(data.loyaltyInfo.memoryTickets)] : []),
			...(data.loyaltyInfo.loginBonusMultiplier > 1 ? [LICENSE_PAGE_LABELS.churnLostItemBonus(data.loyaltyInfo.loginBonusMultiplier)] : []),
			...(data.loyaltyInfo.currentTier.titleUnlock ? [LICENSE_PAGE_LABELS.churnLostItemTitle(data.loyaltyInfo.currentTier.titleUnlock)] : []),
			...(churnLostRetentionLabel ? [churnLostRetentionLabel] : []),
		]}
		onKeep={() => { showChurnModal = false; }}
		onCancel={() => { showChurnModal = false; openPortal(); }}
	/>
{/if}

<!-- #738: ダウングレード前リソース選択ダイアログ -->
<DowngradeResourceSelector
	bind:open={showDowngradeSelector}
	preview={downgradePreview}
	loading={downgradeLoading}
	error={downgradeError}
	onConfirm={async (selection) => {
		if (downgradePreview?.hasExcess) {
			const ok = await executeDowngradeArchive(selection);
			if (!ok) return;
		}
		showDowngradeSelector = false;
		downgradePreview = null;
		showPortalConfirm = true;
	}}
	onCancel={() => {
		showDowngradeSelector = false;
		downgradePreview = null;
	}}
/>
