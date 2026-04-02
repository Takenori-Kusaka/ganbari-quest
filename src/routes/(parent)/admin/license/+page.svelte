<script lang="ts">
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const license = $derived(data.license);
const stripeEnabled = $derived(data.stripeEnabled);

let checkoutLoading = $state(false);
let portalLoading = $state(false);

const planLabel = (plan: string) => {
	switch (plan) {
		case 'monthly':
			return '月額プラン（¥500/月）';
		case 'yearly':
			return '年額プラン（¥5,000/年）';
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

async function startCheckout(planId: 'monthly' | 'yearly') {
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
	<title>ライセンス管理 - がんばりクエスト</title>
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
				<div class="border border-blue-200 rounded-lg p-4">
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-gray-700">月額プラン</p>
							<p class="text-sm text-gray-500">全機能利用可能・毎月自動更新</p>
						</div>
						<p class="text-xl font-bold text-blue-600">¥500<span class="text-sm font-normal text-gray-500">/月</span></p>
					</div>
					<Button
						onclick={() => startCheckout('monthly')}
						disabled={checkoutLoading}
						variant="primary"
						size="sm"
						class="w-full"
					>
						{checkoutLoading ? '処理中...' : '月額プランで始める'}
					</Button>
				</div>

				<div class="border border-purple-200 rounded-lg p-4 relative">
					<span class="absolute -top-2.5 left-4 bg-purple-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
						2ヶ月分お得
					</span>
					<div class="flex items-center justify-between mb-2">
						<div>
							<p class="font-semibold text-gray-700">年額プラン</p>
							<p class="text-sm text-gray-500">全機能利用可能・毎年自動更新</p>
						</div>
						<p class="text-xl font-bold text-purple-600">¥5,000<span class="text-sm font-normal text-gray-500">/年</span></p>
					</div>
					<Button
						onclick={() => startCheckout('yearly')}
						disabled={checkoutLoading}
						variant="primary"
						size="sm"
						class="w-full"
					>
						{checkoutLoading ? '処理中...' : '年額プランで始める'}
					</Button>
				</div>

				<p class="text-xs text-gray-400 text-center">
					7日間の無料トライアル付き・いつでもキャンセル可能
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
