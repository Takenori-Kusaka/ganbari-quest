<script lang="ts">
import { invalidateAll } from '$app/navigation';
import { page } from '$app/stores';
import { formatPointValue, getUnitLabel } from '$lib/domain/point-display';
import {
	dismissTutorialBanner,
	markTutorialStarted,
	startTutorial,
} from '$lib/ui/tutorial/tutorial-store.svelte';

let { data } = $props();

async function handleStartTutorial() {
	await markTutorialStarted();
	await startTutorial();
	await invalidateAll();
}

async function handleDismissBanner() {
	await dismissTutorialBanner();
	await invalidateAll();
}

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const unit = $derived(getUnitLabel(ps.mode, ps.currency));

const authMode = $derived($page.data.authMode as string);

const menuItems = [
	{ href: '/admin/rewards', label: '特別報酬', icon: '🎁' },
	{ href: '/admin/points', label: 'ポイント', icon: '⭐' },
	{ href: '/admin/checklists', label: 'もちもの', icon: '✅' },
	{ href: '/admin/achievements', label: 'じっせき', icon: '🏆' },
	{ href: '/admin/status', label: 'ベンチマーク', icon: '📈' },
	{ href: '/admin/career', label: 'キャリア', icon: '🌟' },
	{ href: '/admin/members', label: 'メンバー', icon: '👥' },
	{ href: '/admin/license', label: 'ライセンス', icon: '🔑', authOnly: true },
];

const visibleMenuItems = $derived(
	authMode === 'local' ? menuItems.filter((item) => !item.authOnly) : menuItems,
);
</script>

<svelte:head>
	<title>管理画面 - がんばりクエスト</title>
</svelte:head>

<div class="space-y-6">
	<!-- Tutorial banner for first-time users -->
	{#if !(data as Record<string, unknown>).tutorialStarted}
		<div class="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-lg" data-tutorial="tutorial-banner">
			<div class="flex items-center gap-3">
				<span class="text-2xl">📖</span>
				<div class="flex-1">
					<p class="font-bold text-gray-700">初めてご利用ですか？</p>
					<p class="text-sm text-gray-500">チュートリアルで使い方を確認しましょう（約3分）</p>
				</div>
				<div class="flex gap-2">
					<button
						class="px-3 py-1.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition-colors"
						onclick={handleStartTutorial}
					>
						開始
					</button>
					<button
						class="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
						onclick={handleDismissBanner}
					>
						あとで
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Summary Cards -->
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3" data-tutorial="summary-cards">
		<div class="bg-white rounded-xl p-4 shadow-sm text-center">
			<p class="text-2xl font-bold text-blue-600">{data.children.length}</p>
			<p class="text-xs text-gray-500 mt-1">こどもの数</p>
		</div>
		<div class="bg-white rounded-xl p-4 shadow-sm text-center">
			<p class="text-2xl font-bold text-amber-500">
				{fmtBal(data.children.reduce((sum, c) => sum + c.balance, 0))}
			</p>
			<p class="text-xs text-gray-500 mt-1">合計{unit}</p>
		</div>
	</div>

	<!-- Children Overview -->
	<section data-tutorial="children-overview">
		<h2 class="text-lg font-bold text-gray-700 mb-3">こども一覧</h2>
		{#if data.children.length === 0}
			<div class="bg-white rounded-xl p-8 shadow-sm text-center text-gray-400">
				<p>まだこどもが登録されていません</p>
			</div>
		{:else}
			<div class="grid gap-3">
				{#each data.children as child}
					<a
						href="/admin/children?id={child.id}"
						class="bg-white rounded-xl p-4 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow"
					>
						{#if child.avatarUrl}
							<img src={child.avatarUrl} alt={child.nickname} class="w-10 h-10 rounded-full object-cover" loading="lazy" />
						{:else}
							<span class="text-3xl">👤</span>
						{/if}
						<div class="flex-1">
							<p class="font-bold text-gray-700">{child.nickname}</p>
							<p class="text-sm text-gray-400">{child.age}歳 / {child.uiMode} / Lv.{child.level}</p>
						</div>
						<div class="text-right">
							<p class="text-lg font-bold text-amber-500">{fmtBal(child.balance)}</p>
							<p class="text-xs text-gray-400">{child.levelTitle}</p>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Quick Actions -->
	<section data-tutorial="quick-actions">
		<h2 class="text-lg font-bold text-gray-700 mb-3">クイックアクション</h2>
		<div class="grid grid-cols-2 gap-3">
			<a href="/admin/rewards" class="bg-white rounded-xl p-4 shadow-sm text-center hover:shadow-md transition-shadow">
				<span class="text-2xl block mb-1">🎁</span>
				<p class="text-sm font-bold text-gray-600">特別報酬を付与</p>
			</a>
			<a href="/admin/points" class="bg-white rounded-xl p-4 shadow-sm text-center hover:shadow-md transition-shadow">
				<span class="text-2xl block mb-1">⭐</span>
				<p class="text-sm font-bold text-gray-600">{ps.mode === 'currency' ? '金額を渡す' : 'ポイント変換'}</p>
			</a>
			<a href="/admin/activities" class="bg-white rounded-xl p-4 shadow-sm text-center hover:shadow-md transition-shadow">
				<span class="text-2xl block mb-1">📋</span>
				<p class="text-sm font-bold text-gray-600">活動管理</p>
			</a>
			<a href="/switch" class="bg-white rounded-xl p-4 shadow-sm text-center hover:shadow-md transition-shadow">
				<span class="text-2xl block mb-1">👧</span>
				<p class="text-sm font-bold text-gray-600">こども画面へ</p>
			</a>
		</div>
	</section>

	<!-- Management Menu -->
	<section>
		<h2 class="text-lg font-bold text-gray-700 mb-3">管理メニュー</h2>
		<div class="grid grid-cols-3 sm:grid-cols-4 gap-3">
			{#each visibleMenuItems as item}
				<a href={item.href} class="bg-white rounded-xl p-3 shadow-sm text-center hover:shadow-md transition-shadow">
					<span class="text-xl block mb-1">{item.icon}</span>
					<p class="text-xs font-medium text-gray-600">{item.label}</p>
				</a>
			{/each}
		</div>
	</section>
</div>
