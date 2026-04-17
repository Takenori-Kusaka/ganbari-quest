<script lang="ts">
import { enhance } from '$app/forms';
import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { DowngradePreview } from '$lib/domain/downgrade-types';
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
		: `${downgradeRetentionDays}日以前のデータへのアクセス`,
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
			return 'スタンダード月額（¥500/月）';
		case LICENSE_PLAN.YEARLY:
			return 'スタンダード年額（¥5,000/年）';
		case LICENSE_PLAN.FAMILY_MONTHLY:
			return 'ファミリー月額（¥780/月）';
		case LICENSE_PLAN.FAMILY_YEARLY:
			return 'ファミリー年額（¥7,800/年）';
		case LICENSE_PLAN.LIFETIME:
			return '永久ライセンス';
		case 'free':
			return '無料プラン';
		default:
			return plan;
	}
};

const statusLabel = (status: string) => {
	switch (status) {
		case SUBSCRIPTION_STATUS.ACTIVE:
			return {
				text: '有効',
				color:
					'bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]',
				icon: '✅',
			};
		case SUBSCRIPTION_STATUS.GRACE_PERIOD:
			return {
				text: '猶予期間',
				color:
					'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]',
				icon: '⚠️',
			};
		case SUBSCRIPTION_STATUS.SUSPENDED:
			return {
				text: '停止中',
				color:
					'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]',
				icon: '⏸️',
			};
		case SUBSCRIPTION_STATUS.TERMINATED:
			return {
				text: '解約済み',
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
				(body as { message?: string }).message ?? 'リソースのアーカイブに失敗しました';
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
			portalError = 'PINコード（4〜6桁の数字）を入力してください';
			return;
		}
	} else {
		if (portalConfirmPhrase !== DOWNGRADE_CONFIRM_PHRASE) {
			portalError = `「${DOWNGRADE_CONFIRM_PHRASE}」と入力してください`;
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
			let message = 'プラン変更の確認に失敗しました';
			try {
				const body = (await res.json()) as { message?: string };
				const raw = body.message ?? '';
				if (raw === 'INVALID_PIN' || raw === 'PIN_REQUIRED') {
					message = 'PINコードが正しくありません';
				} else if (raw.startsWith('LOCKED_OUT')) {
					message = 'PIN認証のロックアウト中です。しばらく待ってから再度お試しください';
				} else if (raw === 'CONFIRM_PHRASE_REQUIRED') {
					message = `「${DOWNGRADE_CONFIRM_PHRASE}」と入力してください`;
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
		portalError = err instanceof Error ? err.message : 'プラン変更の確認に失敗しました';
	} finally {
		portalLoading = false;
	}
}
</script>

<svelte:head>
	<title>プラン・お支払い - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<!-- 現在のプラン -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">現在のプラン</h3>

		<div class="grid gap-4">
			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">プラン</span>
				<span class="text-sm font-semibold text-[var(--color-text-primary)]">{planLabel(license.plan ?? 'free')}</span>
			</div>

			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">ステータス</span>
				<span class="text-xs font-medium px-2.5 py-1 rounded-full {status.color}">
					{status.icon} {status.text}
				</span>
			</div>

			{#if license.planExpiresAt}
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">有効期限</span>
					<span class="text-sm text-[var(--color-text-primary)]">
						{new Date(license.planExpiresAt).toLocaleDateString('ja-JP')}
					</span>
				</div>
			{/if}

			{#if license.licenseKey}
				<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
					<span class="text-sm text-[var(--color-text-muted)]">ライセンスキー</span>
					<code class="text-xs bg-[var(--color-surface-muted)] px-2 py-1 rounded font-mono text-[var(--color-text-secondary)]">
						{license.licenseKey}
					</code>
				</div>
			{/if}

			<div class="flex items-center justify-between py-2 border-b border-[var(--color-surface-muted)]">
				<span class="text-sm text-[var(--color-text-muted)]">家族名</span>
				<span class="text-sm text-[var(--color-text-primary)]">{license.tenantName}</span>
			</div>

			<div class="flex items-center justify-between py-2">
				<span class="text-sm text-[var(--color-text-muted)]">登録日</span>
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
				ライセンスキーを適用
			</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">
				キャンペーン・サポート窓口から受け取ったライセンスキーを入力して、プランを有効化できます。
			</p>

			{#if applySuccess}
				<Alert variant="success" class="mb-3">
					{#snippet children()}
					ライセンスキーを適用しました。プランが更新されています。
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
					ライセンスキー
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
						{showLicenseHelp ? '▼' : '▶'} ライセンスキーについて
					</button>
					{#if showLicenseHelp}
						<div
							id="admin-license-help"
							class="mt-2 p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-muted)] leading-relaxed space-y-1.5"
							data-testid="license-help-body"
						>
							<p><strong class="text-[var(--color-text-primary)]">一回限りの使用</strong>: 一度有効化すると、他のアカウントでは使用できません。</p>
							<p><strong class="text-[var(--color-text-primary)]">プラン上書き</strong>: 現在のプランはキーに対応するプランに上書きされます。</p>
							<p><strong class="text-[var(--color-text-primary)]">紐付け先</strong>: 現在のアカウント（家族）に紐付き、他の家族へ付け替えることはできません。</p>
							<p><strong class="text-[var(--color-text-primary)]">取り消し不可</strong>: 適用後に取り消すことはできません。</p>
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
					ライセンスキーを適用
				</Button>

			</form>

				<Dialog
					bind:open={showApplyConfirm}
					title="ライセンスキーを有効化しますか？"
					testid="license-key-confirm-dialog"
				>
					{#snippet children()}
					<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
						<p>
							入力されたライセンスキーを現在のアカウントに適用します。
						</p>
						<ul class="list-disc pl-5 text-[var(--color-text-muted)] space-y-1">
							<li><strong>一回限り</strong>使用可能です（適用後は他アカウントで使えなくなります）</li>
							<li>キーに対応する<strong>プラン</strong>が自動で付与され、現在のプランは上書きされます</li>
							<li>このキーは<strong>「{license.tenantName}」</strong>に紐付けられ、他の家族に付け替えできません</li>
							<li>適用を<strong>取り消すことはできません</strong></li>
						</ul>
						<div class="rounded-lg bg-[var(--color-surface-muted)] px-3 py-2">
							<p class="text-[10px] text-[var(--color-text-tertiary)] mb-0.5">入力されたキー</p>
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
								このライセンスキーが<strong class="text-[var(--color-text-primary)]">一回限り使用</strong>であり、他のアカウントでは使えなくなることに同意します
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
							キャンセル
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
							{applyLoading ? '適用中…' : '適用する'}
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
						スタンダードプラン トライアル中
					</p>
					<p class="text-2xl font-bold text-[var(--color-feedback-info-text)]">
						残り {trialStatus.daysRemaining}日
					</p>
					<p class="text-xs text-[var(--color-text-tertiary)] mt-1">
						{trialStatus.trialEndDate} まで
					</p>
				</div>
			{:else if !trialStatus.trialUsed}
				<div class="text-center">
					<p class="text-lg font-bold text-[var(--color-text-primary)] mb-1">
						7日間 無料でお試し
					</p>
					<p class="text-sm text-[var(--color-text-muted)] mb-4">
						スタンダードプランの全機能を体験できます
					</p>
					<form method="POST" action="?/startTrial">
						<Button
							type="submit"
							variant="primary"
							size="md"
							class="w-full"
						>
							無料トライアルを開始する
						</Button>
					</form>
					<p class="text-xs text-[var(--color-text-tertiary)] mt-2">
						クレジットカード不要 — 自動で課金されることはありません
					</p>
				</div>
			{:else}
				<p class="text-sm text-[var(--color-text-tertiary)] text-center">
					無料トライアルは使用済みです
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
			<h3 class="text-sm font-semibold text-[var(--color-feedback-warning-text)] mb-1">⚠️ 猶予期間中</h3>
			<p class="text-sm text-[var(--color-feedback-warning-text)]">
				お支払いの確認が取れていません。猶予期間内にお支払いを完了してください。
				期間を過ぎるとサービスが停止されます。
			</p>
		</section>
	{:else if license.status === SUBSCRIPTION_STATUS.SUSPENDED}
		<section class="bg-[var(--color-feedback-warning-bg)] rounded-xl p-4 border border-[var(--color-feedback-warning-border)]">
			<h3 class="text-sm font-semibold text-[var(--color-feedback-warning-text)] mb-1">⏸️ サービス停止中</h3>
			<p class="text-sm text-[var(--color-feedback-warning-text)]">
				ライセンスが停止されています。データは保持されていますが、
				新しい活動の記録やポイントの付与はできません。
			</p>
		</section>
	{:else if license.status === SUBSCRIPTION_STATUS.TERMINATED}
		<section class="bg-[var(--color-feedback-error-bg)] rounded-xl p-4 border border-[var(--color-feedback-error-border)]">
			<h3 class="text-sm font-semibold text-[var(--color-feedback-error-text)] mb-1">❌ 解約済み</h3>
			<p class="text-sm text-[var(--color-feedback-error-text)]">
				このアカウントは解約されています。データは一定期間保持されますが、
				その後削除されます。
			</p>
		</section>
	{/if}

	<!-- プラン管理 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">プラン管理</h3>

		{#if !stripeEnabled}
			<p class="text-sm text-[var(--color-text-tertiary)] text-center py-4">
				決済機能は現在準備中です
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
					{portalLoading ? '読み込み中...' : 'プラン変更・支払い管理'}
				</Button>
				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					Stripeの管理画面でプラン変更・支払い方法の更新・解約ができます
				</p>
				<p class="text-xs text-[var(--color-feedback-warning-text)] text-center">
					⚠️ プラン変更には{pinConfigured ? '親 PIN' : '確認フレーズ'}の入力が必要です
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
						月額
					</button>
					<button
						class="interval-btn"
						class:active={billingInterval === 'yearly'}
						onclick={() => (billingInterval = 'yearly')}
					>
						年額（17% OFF）
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
							<p class="font-semibold text-[var(--color-text-primary)]">スタンダード</p>
							<p class="text-xs text-[var(--color-text-muted)]">子供無制限・活動無制限・1年保持</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">¥500<span class="text-sm font-normal text-[var(--color-text-muted)]">/月</span></p>
						{:else}
							<p class="text-xl font-bold text-[var(--color-feedback-info-text)]">¥5,000<span class="text-sm font-normal text-[var(--color-text-muted)]">/年</span></p>
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
					<span class="recommend-badge">おすすめ</span>
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-[var(--color-text-primary)]">ファミリー</p>
							<p class="text-xs text-[var(--color-text-muted)]">家族みんなで見守る+永久保持</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-[var(--color-stat-purple)]">¥780<span class="text-sm font-normal text-[var(--color-text-muted)]">/月</span></p>
						{:else}
							<p class="text-xl font-bold text-[var(--color-stat-purple)]">¥7,800<span class="text-sm font-normal text-[var(--color-text-muted)]">/年</span></p>
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
					{checkoutLoading ? '処理中...' : `${selectedTier === 'family' ? 'ファミリー' : 'スタンダード'}プランで始める`}
				</Button>

				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					いつでもキャンセル・プラン変更可能
				</p>
			</div>
		{/if}
		{/snippet}
	</Card>

	<!-- 支払い履歴 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-[var(--color-text-secondary)] mb-4">支払い履歴</h3>
		{#if hasSubscription}
			<p class="text-sm text-[var(--color-text-muted)] text-center py-4">
				支払い履歴はStripeの管理画面でご確認いただけます
			</p>
			<Button
				onclick={requestPortal}
				disabled={portalLoading}
				variant="secondary"
				size="sm"
				class="w-full"
			>
				支払い履歴を確認
			</Button>
		{:else}
			<p class="text-sm text-[var(--color-text-tertiary)] text-center py-4">
				支払い履歴はまだありません
			</p>
		{/if}
		<div class="mt-4 pt-3 border-t border-[var(--color-border-light)]">
			<a
				href="/admin/billing"
				class="flex items-center justify-between text-sm text-[var(--color-text-link)] hover:underline"
				data-testid="license-to-billing"
			>
				<span>🧾 請求書・支払い方法の管理</span>
				<span>&rarr;</span>
			</a>
		</div>
		{/snippet}
	</Card>

	<!-- #771: プラン変更 (Stripe Portal) 前の二段階確認ダイアログ -->
	<Dialog bind:open={showPortalConfirm} title="プラン変更の確認">
		{#snippet children()}
		<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
			<p>
				Stripeの管理画面に移動します。この画面からプラン変更・解約・ダウングレードが可能です。
			</p>
			<p class="text-[var(--color-feedback-warning-text)] font-semibold">
				⚠️ 誤操作による解約・ダウングレードを防ぐため、
				{pinConfigured ? '親 PIN コード（4〜6桁）' : '確認フレーズ'}を入力してください。
			</p>

			{#if pinConfigured}
				<div class="space-y-2">
					<label for="portal-pin" class="block text-sm font-medium text-[var(--color-text-primary)]">
						親 PIN コード（4〜6桁）
					</label>
					<input
						id="portal-pin"
						type="password"
						inputmode="numeric"
						pattern="[0-9]*"
						maxlength={6}
						minlength={4}
						bind:value={portalPinValue}
						placeholder="PIN を入力"
						autocomplete="off"
						data-testid="portal-pin-input"
						class="w-full rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
					/>
				</div>
			{:else}
				<div class="space-y-2">
					<label for="portal-confirm-phrase" class="block text-sm font-medium text-[var(--color-text-primary)]">
						確認のため「{DOWNGRADE_CONFIRM_PHRASE}」と入力してください
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
				キャンセル
			</Button>
			<Button
				type="button"
				variant="primary"
				size="md"
				onclick={openPortal}
				disabled={portalLoading}
				data-testid="portal-confirm-button"
			>
				{portalLoading ? '確認中…' : 'プラン変更画面へ'}
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
			...(data.loyaltyInfo.subscriptionMonths > 0 ? [`月替わり限定アイテム ${data.loyaltyInfo.subscriptionMonths}個`] : []),
			...(data.loyaltyInfo.memoryTickets > 0 ? [`思い出チケット ${data.loyaltyInfo.memoryTickets}枚`] : []),
			...(data.loyaltyInfo.loginBonusMultiplier > 1 ? [`ログインボーナス ×${data.loyaltyInfo.loginBonusMultiplier}倍`] : []),
			...(data.loyaltyInfo.currentTier.titleUnlock ? [`「${data.loyaltyInfo.currentTier.titleUnlock}」称号`] : []),
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
