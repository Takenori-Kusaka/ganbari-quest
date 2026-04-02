<script lang="ts">
import { formatPointValue } from '$lib/domain/point-display';
import {
	CATEGORY_DEFS,
	getActivityDisplayNameForAdult,
	getCategoryById,
} from '$lib/domain/validation/activity';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);

let filterCategoryId = $state(0);
let searchQuery = $state('');

const filteredActivities = $derived.by(() => {
	let result = data.activities;
	if (filterCategoryId) {
		result = result.filter((a: { categoryId: number }) => a.categoryId === filterCategoryId);
	}
	if (searchQuery.trim()) {
		const q = searchQuery.trim().toLowerCase();
		result = result.filter(
			(a: { name: string; nameKanji?: string | null; nameKana?: string | null }) =>
				a.name.toLowerCase().includes(q) ||
				a.nameKanji?.toLowerCase().includes(q) ||
				a.nameKana?.toLowerCase().includes(q),
		);
	}
	return result;
});

function dailyLimitLabel(val: number | null): string {
	if (val === null) return '1回/日';
	if (val === 0) return '無制限';
	return `${val}回/日`;
}
</script>

<svelte:head>
	<title>活動管理 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-4">
	<DemoBanner />

	<!-- Header (matches production layout) -->
	<div class="flex items-center justify-between">
		<div class="flex gap-2">
			<Button
				variant="primary"
				size="sm"
				class="bg-purple-300 cursor-not-allowed"
				disabled
			>
				✨ AI追加
			</Button>
			<Button
				variant="primary"
				size="sm"
				class="bg-blue-300 cursor-not-allowed"
				disabled
			>
				+ 手動追加
			</Button>
		</div>
	</div>

	<!-- Search (matches production) -->
	<input
		type="text"
		placeholder="🔍 活動を検索..."
		class="w-full px-3 py-2 border rounded-lg text-sm bg-white"
		bind:value={searchQuery}
	/>

	<!-- Category Filter (matches production) -->
	<div class="flex flex-wrap gap-2">
		<Button
			variant={filterCategoryId === 0 ? 'primary' : 'ghost'}
			size="sm"
			class="rounded-full
				{filterCategoryId === 0 ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
			onclick={() => filterCategoryId = 0}
		>
			すべて ({data.activities.length})
		</Button>
		{#each data.categoryDefs as catDef}
			{@const count = data.activities.filter((a: { categoryId: number }) => a.categoryId === catDef.id).length}
			<Button
				variant={filterCategoryId === catDef.id ? 'primary' : 'ghost'}
				size="sm"
				class="rounded-full
					{filterCategoryId === catDef.id ? '' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}"
				onclick={() => filterCategoryId = catDef.id}
			>
				{catDef.name} ({count})
			</Button>
		{/each}
	</div>

	<!-- Activity List (matches production card style) -->
	<div class="space-y-1">
		{#each filteredActivities as activity (activity.id)}
			<div class="bg-white rounded-lg shadow-sm">
				<div class="px-3 py-2 flex items-center gap-3">
					<CompoundIcon icon={activity.icon} size="md" />
					<div class="flex-1 min-w-0">
						<p class="text-sm font-bold text-gray-700 truncate">{getActivityDisplayNameForAdult(activity)}</p>
						<p class="text-xs text-gray-400">
							{getCategoryById(activity.categoryId)?.name ?? ''} / {activity.basePoints}P
							{#if activity.dailyLimit !== null && activity.dailyLimit !== undefined}
								/ {dailyLimitLabel(activity.dailyLimit)}
							{/if}
							{#if activity.ageMin != null || activity.ageMax != null}
								/ {activity.ageMin ?? 0}-{activity.ageMax ?? 18}歳
							{/if}
						</p>
					</div>
					<div class="text-right">
						<span class="text-sm font-bold text-amber-500">{fmtPts(activity.basePoints)}</span>
					</div>
				</div>
			</div>
		{/each}
	</div>

	{#if filteredActivities.length === 0}
		<div class="text-center py-8 text-gray-400 text-sm">
			該当する活動がありません
		</div>
	{/if}

	<DemoCta
		title="活動をカスタマイズしませんか？"
		description="登録すると、お子さまに合わせた活動を自由に追加・編集できます。"
	/>
</div>
