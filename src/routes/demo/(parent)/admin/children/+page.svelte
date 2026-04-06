<script lang="ts">
import { getAgeTierShortLabel } from '$lib/domain/labels';
import { formatPointValue, getUnitLabel } from '$lib/domain/point-display';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const unit = $derived(getUnitLabel(ps.mode, ps.currency));

const uiModeLabel = getAgeTierShortLabel;

// Detail tabs shown on production (read-only in demo)
const detailTabs = [
	{ id: 'info', label: '📋 基本情報' },
	{ id: 'status', label: '📊 ステータス' },
	{ id: 'logs', label: '📝 活動記録' },
	{ id: 'achievements', label: '🏆 実績' },
	{ id: 'voice', label: '📢 ボイス' },
] as const;

let selectedChildId = $state<number | null>(null);
let detailTab = $state<string>('info');

const selectedChild = $derived(
	data.children.find((c: { id: number }) => c.id === selectedChildId) ?? null,
);
</script>

<svelte:head>
	<title>こども管理 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-4">
	<DemoBanner />

	<!-- Header (matches production) -->
	<div class="flex items-center justify-between">
		<div>
			<Button
				variant="primary"
				size="sm"
				class="bg-blue-300 cursor-not-allowed"
				disabled
			>
				+ こどもを追加
			</Button>
		</div>
	</div>

	<!-- Children List (matches production card style) -->
	{#if !selectedChildId}
		<div class="grid gap-3">
			{#each data.children as child (child.id)}
				<Button
					variant="ghost"
					size="md"
					class="w-full bg-white rounded-xl p-4 shadow-sm flex items-center gap-4 hover:shadow-md text-left"
					onclick={() => selectedChildId = child.id}
				>
					{#if child.avatarUrl}
						<img src={child.avatarUrl} alt={child.nickname} class="w-12 h-12 rounded-full object-cover" loading="lazy" />
					{:else}
						<span class="text-3xl">👤</span>
					{/if}
					<div class="flex-1 min-w-0">
						<p class="font-bold text-gray-700">{child.nickname}</p>
						<p class="text-sm text-gray-400">{child.age}歳 / {uiModeLabel(child.uiMode ?? 'kinder')}</p>
					</div>
					<div class="text-right">
						<p class="text-lg font-bold text-amber-500">{fmtBal(child.balance)}</p>
					</div>
				</Button>
			{/each}
		</div>
	{/if}

	<!-- Child Detail View (matches production tab layout) -->
	{#if selectedChild}
		<div>
			<Button
				variant="ghost"
				size="sm"
				class="text-blue-600 hover:text-blue-800 mb-3"
				onclick={() => selectedChildId = null}
			>
				← 一覧に戻る
			</Button>

			<!-- Child Header -->
			<Card class="mb-4">
				<div class="flex items-center gap-4">
					{#if selectedChild.avatarUrl}
						<img src={selectedChild.avatarUrl} alt={selectedChild.nickname} class="w-16 h-16 rounded-full object-cover" />
					{:else}
						<span class="text-5xl">👤</span>
					{/if}
					<div class="flex-1">
						<h2 class="text-lg font-bold text-gray-700">{selectedChild.nickname}</h2>
						<p class="text-sm text-gray-400">{selectedChild.age}歳 / {uiModeLabel(selectedChild.uiMode ?? 'kinder')}</p>
					</div>
					<div class="text-right">
						<p class="text-2xl font-bold text-amber-500">{fmtBal(selectedChild.balance)}</p>
						<p class="text-xs text-gray-400">{unit}</p>
					</div>
				</div>
			</Card>

			<!-- Tab Navigation (matches production 6-tab system) -->
			<div class="flex overflow-x-auto gap-1 mb-4 pb-1">
				{#each detailTabs as tab}
					<Button
						variant={detailTab === tab.id ? 'primary' : 'ghost'}
						size="sm"
						class="whitespace-nowrap
							{detailTab === tab.id ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
						onclick={() => detailTab = tab.id}
					>
						{tab.label}
					</Button>
				{/each}
			</div>

			<!-- Tab Content -->
			<Card>
				{#if detailTab === 'info'}
					<div class="grid grid-cols-2 gap-3">
						<div class="bg-blue-50 rounded-lg p-3 text-center">
							<p class="text-xs text-gray-500">年齢</p>
							<p class="text-lg font-bold text-blue-600">{selectedChild.age}歳</p>
						</div>
						<div class="bg-purple-50 rounded-lg p-3 text-center">
							<p class="text-xs text-gray-500">UIモード</p>
							<p class="text-lg font-bold text-purple-600">{uiModeLabel(selectedChild.uiMode ?? 'kinder')}</p>
						</div>
						<div class="bg-amber-50 rounded-lg p-3 text-center">
							<p class="text-xs text-gray-500">{unit}残高</p>
							<p class="text-lg font-bold text-amber-600">{fmtBal(selectedChild.balance)}</p>
						</div>
						<div class="bg-green-50 rounded-lg p-3 text-center">
							<p class="text-xs text-gray-500">レベル</p>
							<p class="text-lg font-bold text-green-600">Lv.{selectedChild.level ?? 1}</p>
						</div>
					</div>
				{:else if detailTab === 'status'}
					<div class="text-center py-8 text-gray-400">
						<p class="text-3xl mb-2">📊</p>
						<p class="text-sm">ステータス詳細は登録後にご覧いただけます</p>
					</div>
				{:else if detailTab === 'logs'}
					<div class="text-center py-8 text-gray-400">
						<p class="text-3xl mb-2">📝</p>
						<p class="text-sm">活動ログは登録後にご覧いただけます</p>
					</div>
				{:else if detailTab === 'achievements'}
					<div class="text-center py-8 text-gray-400">
						<p class="text-3xl mb-2">🏆</p>
						<p class="text-sm">実績一覧は登録後にご覧いただけます</p>
					</div>
				{:else if detailTab === 'voice'}
					<div class="text-center py-8 text-gray-400">
						<p class="text-3xl mb-2">📢</p>
						<p class="text-sm">おうえんボイスは登録後にご利用いただけます</p>
					</div>
				{/if}
			</Card>
		</div>
	{/if}

	<DemoCta
		title="お子さまを登録しませんか？"
		description="登録すると、お子さまの成長をリアルタイムで見守れます。"
	/>
</div>
