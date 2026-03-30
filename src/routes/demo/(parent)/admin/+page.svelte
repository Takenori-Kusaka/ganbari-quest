<script lang="ts">
import { formatPointValue, getUnitLabel } from '$lib/domain/point-display';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const unit = $derived(getUnitLabel(ps.mode, ps.currency));

const menuItems = [
	{ href: '/demo/admin/activities', label: 'かつどう', icon: '📋' },
	{ href: '/demo/admin/children', label: 'こども', icon: '👧' },
	{ href: '/demo/admin/points', label: 'ポイント', icon: '⭐' },
	{ href: '/demo/admin/settings', label: 'せってい', icon: '⚙️' },
	{ href: '#', label: 'おうえん', icon: '💌' },
	{ href: '#', label: '特別報酬', icon: '🎁' },
	{ href: '#', label: 'もちもの', icon: '✅' },
	{ href: '#', label: 'じっせき', icon: '🏆' },
];
</script>

<svelte:head>
	<title>管理画面 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<!-- Summary Cards -->
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
		<div class="bg-white rounded-xl p-4 shadow-sm text-center">
			<p class="text-2xl font-bold text-blue-600">{data.children.length}</p>
			<p class="text-xs text-gray-500 mt-1">こどもの数</p>
		</div>
		<div class="bg-white rounded-xl p-4 shadow-sm text-center">
			<p class="text-2xl font-bold text-amber-500">
				{fmtBal(data.children.reduce((sum: number, c: { balance: number }) => sum + c.balance, 0))}
			</p>
			<p class="text-xs text-gray-500 mt-1">合計{unit}</p>
		</div>
	</div>

	<!-- Children Overview -->
	<section>
		<h2 class="text-lg font-bold text-gray-700 mb-3">こども一覧</h2>
		<div class="grid gap-3">
			{#each data.children as child}
				<a
					href="/demo/{child.uiMode}/home?childId={child.id}"
					class="bg-white rounded-xl p-4 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow"
				>
					<span class="text-3xl">
						{#if child.uiMode === 'baby'}👶{:else if child.uiMode === 'kinder'}🧒{:else if child.uiMode === 'lower'}🧑{:else}🧑‍💻{/if}
					</span>
					<div class="flex-1">
						<p class="font-bold text-gray-700">{child.nickname}</p>
						<p class="text-sm text-gray-400">{child.age}歳 / {child.uiMode}</p>
					</div>
					<div class="text-right">
						<p class="text-lg font-bold text-amber-500">{fmtBal(child.balance)}</p>
					</div>
				</a>
			{/each}
		</div>
	</section>

	<!-- Quick Actions -->
	<section>
		<h2 class="text-lg font-bold text-gray-700 mb-3">クイックアクション</h2>
		<div class="grid grid-cols-2 gap-3">
			<a href="/demo/admin/activities" class="bg-white rounded-xl p-4 shadow-sm text-center hover:shadow-md transition-shadow">
				<span class="text-2xl block mb-1">📋</span>
				<p class="text-sm font-bold text-gray-600">活動管理</p>
			</a>
			<a href="/demo/admin/points" class="bg-white rounded-xl p-4 shadow-sm text-center hover:shadow-md transition-shadow">
				<span class="text-2xl block mb-1">⭐</span>
				<p class="text-sm font-bold text-gray-600">ポイント管理</p>
			</a>
			<a href="/demo/admin/children" class="bg-white rounded-xl p-4 shadow-sm text-center hover:shadow-md transition-shadow">
				<span class="text-2xl block mb-1">👧</span>
				<p class="text-sm font-bold text-gray-600">こども管理</p>
			</a>
			<a href="/demo/admin/settings" class="bg-white rounded-xl p-4 shadow-sm text-center hover:shadow-md transition-shadow">
				<span class="text-2xl block mb-1">⚙️</span>
				<p class="text-sm font-bold text-gray-600">設定</p>
			</a>
		</div>
	</section>

	<!-- Management Menu -->
	<section>
		<h2 class="text-lg font-bold text-gray-700 mb-3">管理メニュー</h2>
		<div class="grid grid-cols-3 sm:grid-cols-4 gap-3">
			{#each menuItems as item}
				<a href={item.href} class="bg-white rounded-xl p-3 shadow-sm text-center hover:shadow-md transition-shadow">
					<span class="text-xl block mb-1">{item.icon}</span>
					<p class="text-xs font-medium text-gray-600">{item.label}</p>
				</a>
			{/each}
		</div>
	</section>

	<!-- Demo CTA -->
	<div class="bg-gradient-to-r from-amber-50 to-orange-50 border border-orange-200 rounded-xl p-4 text-center">
		<p class="text-sm font-bold text-gray-700 mb-1">いかがでしたか？</p>
		<p class="text-xs text-gray-500 mb-3">
			お子さまの「がんばり」を冒険に変えませんか？
		</p>
		<a
			href="/demo/signup"
			class="inline-block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-center text-sm"
		>
			無料で はじめる →
		</a>
	</div>
</div>
