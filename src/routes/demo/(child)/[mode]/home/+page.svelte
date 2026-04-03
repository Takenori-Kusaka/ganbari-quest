<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { formatPointValueWithSign } from '$lib/domain/point-display';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { advanceStep, getGuideState } from '$lib/features/demo/demo-guide-state.svelte.js';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

// Build recorded counts map
const recordedMap = $derived(
	new Map(
		data.todayRecorded.map((r: { activityId: number; count: number }) => [r.activityId, r.count]),
	),
);

function getCount(activityId: number): number {
	return recordedMap.get(activityId) ?? 0;
}

function isCompleted(activity: { id: number; dailyLimit: number | null }): boolean {
	const limit = activity.dailyLimit ?? 1;
	if (limit === 0) return false;
	return getCount(activity.id) >= limit;
}

// Group activities by category
const activitiesByCategory = $derived(
	CATEGORY_DEFS.map((catDef) => ({
		categoryId: catDef.id,
		items: data.activities.filter((a: { categoryId: number }) => a.categoryId === catDef.id),
	})).filter((g) => g.items.length > 0),
);

// Confirm dialog state
let confirmOpen = $state(false);
let selectedActivity = $state<{
	id: number;
	name: string;
	displayName?: string;
	icon: string;
} | null>(null);
let submitting = $state(false);

// Result state
let resultOpen = $state(false);
let resultData = $state<{ activityName: string; totalPoints: number; streakDays: number } | null>(
	null,
);

function handleActivityTap(activity: {
	id: number;
	name: string;
	displayName?: string;
	icon: string;
}) {
	selectedActivity = activity;
	confirmOpen = true;
}

function handleConfirmClose() {
	confirmOpen = false;
	selectedActivity = null;
}

function handleResultClose() {
	resultOpen = false;
	resultData = null;
}
</script>

<svelte:head>
	<title>ホーム - がんばりクエスト デモ</title>
</svelte:head>

<div class="px-[var(--sp-sm)] py-1">
	<!-- Checklist shortcut -->
	{#if data.hasChecklists}
		<div
			class="flex items-center justify-between w-full px-[var(--sp-md)] py-[var(--sp-sm)] mb-[var(--sp-sm)] rounded-[var(--radius-lg)] bg-white shadow-sm border border-[var(--color-border)]"
		>
			<div class="flex items-center gap-[var(--sp-sm)]">
				<span class="text-2xl">📋</span>
				<span class="font-bold">もちものチェック</span>
			</div>
			{#if data.checklistProgress}
				<div class="flex items-center gap-[var(--sp-xs)]">
					{#if data.checklistProgress.allDone}
						<span class="text-sm font-bold text-[var(--theme-accent)]">✅ かんりょう！</span>
					{:else}
						<span class="text-sm text-[var(--color-text-muted)]">
							{data.checklistProgress.checkedCount}/{data.checklistProgress.totalCount}
						</span>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Daily missions -->
	{#if data.dailyMissions && data.dailyMissions.missions.length > 0}
		<div class="mb-[var(--sp-sm)] rounded-[var(--radius-lg)] bg-white shadow-sm border border-[var(--color-border)] overflow-hidden">
			<div class="flex items-center gap-[var(--sp-xs)] px-[var(--sp-md)] pt-[var(--sp-sm)] pb-1">
				<span class="text-lg">🎯</span>
				<span class="font-bold text-sm">きょうのミッション</span>
				<span class="text-xs text-[var(--color-text-muted)] ml-auto">
					{data.dailyMissions.completedCount}/{data.dailyMissions.missions.length}
				</span>
			</div>
			<div class="px-[var(--sp-md)] pb-[var(--sp-sm)]">
				{#each data.dailyMissions.missions as mission (mission.id)}
					<div class="flex items-center gap-[var(--sp-sm)] py-1">
						<span class="text-lg w-6 text-center">{mission.completed ? '✅' : '⬜'}</span>
						<span class="text-lg">{mission.activityIcon}</span>
						<span class="text-sm {mission.completed ? 'line-through text-[var(--color-text-muted)]' : 'font-bold'}">
							{mission.activityName}
						</span>
					</div>
				{/each}
				{#if data.dailyMissions.allComplete}
					<div class="text-center mt-1 py-1 rounded-[var(--radius-md)] bg-[var(--theme-bg)]">
						<span class="text-sm font-bold text-[var(--theme-accent)]">🎉 ミッションコンプリート！ {fmtPts(data.dailyMissions.bonusAwarded)}</span>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Activity grid by category -->
	{#each activitiesByCategory as group (group.categoryId)}
		<CategorySection categoryId={group.categoryId} itemCount={group.items.length}>
			{#each group.items as activity (activity.id)}
				<ActivityCard
					activityId={activity.id}
					icon={activity.icon}
					name={activity.displayName}
					categoryId={activity.categoryId}
					completed={isCompleted(activity)}
					count={getCount(activity.id)}
					isMission={activity.isMission}
					onclick={() => handleActivityTap(activity)}
				/>
			{/each}
		</CategorySection>
	{/each}

	{#if data.activities.length === 0}
		<div class="flex flex-col items-center justify-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-md)]">📋</span>
			<p class="text-[var(--font-md)]">かつどうがまだありません</p>
		</div>
	{/if}
</div>

<!-- Confirm dialog -->
<Dialog bind:open={confirmOpen} title="きろくする？" onOpenChange={({ open }) => { if (!open) handleConfirmClose(); }}>
	{#if selectedActivity}
		<div class="text-center py-4">
			<span class="text-5xl block mb-3">{selectedActivity.icon}</span>
			<p class="text-lg font-bold mb-4">{selectedActivity.displayName ?? selectedActivity.name}</p>
			<form
				method="POST"
				action="?/record"
				use:enhance={() => {
					submitting = true;
					return async ({ result }) => {
						submitting = false;
						confirmOpen = false;
						if (result.type === 'success' && result.data) {
							const d = result.data as { activityName: string; totalPoints: number; streakDays: number };
							resultData = d;
							resultOpen = true;
							// ガイドステップ2（活動記録）完了 → ステップ3へ進める
							const guide = getGuideState();
							if (guide.active && guide.currentStep === 1) {
								advanceStep();
							}
						}
					};
				}}
			>
				<input type="hidden" name="activityId" value={selectedActivity.id} />
				<Button
					type="submit"
					variant="primary"
					size="lg"
					disabled={submitting}
					class="w-full bg-[var(--theme-accent)] disabled:opacity-50"
				>
					{submitting ? 'きろくちゅう...' : 'きろくする！'}
				</Button>
			</form>
		</div>
	{/if}
</Dialog>

<!-- Result dialog -->
<Dialog bind:open={resultOpen} title="きろくしたよ！" onOpenChange={({ open }) => { if (!open) handleResultClose(); }}>
	{#if resultData}
		<div class="text-center py-4">
			<p class="text-3xl font-bold text-[var(--color-point)] mb-2">
				{fmtPts(resultData.totalPoints)}
			</p>
			<p class="text-sm text-[var(--color-text-muted)]">
				{resultData.streakDays}日れんぞく！
			</p>
			<p class="text-xs text-amber-500 mt-3">
				（デモモード：データは保存されません）
			</p>
			<a
				href="/demo/signup"
				class="mt-3 block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-[var(--radius-lg)] text-center text-sm"
			>
				お子さまの名前で はじめる →
			</a>
			<Button
				variant="primary"
				size="md"
				class="mt-2 w-full bg-[var(--theme-accent)]"
				onclick={handleResultClose}
			>
				とじる
			</Button>
		</div>
	{/if}
</Dialog>
