<script lang="ts">
/**
 * SaasLicensePanel.svelte — AWS SaaS 版サブスクリプション画面 (EPIC #2327 / #2330)
 *
 * 既存 /admin/subscription/+page.svelte (旧 /admin/license、940 行) の AWS 用ロジックを分離移行。
 * 主な変更点 (EPIC #2327 子#2330):
 *   1. 「現在のプラン」表示を license.plan → planTier (resolveFullPlanTier 経由) に統一
 *      (header badge との表示矛盾解消、PO 報告 2026-05-20 Q3)
 *   2. 「決済機能は現在準備中です」placeholder 削除
 *      (stripeEnabled false 分岐は production 環境で到達不能、PO 報告 Q2)
 *
 * Epic #2525 Phase 7 PR-L3 (#2818): license key 全廃 (Phase 1 補強 3 #2788) に伴い
 *   ライセンスキー適用 UI section (入力フォーム / 適用ボタン / ヘルプ / 確認ダイアログ /
 *   license.licenseKey 表示行) を完全撤去。subscription 管理 (プラン表示 / 選択 / Stripe Portal /
 *   trial / PIN ゲート / DowngradeResourceSelector) のみ残す。
 *
 * 維持セクション: trial banner / 現在のプラン / プラン選択 /
 *   PIN ゲート / DowngradeResourceSelector / Stripe Customer Portal 遷移
 *
 * 親コンポーネント: /admin/subscription/+page.svelte (薄ラッパー、子#2331)
 */
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { SUBSCRIPTION_PLAN } from '$lib/domain/constants/subscription-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { DowngradePreview } from '$lib/domain/downgrade-types';
import { getActionErrorDisplay } from '$lib/domain/errors';
import {
	ACTION_LABELS,
	APP_LABELS,
	OYAKAGI_LABELS,
	PAGE_TITLES,
	SUBSCRIPTION_PAGE_LABELS,
	TRIAL_LABELS,
} from '$lib/domain/labels';
import { getLicenseHighlights } from '$lib/domain/plan-features';
import DowngradeResourceSelector from '$lib/features/admin/components/DowngradeResourceSelector.svelte';
import PlanStatusCard from '$lib/features/admin/components/PlanStatusCard.svelte';
import ChurnPreventionModal from '$lib/features/loyalty/ChurnPreventionModal.svelte';
import LoyaltyBadge from '$lib/features/loyalty/LoyaltyBadge.svelte';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

const license = $derived(data.license);
// EPIC #2327 子#2330 AC3: stripeEnabled false 分岐 (placeholder) は撤去したが、
// hasSubscription / plan card 制御で stripeEnabled が必要なため derived は維持。
const stripeEnabled = $derived(data.stripeEnabled);
const planTier = $derived(data.planTier ?? 'free');
const planStats = $derived(data.planStats);
const trialStatus = $derived(data.trialStatus);
// #771: プラン変更時の二段階確認 (PIN 設定済みなら PIN 必須、未設定なら確認フレーズ)
const pinConfigured = $derived(data.pinConfigured);
// #736: 解約時のダウングレード先 (free) の保持期間。PLAN_LIMITS 由来の動的値。
const downgradeRetentionDays = $derived(data.downgradeRetentionDays);
const churnLostRetentionLabel = $derived(
	downgradeRetentionDays === null || downgradeRetentionDays === undefined
		? null
		: SUBSCRIPTION_PAGE_LABELS.churnLostRetentionDays(downgradeRetentionDays),
);

let checkoutLoading = $state(false);
let portalLoading = $state(false);
// #2941 項目 2 (#3033 で TrialBanner not-started form から本 panel へ移植):
// startTrial の fail(400) (trialUsed=true 再押下等) をユーザーに見える形で表示する
// (NN/G #1 visibility of system status)。getActionErrorDisplay (#2913) 経路。
let trialSubmitting = $state(false);
let trialStartError = $state('');
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

