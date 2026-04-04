<script lang="ts">
import PlanStatusCard from '$lib/features/admin/components/PlanStatusCard.svelte';
import ChurnPreventionModal from '$lib/features/loyalty/ChurnPreventionModal.svelte';
import LoyaltyBadge from '$lib/features/loyalty/LoyaltyBadge.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const license = $derived(data.license);
const stripeEnabled = $derived(data.stripeEnabled);
const planTier = $derived(data.planTier ?? 'free');
const planStats = $derived(data.planStats);

let checkoutLoading = $state(false);
let portalLoading = $state(false);
let showChurnModal = $state(false);
let selectedTier = $state<'standard' | 'family'>('standard');
let billingInterval = $state<'monthly' | 'yearly'>('monthly');

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
			return { text: '有効', color: 'bg-green-100 text-green-700', icon: '✅' };
		case 'grace_period':
			return { text: '猶予期間', color: 'bg-yellow-100 text-yellow-700', icon: '⚠️' };
		case 'suspended':
			return { text: '停止中', color: 'bg-orange-100 text-orange-700', icon: '⏸️' };
		case 'terminated':
			return { text: '解約済み', color: 'bg-red-100 text-red-700', icon: '❌' };
		default:
			return { text: status, color: 'bg-gray-100 text-gray-700', icon: '❓' };
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
		<h3 class="text-lg font-semibold text-gray-600 mb-4">現在のプラン</h3>

		<div class="grid gap-4">
			<div class="flex items-center justify-between py-2 border-b border-gray-50">
				<span class="text-sm text-gray-500">プラン</span>
				<span class="text-sm font-semibold text-gray-700">{planLabel(license.plan ?? 'free')}</span>
			</div>

			<div class="flex items-center justify-between py-2 border-b border-gray-50">
				<span class="text-sm text-gray-500">ステータス</span>
				<span class="text-xs font-medium px-2.5 py-1 rounded-full {status.color}">
					{status.icon} {status.text}
				</span>
			</div>

			{#if license.planExpiresAt}
				<div class="flex items-center justify-between py-2 border-b border-gray-50">
					<span class="text-sm text-gray-500">有効期限</span>
					<span class="text-sm text-gray-700">
						{new Date(license.planExpiresAt).toLocaleDateString('ja-JP')}
					</span>
				</div>
			{/if}

			{#if license.licenseKey}
				<div class="flex items-center justify-between py-2 border-b border-gray-50">
					<span class="text-sm text-gray-500">ライセンスキー</span>
					<code class="text-xs bg-gray-50 px-2 py-1 rounded font-mono text-gray-600">
						{license.licenseKey}
					</code>
				</div>
			{/if}

			<div class="flex items-center justify-between py-2 border-b border-gray-50">
				<span class="text-sm text-gray-500">家族名</span>
				<span class="text-sm text-gray-700">{license.tenantName}</span>
			</div>

			<div class="flex items-center justify-between py-2">
				<span class="text-sm text-gray-500">登録日</span>
				<span class="text-sm text-gray-700">
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
		<section class="bg-yellow-50 rounded-xl p-4 border border-yellow-200">
			<h3 class="text-sm font-semibold text-yellow-800 mb-1">⚠️ 猶予期間中</h3>
			<p class="text-sm text-yellow-700">
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
		<section class="bg-red-50 rounded-xl p-4 border border-red-200">
			<h3 class="text-sm font-semibold text-red-800 mb-1">❌ 解約済み</h3>
			<p class="text-sm text-red-700">
				このアカウントは解約されています。データは一定期間保持されますが、
				その後削除されます。
			</p>
		</section>
	{/if}

	<!-- プラン管理 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-gray-600 mb-4">プラン管理</h3>

		{#if !stripeEnabled}
			<p class="text-sm text-gray-400 text-center py-4">
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
				<p class="text-xs text-gray-400 text-center">
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
							<p class="font-semibold text-gray-700">スタンダード</p>
							<p class="text-xs text-gray-500">子供無制限・活動無制限・1年保持</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-blue-600">¥500<span class="text-sm font-normal text-gray-500">/月</span></p>
						{:else}
							<p class="text-xl font-bold text-blue-600">¥5,000<span class="text-sm font-normal text-gray-500">/年</span></p>
						{/if}
					</div>
					<ul class="text-xs text-gray-500 space-y-1 mb-3">
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
							<p class="font-semibold text-gray-700">ファミリー</p>
							<p class="text-xs text-gray-500">全機能+データ永久保持+成長記録</p>
						</div>
						{#if billingInterval === 'monthly'}
							<p class="text-xl font-bold text-purple-600">¥780<span class="text-sm font-normal text-gray-500">/月</span></p>
						{:else}
							<p class="text-xl font-bold text-purple-600">¥7,800<span class="text-sm font-normal text-gray-500">/年</span></p>
						{/if}
					</div>
					<ul class="text-xs text-gray-500 space-y-1 mb-3">
						<li>スタンダードの全機能</li>
						<li>データ保持 <strong>永久</strong></li>
						<li>兄弟間クロス分析</li>
						<li>詳細月次レポート</li>
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

				<p class="text-xs text-gray-400 text-center">
					いつでもキャンセル・プラン変更可能
				</p>
			</div>
		{/if}
		{/snippet}
	</Card>

	<!-- 支払い履歴 -->
	<Card variant="default" padding="lg">
		{#snippet children()}
		<h3 class="text-lg font-semibold text-gray-600 mb-4">支払い履歴</h3>
		{#if hasSubscription}
			<p class="text-sm text-gray-500 text-center py-4">
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
			<p class="text-sm text-gray-400 text-center py-4">
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
			'90日以前のデータへのアクセス',
		]}
		onKeep={() => { showChurnModal = false; }}
		onCancel={() => { showChurnModal = false; openPortal(); }}
	/>
{/if}
