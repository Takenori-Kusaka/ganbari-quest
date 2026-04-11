<script lang="ts">
import { enhance } from '$app/forms';
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
// #736: 解約時のダウングレード先 (free) の保持期間。PLAN_LIMITS 由来の動的値。
const downgradeRetentionDays = $derived(data.downgradeRetentionDays ?? 90);
// 解約して失うデータアクセスの表示文言（ハードコード "90日" を排除）
const churnLostRetentionLabel = $derived(`${downgradeRetentionDays}日以前のデータへのアクセス`);

let checkoutLoading = $state(false);
let portalLoading = $state(false);
let showChurnModal = $state(false);
let selectedTier = $state<'standard' | 'family'>('standard');
let billingInterval = $state<'monthly' | 'yearly'>('monthly');

// #796 ライセンスキー適用 UI 状態
let licenseKeyInput = $state('');
let applyLoading = $state(false);
let showApplyConfirm = $state(false);
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
		case 'monthly':
			return 'スタンダード月額（¥500/月）';
		case 'yearly':
			return 'スタンダード年額（¥5,000/年）';
		case 'family-monthly':
			return 'ファミリー月額（¥780/月）';
		case 'family-yearly':
			return 'ファミリー年額（¥7,800/年）';
		case 'lifetime':
			return '永久ライセンス';
		case 'free':
			return '無料プラン';
		default:
			return plan;
	}
};

const statusLabel = (status: string) => {
	switch (status) {
		case 'active':
			return {
				text: '有効',
				color:
					'bg-[var(--color-feedback-success-bg-strong)] text-[var(--color-feedback-success-text)]',
				icon: '✅',
			};
		case 'grace_period':
			return {
				text: '猶予期間',
				color:
					'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]',
				icon: '⚠️',
			};
		case 'suspended':
			return { text: '停止中', color: 'bg-orange-100 text-orange-700', icon: '⏸️' };
		case 'terminated':
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

async function openPortal() {
	portalLoading = true;
	try {
		const res = await fetch('/api/stripe/portal', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		});
		const data = await res.json();
		if (data.url) {
			window.location.href = data.url;
		}
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
				<Button
					type="button"
					variant="primary"
					size="md"
					class="mt-3 w-full"
					disabled={!licenseKeyInput.trim() || applyLoading}
					data-testid="license-key-apply-button"
					onclick={() => {
						showApplyConfirm = true;
					}}
				>
					ライセンスキーを適用
				</Button>

				<Dialog
					bind:open={showApplyConfirm}
					title="ライセンスキーを適用しますか？"
				>
					{#snippet children()}
					<div class="space-y-3 text-sm text-[var(--color-text-primary)]">
						<p>
							入力されたライセンスキーを現在のアカウントに適用します。
						</p>
						<ul class="list-disc pl-5 text-[var(--color-text-muted)] space-y-1">
							<li><strong>一回限り</strong>使用可能です（適用後は無効化されます）</li>
							<li>現在のプランが上書きされます</li>
							<li>適用を取り消すことはできません</li>
						</ul>
						<p class="rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
							{licenseKeyInput}
						</p>
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
							type="submit"
							variant="primary"
							size="md"
							disabled={applyLoading}
							data-testid="license-key-confirm-button"
						>
							{applyLoading ? '適用中…' : '適用する'}
						</Button>
					</div>
					{/snippet}
				</Dialog>
			</form>
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
	{#if license.status === 'grace_period'}
		<section class="bg-[var(--color-feedback-warning-bg)] rounded-xl p-4 border border-[var(--color-feedback-warning-border)]">
			<h3 class="text-sm font-semibold text-[var(--color-feedback-warning-text)] mb-1">⚠️ 猶予期間中</h3>
			<p class="text-sm text-[var(--color-feedback-warning-text)]">
				お支払いの確認が取れていません。猶予期間内にお支払いを完了してください。
				期間を過ぎるとサービスが停止されます。
			</p>
		</section>
	{:else if license.status === 'suspended'}
		<section class="bg-orange-50 rounded-xl p-4 border border-orange-200">
			<h3 class="text-sm font-semibold text-orange-800 mb-1">⏸️ サービス停止中</h3>
			<p class="text-sm text-orange-700">
				ライセンスが停止されています。データは保持されていますが、
				新しい活動の記録やポイントの付与はできません。
			</p>
		</section>
	{:else if license.status === 'terminated'}
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
			<!-- サブスクリプション有り → Stripe Customer Portal で管理 -->
			<div class="grid gap-3">
				<Button
					onclick={openPortal}
					disabled={portalLoading}
					variant="primary"
					size="md"
					class="w-full"
				>
					{portalLoading ? '読み込み中...' : 'プラン変更・支払い管理'}
				</Button>
				<p class="text-xs text-[var(--color-text-tertiary)] text-center">
					Stripeの管理画面でプラン変更・支払い方法の更新・解約ができます
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
						<li>子供の登録数 無制限</li>
						<li>カスタム活動 無制限</li>
						<li>データ保持 1年間</li>
						<li>データエクスポート対応</li>
					</ul>
				</div>

				<!-- ファミリープラン -->
				<div
					class="plan-card"
					class:selected={selectedTier === 'family'}
					class:recommended={true}
					role="button"
					tabindex="0"
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
						<li>スタンダードの全機能</li>
						<li>祖父母・家族向け閲覧リンク</li>
						<li>自由テキストおうえん</li>
						<li>きょうだいランキング</li>
						<li>データ保持 <strong>永久</strong></li>
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
				onclick={openPortal}
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
		{/snippet}
	</Card>
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
			churnLostRetentionLabel,
		]}
		onKeep={() => { showChurnModal = false; }}
		onCancel={() => { showChurnModal = false; openPortal(); }}
	/>
{/if}