// EPIC #2327 子#2330 AC2: 表示矛盾解消。
// 旧実装は license.plan (Stripe subscription tier) を表示していたため、NUC や free 状態で
// header badge の planTier (resolveFullPlanTier 経由) と矛盾していた。
// 新実装は data.planTier を SSOT として直接ラベル化し、header と必ず一致させる。
const planTierLabel = $derived.by(() => {
	switch (planTier) {
		case 'standard':
			return SUBSCRIPTION_PAGE_LABELS.planLabelMonthly;
		case 'family':
			return SUBSCRIPTION_PAGE_LABELS.planLabelFamilyMonthly;
		case 'free':
			return SUBSCRIPTION_PAGE_LABELS.planLabelFree;
		default:
			return SUBSCRIPTION_PAGE_LABELS.planLabelFree;
	}
});

const planLabel = (plan: string) => {
	switch (plan) {
		case SUBSCRIPTION_PLAN.MONTHLY:
			return SUBSCRIPTION_PAGE_LABELS.planLabelMonthly;
		case SUBSCRIPTION_PLAN.YEARLY:
			return SUBSCRIPTION_PAGE_LABELS.planLabelYearly;
		case SUBSCRIPTION_PLAN.FAMILY_MONTHLY:
			return SUBSCRIPTION_PAGE_LABELS.planLabelFamilyMonthly;
		case SUBSCRIPTION_PLAN.FAMILY_YEARLY:
			return SUBSCRIPTION_PAGE_LABELS.planLabelFamilyYearly;
		case SUBSCRIPTION_PLAN.LIFETIME:
			return SUBSCRIPTION_PAGE_LABELS.planLabelLifetime;
		case 'free':
			return SUBSCRIPTION_PAGE_LABELS.planLabelFree;
		default:
			return plan;
	}
};

