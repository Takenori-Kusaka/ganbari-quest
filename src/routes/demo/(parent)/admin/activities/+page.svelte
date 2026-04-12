<script lang="ts">
import { formatPointValue } from '$lib/domain/point-display';
import {
	CATEGORY_DEFS,
	getActivityDisplayNameForAdult,
	getCategoryById,
} from '$lib/domain/validation/activity';
import AiSuggestPanel from '$lib/features/admin/components/AiSuggestPanel.svelte';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

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
				class="bg-[var(--color-stat-purple)] cursor-not-allowed"
				disabled
			>
				✨ AI追加
			</Button>
			<Button
				variant="primary"
				size="sm"
				class="bg-[var(--color-feedback-info-border)] cursor-not-allowed"
				disabled
			>
				+ 手動追加
			</Button>
		</div>
	</div>

	<!-- AI Suggest Panel (demo: always family) -->
	<AiSuggestPanel onaccept={() => {}} isFamily={true} />

	<!-- Search (matches production) -->
	<FormField label="活動を検索" type="search" placeholder="🔍 活動を検索..." bind:value={searchQuery} />

	<!-- Category Filter (matches production) -->
	<div class="flex flex-wrap gap-2">
		<Button
			variant={filterCategoryId === 0 ? 'primary' : 'ghost'}
			size="sm"
			class="rounded-full
				{filterCategoryId === 0 ? '' : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-tertiary)]'}"
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
					{filterCategoryId === catDef.id ? '' : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-tertiary)]'}"
				onclick={() => filterCategoryId = catDef.id}
			>
				{catDef.name} ({count})
			</Button>
		{/each}
	</div>

	<!-- Activity List (matches production card style) -->
	<div class="space-y-1">
		{#each filteredActivities as activity (activity.id)}
			{@const cat = getCategoryById(activity.categoryId)}
			<Card padding="none">
				<div class="px-3 py-2 flex items-center gap-3">
					<CompoundIcon icon={activity.icon} size="md" />
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 flex-wrap">
							<p class="text-sm font-bold truncate" style:color="var(--color-text)">{getActivityDisplayNameForAdult(activity)}</p>
							<span class="activity-points">{fmtPts(activity.basePoints)}</span>
						</div>
						<div class="activity-meta">
							{#if cat}
								<span class="category-badge" style:background-color="{cat.color}20" style:color={cat.accent}>
									{cat.icon} {cat.name}
								</span>
							{/if}
							{#if activity.dailyLimit !== null && activity.dailyLimit !== undefined}
								<span class="meta-item">{dailyLimitLabel(activity.dailyLimit)}</span>
							{/if}
							{#if activity.ageMin != null || activity.ageMax != null}
								<span class="meta-item">{activity.ageMin ?? 0}-{activity.ageMax ?? 18}歳</span>
							{/if}
						</div>
					</div>
				</div>
			</Card>
		{/each}
	</div>

	{#if filteredActivities.length === 0}
		<div class="text-center py-8 text-[var(--color-text-tertiary)] text-sm">
			該当する活動がありません
		</div>
	{/if}

	<DemoCta
		title="活動をカスタマイズしませんか？"
		description="登録すると、お子さまに合わせた活動を自由に追加・編集できます。"
	/>
</div>

<style>
	.activity-points {
		display: inline-flex;
		align-items: center;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-point);
		background: linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 215, 0, 0.08));
		padding: 0.125rem 0.5rem;
		border-radius: var(--radius-full, 9999px);
		white-space: nowrap;
	}

	.activity-meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.25rem;
		flex-wrap: wrap;
	}

	.category-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		font-size: 0.625rem;
		font-weight: 600;
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-full, 9999px);
		white-space: nowrap;
	}

	.meta-item {
		font-size: 0.625rem;
		color: var(--color-text-muted);
	}
</style>
