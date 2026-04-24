<script lang="ts">
// /demo/admin/license — デモ版プラン・お支払い画面 (#790, #817)
// 本番 /admin/license の見た目に合わせつつ、Stripe 決済はデモトースト、
// ライセンスキー適用はモックフロー（入力→確認ダイアログ→プラン変化アニメーション）で再現。

import { onMount } from 'svelte';
import { APP_LABELS, getPlanLabel, LICENSE_PAGE_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import { getLicenseHighlights } from '$lib/domain/plan-features';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { showToast } from '$lib/ui/primitives/Toast.svelte';

let { data } = $props();

const license = $derived(data.license);
const planStats = $derived(data.planStats);

let selectedTier = $state<'standard' | 'family'>('standard');
let billingInterval = $state<'monthly' | 'yearly'>('monthly');
let hydrated = $state(false);
let applyDelayTimer: ReturnType<typeof setTimeout> | undefined;
let applySuccessTimer: ReturnType<typeof setTimeout> | undefined;

// #817: ライセンスキー適用モックフロー
let licenseKeyInput = $state('');
let showApplyConfirm = $state(false);
let agreedLicenseOnce = $state(false);
let applyLoading = $state(false);
let showLicenseHelp = $state(false);
// モック: 適用成功後にプランが切り替わる演出
let appliedPlan = $state<'free' | 'standard' | 'family'>('free');
let showApplySuccess = $state(false);

const currentPlanLabel = $derived(getPlanLabel(appliedPlan));

// E2E hydration マーカー (data-hydrated 属性でハンドラ attach 完了を検知可能にする)
onMount(() => {
	hydrated = true;
	return () => {
		clearTimeout(applyDelayTimer);
		clearTimeout(applySuccessTimer);
	};
});

function notifyDemoOnly() {
	showToast(LICENSE_PAGE_LABELS.demoNoticeToastText, undefined, 'info');
}

/** #817: デモ用ライセンスキー適用モック。入力値に応じてプランを変更する演出 */
function handleMockApply() {
	applyLoading = true;
	// 500ms の擬似遅延でリアルな体験を模擬
	clearTimeout(applyDelayTimer);
	clearTimeout(applySuccessTimer);
	applyDelayTimer = setTimeout(() => {
		// キー入力に "FAMILY" が含まれていればファミリー、それ以外はスタンダード
		const key = licenseKeyInput.toUpperCase();
		appliedPlan = key.includes('FAMILY') ? 'family' : 'standard';
		applyLoading = false;
		showApplyConfirm = false;
		showApplySuccess = true;
		licenseKeyInput = '';
		agreedLicenseOnce = false;
		// 5秒後に成功メッセージを非表示
		applySuccessTimer = setTimeout(() => {
			showApplySuccess = false;
		}, 5000);
	}, 500);
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.demoAdminLicense}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6" data-testid="demo-license-page" data-hydrated={hydrated ? 'true' : 'false'}>
	<!-- デモ説明 -->
	<Alert variant="info" data-testid="demo-license-notice">
		{#snippet children()}
			<p class="text-sm font-semibold mb-1">{LICENSE_PAGE_LABELS.demoNotice}</p>
			<p class="text-xs">
				{LICENSE_PAGE_LABELS.demoNoticeDesc}
			</p>
		{/snippet}
	</Alert>

	<!-- #817: 適用成功メッセージ -->
	{#if showApplySuccess}
		<Alert variant="success" data-testid="demo-apply-success">
			{#snippet children()}
				<p class="text-sm font-semibold">{LICENSE_PAGE_LABELS.demoApplySuccessTitle}</p>
				<p class="text-xs mt-1">
					{LICENSE_PAGE_LABELS.demoApplySuccessDesc(currentPlanLabel)}
				</p>
			{/snippet}
		</Alert>
	{/if}

	<!-- 現在のプラン -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">{LICENSE_PAGE_LABELS.demoCurrentPlanTitle}</h3>

			<div class="grid gap-4">
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.currentPlanLabel}</span>
					<span class="text-sm font-semibold text-[var(--color-text-primary)]" data-testid="demo-current-plan">{currentPlanLabel}</span>
				</div>
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.currentPlanStatus}</span>
					<span class="text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]">
						✅ {LICENSE_PAGE_LABELS.statusActive}
					</span>
				</div>
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

	<!-- プラン利用状況（デモ版: PlanStatusCard は CTA が /admin/license にハードコードされているため使わない） -->
	{#if planStats}
		<Card variant="default" padding="lg">
			{#snippet children()}
				<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-3">{LICENSE_PAGE_LABELS.demoPlanUsageTitle}</h3>
				<div class="grid grid-cols-3 gap-4">
					<div class="flex flex-col gap-0.5">
						<span class="text-xs text-[var(--color-text-tertiary)]">{LICENSE_PAGE_LABELS.demoPlanUsageActivity}</span>
						<span class="text-sm font-semibold text-[var(--color-text-primary)]">
							{planStats.activityCount} / {LICENSE_PAGE_LABELS.demoPlanUsageMaxValue(planStats.activityMax)}
						</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class="text-xs text-[var(--color-text-tertiary)]">{LICENSE_PAGE_LABELS.demoPlanUsageChildren}</span>
						<span class="text-sm font-semibold text-[var(--color-text-primary)]">
							{planStats.childCount} / {LICENSE_PAGE_LABELS.demoPlanUsageMaxValue(planStats.childMax)}
						</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class="text-xs text-[var(--color-text-tertiary)]">{LICENSE_PAGE_LABELS.demoPlanUsageRetention}</span>
						<span class="text-sm font-semibold text-[var(--color-text-primary)]">
							{LICENSE_PAGE_LABELS.demoPlanUsageRetentionValue(planStats.retentionDays)}
						</span>
					</div>
				</div>
			{/snippet}
		</Card>
	{/if}

	<!-- 無料トライアル（デモ版） -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<div class="text-center">
				<p class="text-lg font-bold text-[var(--color-text-primary)] mb-1">
					{LICENSE_PAGE_LABELS.trialStartTitle}
				</p>
				<p class="text-sm text-[var(--color-text-muted)] mb-4">
					{LICENSE_PAGE_LABELS.trialStartDesc}
				</p>
				<Button
					type="button"
					variant="primary"
					size="md"
					class="w-full"
					onclick={notifyDemoOnly}
					data-testid="demo-trial-start-button"
				>
					{LICENSE_PAGE_LABELS.trialStartButton}
				</Button>
				<p class="text-xs text-[var(--color-text-tertiary)] mt-2">
					{LICENSE_PAGE_LABELS.demoTrialNote}
				</p>
			</div>
		{/snippet}
	</Card>

	<!-- #817: ライセンスキー適用（デモ版 — 本番同等のモックフロー） -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">
				{LICENSE_PAGE_LABELS.demoLicenseKeyTitle}
			</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-3">
				{LICENSE_PAGE_LABELS.demoLicenseKeyDesc}
			</p>
			<div class="space-y-3">
				<label for="demoLicenseKey" class="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
					{LICENSE_PAGE_LABELS.licenseKeyInputLabel}
				</label>
				<input
					id="demoLicenseKey"
					type="text"
					bind:value={licenseKeyInput}
					placeholder="GQ-XXXX-XXXX-XXXX"
					autocomplete="off"
					class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
					data-testid="demo-license-key-input"
				/>

				<!-- #799: 折りたたみヘルプ -->
				<div>
					<button
						type="button"
						class="text-xs text-[var(--color-text-link)] underline hover:no-underline"
						aria-expanded={showLicenseHelp}
						onclick={() => { showLicenseHelp = !showLicenseHelp; }}
						data-testid="demo-license-help-toggle"
					>
						{showLicenseHelp ? '▼' : '▶'} {LICENSE_PAGE_LABELS.licenseKeyHelpToggle}
					</button>
					{#if showLicenseHelp}
						<div
							class="mt-2 p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-muted)] leading-relaxed space-y-1.5"
							data-testid="demo-license-help"
						>
							<p><strong class="text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.licenseKeyHelpOnce}</strong>: {LICENSE_PAGE_LABELS.licenseKeyHelpOnceDesc}</p>
							<p><strong class="text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.demoLicenseKeyHelpAutoGrant}</strong>: {LICENSE_PAGE_LABELS.demoLicenseKeyHelpAutoGrantDesc}</p>
							<p><strong class="text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.licenseKeyHelpBound}</strong>: {LICENSE_PAGE_LABELS.demoLicenseKeyHelpBoundDesc}</p>
							<p><strong class="text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.licenseKeyHelpIrreversible}</strong>: {LICENSE_PAGE_LABELS.demoLicenseKeyHelpIrreversibleDesc}</p>
						</div>
					{/if}
				</div>

				<Button
					type="button"
					variant="primary"
					size="md"
					class="w-full"
					disabled={!licenseKeyInput.trim()}
					onclick={() => {
						agreedLicenseOnce = false;
						showApplyConfirm = true;
					}}
					data-testid="demo-license-key-apply-button"
				>
					{LICENSE_PAGE_LABELS.licenseKeyApplyButton}
				</Button>
				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					{LICENSE_PAGE_LABELS.demoLicenseKeyNote}
				</p>
			</div>

			<!-- #817: 確認ダイアログ（本番同等） -->
			<Dialog
				bind:open={showApplyConfirm}
				title={LICENSE_PAGE_LABELS.licenseKeyConfirmTitle}
				testid="demo-license-key-confirm-dialog"
			>
				{#snippet children()}
				<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
					<p>{LICENSE_PAGE_LABELS.licenseKeyConfirmDesc}</p>
					<ul class="list-disc pl-5 text-[var(--color-text-muted)] space-y-1">
						<li><strong>{LICENSE_PAGE_LABELS.licenseKeyConfirmOnce}</strong>{LICENSE_PAGE_LABELS.licenseKeyConfirmOnceDesc}</li>
						<li>{LICENSE_PAGE_LABELS.licenseKeyConfirmPlanPrefix}<strong>{LICENSE_PAGE_LABELS.licenseKeyConfirmPlan}</strong>{LICENSE_PAGE_LABELS.demoLicenseKeyConfirmPlanDesc}</li>
						<li>{LICENSE_PAGE_LABELS.demoLicenseKeyConfirmBound("デモファミリー")}</li>
						<li>{LICENSE_PAGE_LABELS.licenseKeyConfirmIrreversiblePrefix}<strong>{LICENSE_PAGE_LABELS.licenseKeyConfirmIrreversible}</strong></li>
					</ul>
					<div class="rounded-lg bg-[var(--color-surface-muted)] px-3 py-2">
						<p class="text-[10px] text-[var(--color-text-tertiary)] mb-0.5">{LICENSE_PAGE_LABELS.licenseKeyEnteredKey}</p>
						<p class="font-mono text-xs text-[var(--color-text-secondary)] break-all" data-testid="demo-license-key-confirm-display">
							{licenseKeyInput}
						</p>
					</div>

					<label class="flex items-start gap-2 cursor-pointer pt-1">
						<input
							type="checkbox"
							bind:checked={agreedLicenseOnce}
							class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)]"
							data-testid="demo-license-key-once-checkbox"
						/>
						<span class="text-xs text-[var(--color-text-muted)] leading-relaxed">
							{LICENSE_PAGE_LABELS.licenseKeyAgreePrefix}<strong class="text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.licenseKeyAgreeOnce}</strong>{LICENSE_PAGE_LABELS.licenseKeyAgreeOnceDesc}
						</span>
					</label>

					<Alert variant="info">
						{#snippet children()}
							<p class="text-xs">{LICENSE_PAGE_LABELS.demoLicenseKeyMockNote}</p>
						{/snippet}
					</Alert>
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
						data-testid="demo-license-key-confirm-button"
						onclick={handleMockApply}
					>
						{applyLoading ? LICENSE_PAGE_LABELS.licenseKeyApplyLoading : LICENSE_PAGE_LABELS.licenseKeyApplyConfirm}
					</Button>
				</div>
				{/snippet}
			</Dialog>
		{/snippet}
	</Card>

	<!-- プラン管理 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">{LICENSE_PAGE_LABELS.demoPlanManagementTitle}</h3>

			<div class="grid gap-4">
				<!-- 請求間隔切り替え -->
				<div class="flex justify-center gap-2 mb-2">
					<button
						type="button"
						class="interval-btn"
						class:active={billingInterval === 'monthly'}
						onclick={() => (billingInterval = 'monthly')}
					>
						{LICENSE_PAGE_LABELS.billingMonthly}
					</button>
					<button
						type="button"
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
					onclick={() => (selectedTier = 'standard')}
					onkeydown={(e) => e.key === 'Enter' && (selectedTier = 'standard')}
				>
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-[var(--color-text-primary)]">{LICENSE_PAGE_LABELS.standardPlanName}</p>
							<p class="text-xs text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.standardPlanDesc}</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">
								{LICENSE_PAGE_LABELS.standardPriceMonthly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.standardPerMonth}</span>
							</p>
						{:else}
							<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">
								{LICENSE_PAGE_LABELS.standardPriceYearly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.standardPerYear}</span>
							</p>
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
					class="plan-card recommended"
					class:selected={selectedTier === 'family'}
					role="button"
					tabindex="0"
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
							<p class="text-xl font-bold text-[var(--color-stat-purple)]">
								{LICENSE_PAGE_LABELS.familyPriceMonthly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.standardPerMonth}</span>
							</p>
						{:else}
							<p class="text-xl font-bold text-[var(--color-stat-purple)]">
								{LICENSE_PAGE_LABELS.familyPriceYearly}<span class="text-sm font-normal text-[var(--color-text-muted)]">{LICENSE_PAGE_LABELS.standardPerYear}</span>
							</p>
						{/if}
					</div>
					<ul class="text-xs text-[var(--color-text-muted)] space-y-1 mb-3">
						{#each getLicenseHighlights('family') as highlight}
							<li>{highlight}</li>
						{/each}
					</ul>
				</div>

				<!-- 購入ボタン（デモ） -->
				<Button
					type="button"
					variant="primary"
					size="md"
					class="w-full"
					onclick={notifyDemoOnly}
					data-testid="demo-checkout-button"
				>
					{LICENSE_PAGE_LABELS.demoCheckoutButton(selectedTier)}
				</Button>

				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					{LICENSE_PAGE_LABELS.demoCheckoutNote}
				</p>
			</div>
		{/snippet}
	</Card>

	<!-- 支払い履歴 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
			<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">{LICENSE_PAGE_LABELS.demoPaymentHistoryTitle}</h3>
			<p class="text-sm text-[var(--color-text-tertiary)] text-center py-4">
				{LICENSE_PAGE_LABELS.paymentHistoryEmpty}
			</p>
		{/snippet}
	</Card>

</div>

<style>
	.interval-btn {
		padding: 6px 16px;
		font-size: 0.8rem;
		font-weight: 600;
		border-radius: 8px;
		border: 1px solid var(--color-border-default);
		background: var(--color-surface-card);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}

	.interval-btn.active {
		background: var(--color-action-primary);
		color: var(--color-text-inverse);
		border-color: var(--color-action-primary);
	}

	.plan-card {
		position: relative;
		border: 2px solid var(--color-border-default);
		border-radius: 12px;
		padding: 16px;
		cursor: pointer;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.plan-card:hover {
		border-color: var(--color-border-focus);
	}

	.plan-card.selected {
		border-color: var(--color-action-primary);
		box-shadow: 0 0 0 1px var(--color-action-primary);
	}

	.recommend-badge {
		position: absolute;
		top: -10px;
		left: 16px;
		background: var(--color-action-primary);
		color: var(--color-text-inverse);
		font-size: 0.7rem;
		font-weight: 700;
		padding: 2px 10px;
		border-radius: 9999px;
	}

</style>