const statusLabel = (status: string) => {
	switch (status) {
		case SUBSCRIPTION_STATUS.ACTIVE:
			return {
				text: SUBSCRIPTION_PAGE_LABELS.statusActive,
				color:
					'bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]',
				icon: '✅',
			};
		case SUBSCRIPTION_STATUS.GRACE_PERIOD:
			return {
				text: SUBSCRIPTION_PAGE_LABELS.statusGracePeriod,
				color:
					'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]',
				icon: '⚠️',
			};
		case SUBSCRIPTION_STATUS.SUSPENDED:
			return {
				text: SUBSCRIPTION_PAGE_LABELS.statusSuspended,
				color:
					'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]',
				icon: '⏸️',
			};
		case SUBSCRIPTION_STATUS.TERMINATED:
			return {
				text: SUBSCRIPTION_PAGE_LABELS.statusTerminated,
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

// #738: ダウングレードプレビュー取得
async function fetchDowngradePreview() {
	downgradeLoading = true;
	downgradeError = null;
	try {
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
				(body as { message?: string }).message ?? SUBSCRIPTION_PAGE_LABELS.downgradeArchiveError;
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

// #771 + #738: Portal 遷移前ダイアログ
async function requestPortal() {
	portalPinValue = '';
	portalConfirmPhrase = '';
	portalError = null;

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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: PIN ゲート + Portal 遷移の集中ロジックのため
async function openPortal() {
	portalError = null;

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
			portalError = SUBSCRIPTION_PAGE_LABELS.portalConfirmPhraseError(DOWNGRADE_CONFIRM_PHRASE);
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
			let message: string = SUBSCRIPTION_PAGE_LABELS.portalFetchError;
			try {
				const body = (await res.json()) as { message?: string };
				const raw = body.message ?? '';
				if (raw === 'INVALID_PIN' || raw === 'PIN_REQUIRED') {
					message = OYAKAGI_LABELS.invalidError;
				} else if (raw.startsWith('LOCKED_OUT')) {
					message = OYAKAGI_LABELS.lockedError;
				} else if (raw === 'CONFIRM_PHRASE_REQUIRED') {
					message = SUBSCRIPTION_PAGE_LABELS.portalConfirmPhraseError(DOWNGRADE_CONFIRM_PHRASE);
				} else if (raw) {
					message = raw;
				}
			} catch {
				/* noop */
			}
			portalError = message;
			portalPinValue = '';
			return;
		}
		const body = (await res.json()) as { url?: string };
		if (body.url) {
			window.location.href = body.url;
		}
	} catch (err) {
		portalError = err instanceof Error ? err.message : SUBSCRIPTION_PAGE_LABELS.portalFetchError;
	} finally {
		portalLoading = false;
	}
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.license}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6" data-testid="saas-license-panel">
	<!-- 現在のプラン -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">{SUBSCRIPTION_PAGE_LABELS.currentPlanTitle}</h3>

		<div class="grid gap-4">
			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.currentPlanLabel}</span>
				<!-- EPIC #2327 子#2330 AC2: planTier SSOT 統一 -->
				<span class="text-sm font-semibold text-[var(--color-text-primary)]" data-testid="saas-current-plan">{planTierLabel}</span>
			</div>

			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.currentPlanStatus}</span>
				<span class="text-xs font-medium px-2.5 py-1 rounded-full {status.color}">
					{status.icon} {status.text}
				</span>
			</div>

			{#if license.planExpiresAt}
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.currentPlanExpiry}</span>
					<span class="text-sm text-[var(--color-text-primary)]">
						{new Date(license.planExpiresAt).toLocaleDateString('ja-JP')}
					</span>
				</div>
			{/if}

			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.currentPlanFamilyName}</span>
				<span class="text-sm text-[var(--color-text-primary)]">{license.tenantName}</span>
			</div>

			<div class="flex items-center justify-between py-2">
				<span class="text-sm text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.currentPlanCreatedAt}</span>
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

	<!-- 無料トライアル -->
	{#if planTier === 'free' && trialStatus}
		<Card variant="default" padding="lg">
			{#snippet children()}
			{#if trialStatus.isTrialActive}
				<div class="text-center">
					<p class="text-sm font-semibold text-[var(--color-feedback-info-text)] mb-1">
						{SUBSCRIPTION_PAGE_LABELS.trialActiveTitle}
					</p>
					<p class="text-2xl font-bold text-[var(--color-feedback-info-text)]">
						{SUBSCRIPTION_PAGE_LABELS.trialActiveDays(trialStatus.daysRemaining)}
					</p>
					<p class="text-xs text-[var(--color-text-tertiary)] mt-1">
						{SUBSCRIPTION_PAGE_LABELS.trialActiveUntil(trialStatus.trialEndDate)}
					</p>
				</div>
			{:else if !trialStatus.trialUsed}
				<div class="text-center">
					<p class="text-lg font-bold text-[var(--color-text-primary)] mb-1">
						{SUBSCRIPTION_PAGE_LABELS.trialStartTitle}
					</p>
					<p class="text-sm text-[var(--color-text-muted)] mb-4">
						{SUBSCRIPTION_PAGE_LABELS.trialStartDesc}
					</p>
					<form
						method="POST"
						action="?/startTrial"
						use:enhance={() => {
							trialSubmitting = true;
							trialStartError = '';
							return async ({ result, update }) => {
								await update({ reset: false });
								if (result.type === 'success') {
									await invalidateAll();
								} else if (result.type === 'failure') {
									// #2941 item 2: fail(400) must be visible to the user (NN/G #1)
									trialStartError = getActionErrorDisplay(
										result.data?.error,
										TRIAL_LABELS.startErrorFallback,
									).message;
								}
								trialSubmitting = false;
							};
						}}
					>
						<Button
							type="submit"
							variant="primary"
							size="md"
							class="w-full"
							loading={trialSubmitting}
							data-testid="subscription-start-trial-button"
						>
							{trialSubmitting
								? ACTION_LABELS.submitting
								: SUBSCRIPTION_PAGE_LABELS.trialStartButton}
						</Button>
					</form>
					{#if trialStartError}
						<p
							class="text-xs font-semibold text-[var(--color-feedback-error-text)] mt-2"
							role="alert"
							data-testid="subscription-start-trial-error"
						>
							{trialStartError}
						</p>
					{/if}
					<p class="text-xs text-[var(--color-text-tertiary)] mt-2">
						{SUBSCRIPTION_PAGE_LABELS.trialStartNote}
					</p>
				</div>
			{:else}
				<p class="text-sm text-[var(--color-text-tertiary)] text-center">
					{SUBSCRIPTION_PAGE_LABELS.trialUsed}
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
			<h3 class="text-sm font-semibold text-[var(--color-feedback-warning-text)] mb-1">{SUBSCRIPTION_PAGE_LABELS.gracePeriodTitle}</h3>
			<p class="text-sm text-[var(--color-feedback-warning-text)]">
				{SUBSCRIPTION_PAGE_LABELS.gracePeriodDesc}
			</p>
		</section>
	{:else if license.status === SUBSCRIPTION_STATUS.SUSPENDED}
		<section class="bg-[var(--color-feedback-warning-bg)] rounded-xl p-4 border border-[var(--color-feedback-warning-border)]">
			<h3 class="text-sm font-semibold text-[var(--color-feedback-warning-text)] mb-1">{SUBSCRIPTION_PAGE_LABELS.suspendedTitle}</h3>
			<p class="text-sm text-[var(--color-feedback-warning-text)]">
				{SUBSCRIPTION_PAGE_LABELS.suspendedDesc}
			</p>
		</section>
	{:else if license.status === SUBSCRIPTION_STATUS.TERMINATED}
		<section class="bg-[var(--color-feedback-error-bg)] rounded-xl p-4 border border-[var(--color-feedback-error-border)]">
			<h3 class="text-sm font-semibold text-[var(--color-feedback-error-text)] mb-1">{SUBSCRIPTION_PAGE_LABELS.terminatedTitle}</h3>
			<p class="text-sm text-[var(--color-feedback-error-text)]">
				{SUBSCRIPTION_PAGE_LABELS.terminatedDesc}
			</p>
		</section>
	{/if}

	<!-- プラン管理 -->
	<!-- EPIC #2327 子#2330 AC3: stripeEnabled false 分岐 placeholder「決済機能は現在準備中です」削除 -->
	{#if stripeEnabled}
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">{SUBSCRIPTION_PAGE_LABELS.planManagementTitle}</h3>

		{#if hasSubscription}
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
					{SUBSCRIPTION_PAGE_LABELS.portalButton(portalLoading)}
				</Button>
				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					{SUBSCRIPTION_PAGE_LABELS.portalNote}
				</p>
				<p class="text-xs text-[var(--color-feedback-warning-text)] text-center">
					{SUBSCRIPTION_PAGE_LABELS.portalPinNote(pinConfigured)}
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
						{SUBSCRIPTION_PAGE_LABELS.billingMonthly}
					</button>
					<button
						class="interval-btn"
						class:active={billingInterval === 'yearly'}
						onclick={() => (billingInterval = 'yearly')}
					>
						{SUBSCRIPTION_PAGE_LABELS.billingYearly}
					</button>
				</div>

				<!-- PLAN_LABELS.standard -->
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
							<p class="font-semibold text-[var(--color-text-primary)]">{SUBSCRIPTION_PAGE_LABELS.standardPlanName}</p>
							<p class="text-xs text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.standardPlanDesc}</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">{SUBSCRIPTION_PAGE_LABELS.standardPriceMonthly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.standardPerMonth}</span></p>
						{:else}
							<div class="text-right">
								<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">{SUBSCRIPTION_PAGE_LABELS.standardPriceYearly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.standardPerYear}</span></p>
								<p class="text-xs text-[var(--color-feedback-success-text)]" data-testid="standard-yearly-monthly-equiv">{SUBSCRIPTION_PAGE_LABELS.standardYearlyMonthlyEquiv}</p>
							</div>
						{/if}
					</div>
					<ul class="text-xs text-[var(--color-text-muted)] space-y-1 mb-3">
						{#each getLicenseHighlights('standard') as highlight}
							<li>{highlight}</li>
						{/each}
					</ul>
				</div>

				<!-- PLAN_LABELS.family -->
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
					<span class="recommend-badge">{SUBSCRIPTION_PAGE_LABELS.familyRecommendBadge}</span>
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-[var(--color-text-primary)]">{SUBSCRIPTION_PAGE_LABELS.familyPlanName}</p>
							<p class="text-xs text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.familyPlanDesc}</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-[var(--color-stat-purple)]">{SUBSCRIPTION_PAGE_LABELS.familyPriceMonthly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.standardPerMonth}</span></p>
						{:else}
							<div class="text-right">
								<p class="text-xl font-bold text-[var(--color-stat-purple)]">{SUBSCRIPTION_PAGE_LABELS.familyPriceYearly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{SUBSCRIPTION_PAGE_LABELS.standardPerYear}</span></p>
								<p class="text-xs text-[var(--color-feedback-success-text)]" data-testid="family-yearly-monthly-equiv">{SUBSCRIPTION_PAGE_LABELS.familyYearlyMonthlyEquiv}</p>
							</div>
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
					{SUBSCRIPTION_PAGE_LABELS.checkoutButton(selectedTier, checkoutLoading)}
				</Button>

				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					{SUBSCRIPTION_PAGE_LABELS.checkoutNote}
				</p>
			</div>
		{/if}
		{/snippet}
	</Card>
	{/if}

	<!-- 支払い履歴 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">{SUBSCRIPTION_PAGE_LABELS.paymentHistoryTitle}</h3>
		{#if hasSubscription}
			<p class="text-sm text-[var(--color-text-muted)] text-center py-4">
				{SUBSCRIPTION_PAGE_LABELS.paymentHistoryPortalNote}
			</p>
			<Button
				onclick={requestPortal}
				disabled={portalLoading}
				variant="secondary"
				size="sm"
				class="w-full"
			>
				{SUBSCRIPTION_PAGE_LABELS.paymentHistoryPortalButton}
			</Button>
		{:else}
			<p class="text-sm text-[var(--color-text-tertiary)] text-center py-4">
				{SUBSCRIPTION_PAGE_LABELS.paymentHistoryEmpty}
			</p>
		{/if}
		<div class="mt-4 pt-3 border-t border-[var(--color-border-light)]">
			<a
				href="/admin/billing"
				class="flex items-center justify-between text-sm text-[var(--color-text-link)] hover:underline"
				data-testid="license-to-billing"
			>
				<span>{SUBSCRIPTION_PAGE_LABELS.paymentHistoryBillingLink}</span>
				<span>&rarr;</span>
			</a>
		</div>
		{/snippet}
	</Card>

	<!-- #771: プラン変更 (Stripe Portal) 前の二段階確認ダイアログ -->
	<Dialog bind:open={showPortalConfirm} title={SUBSCRIPTION_PAGE_LABELS.portalConfirmTitle}>
		{#snippet children()}
		<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
			<p>
				{SUBSCRIPTION_PAGE_LABELS.portalConfirmDesc}
			</p>
			<p class="text-[var(--color-feedback-warning-text)] font-semibold">
				{SUBSCRIPTION_PAGE_LABELS.portalConfirmWarning}{pinConfigured ? OYAKAGI_LABELS.inputLabel : SUBSCRIPTION_PAGE_LABELS.portalConfirmWarningPhrase}{SUBSCRIPTION_PAGE_LABELS.portalConfirmWarningPin}
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
						{SUBSCRIPTION_PAGE_LABELS.portalConfirmPhraseLabel(DOWNGRADE_CONFIRM_PHRASE)}
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
				{SUBSCRIPTION_PAGE_LABELS.portalConfirmCancel}
			</Button>
			<Button
				type="button"
				variant="primary"
				size="md"
				onclick={openPortal}
				disabled={portalLoading}
				data-testid="portal-confirm-button"
			>
				{portalLoading ? SUBSCRIPTION_PAGE_LABELS.portalConfirmLoading : SUBSCRIPTION_PAGE_LABELS.portalConfirmSubmit}
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
			...(data.loyaltyInfo.subscriptionMonths > 0 ? [SUBSCRIPTION_PAGE_LABELS.churnLostItemMonthly(data.loyaltyInfo.subscriptionMonths)] : []),
			...(data.loyaltyInfo.memoryTickets > 0 ? [SUBSCRIPTION_PAGE_LABELS.churnLostItemTickets(data.loyaltyInfo.memoryTickets)] : []),
			...(data.loyaltyInfo.loginBonusMultiplier > 1 ? [SUBSCRIPTION_PAGE_LABELS.churnLostItemBonus(data.loyaltyInfo.loginBonusMultiplier)] : []),
			...(data.loyaltyInfo.currentTier.titleUnlock ? [SUBSCRIPTION_PAGE_LABELS.churnLostItemTitle(data.loyaltyInfo.currentTier.titleUnlock)] : []),
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
