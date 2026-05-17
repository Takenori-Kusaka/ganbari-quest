<!--
  DashboardView.svelte — ADR-0046 / Issue #2069 POC

  Child Home の共通 UI コンポーネント。

  POC scope:
    - demo (`/demo/(child)/[mode]/home/+page.svelte`) から呼び出される。
    - データ取得は **Context 経由** で注入された ChildDashboardService から行う。
    - 表示要素は demo 側 `+page.svelte` (移行前) と同等 (UI 等価性証明のため)。

  follow-up scope (Issue #2069 残り):
    - 本番側 `+page.svelte` (1094 行) を順次本 View に集約。
    - 完了 / 確認 dialog の write 動詞 (record / cancel / claimBonus) を
      service interface に追加し、demo / 本番のどちらでも同じ form を使う。
-->
<script lang="ts">
import { enhance } from '$app/forms';
import { DEMO_CHILD_HOME_LABELS, formatStreak } from '$lib/domain/labels';
import { formatPointValueWithSign } from '$lib/domain/point-display';
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import { getDashboardService } from '$lib/services/context';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

/**
 * Props
 *
 * - `pageData`: SvelteKit `+page.server.ts` の load 戻り値そのまま。
 *   demo 側で form action 結果や mustStatus / checklist など Context に
 *   含まない既存スキーマフィールドを引き続き使えるよう、原形を維持する。
 *   POC では Service interface (`getDashboardService`) が
 *   `todayRecorded` / `pointSettings` / `child` を提供する。
 */
const {
	pageData,
}: {
	pageData: {
		activities: {
			id: number;
			name: string;
			displayName: string;
			icon: string;
			categoryId: number;
			dailyLimit: number | null;
			isMission: boolean;
			// #2146: priority='must' は ActivityCard 自身の ribbon badge で表示
			priority?: 'must' | 'optional';
		}[];
		uiMode: string;
		hasChecklists: boolean;
		checklistProgress: { checkedCount: number; totalCount: number; allDone: boolean } | null;
		dailyMissions: {
			missions: { id: number; activityIcon: string; activityName: string; completed: boolean }[];
			completedCount: number;
			allComplete: boolean;
			bonusAwarded: number;
		} | null;
		/**
		 * #2146: must 集計 API は demo 側でも後方互換維持（test 利用継続）。
		 * UI は ActivityCard 自身に統合されたため本 component では直接参照しない。
		 */
		mustStatus: { logged: number; total: number; granted: boolean; points: number } | null;
	};
} = $props();

const service = getDashboardService();
const homeData = $derived(service.getHomeData());

const ps = $derived(homeData.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

const recordedMap = $derived(new Map(homeData.todayRecorded.map((r) => [r.activityId, r.count])));

function getCount(activityId: number): number {
	return recordedMap.get(activityId) ?? 0;
}

function isCompleted(activity: { id: number; dailyLimit: number | null }): boolean {
	const limit = activity.dailyLimit ?? 1;
	if (limit === 0) return false;
	return getCount(activity.id) >= limit;
}

const activitiesByCategory = $derived(
	CATEGORY_DEFS.map((catDef) => ({
		categoryId: catDef.id,
		items: pageData.activities.filter((a) => a.categoryId === catDef.id),
	})).filter((g) => g.items.length > 0),
);

// Confirm / result dialog state
let confirmOpen = $state(false);
let selectedActivity = $state<{
	id: number;
	name: string;
	displayName?: string;
	icon: string;
} | null>(null);
let submitting = $state(false);
let resultOpen = $state(false);
let resultData = $state<{ activityName: string; totalPoints: number; streakDays: number } | null>(
	null,
);

const anyDialogOpen = $derived(confirmOpen || resultOpen);

function handleActivityTap(activity: {
	id: number;
	name: string;
	displayName?: string;
	icon: string;
}) {
	if (anyDialogOpen || submitting) return;
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

<div class="px-[var(--sp-sm)] py-1">
	<!--
		#2146: 「今日のおやくそく」専用セクション (MustProgressBar) は廃止。
		priority='must' の活動は ActivityCard 自身に ribbon badge + gold border で表示する。
		mustStatus 集計 API は demo-must-status.test 等で後方互換維持（unit test 参照）。
	-->

	{#if pageData.hasChecklists}
		<div
			class="flex items-center justify-between w-full px-[var(--sp-md)] py-[var(--sp-sm)] mb-[var(--sp-sm)] rounded-[var(--radius-lg)] bg-white shadow-sm border border-[var(--color-border)]"
		>
			<div class="flex items-center gap-[var(--sp-sm)]">
				<span class="text-2xl">📋</span>
				<span class="font-bold">{DEMO_CHILD_HOME_LABELS.checklistTitle}</span>
			</div>
			{#if pageData.checklistProgress}
				<div class="flex items-center gap-[var(--sp-xs)]">
					{#if pageData.checklistProgress.allDone}
						<span class="text-sm font-bold text-[var(--theme-accent)]">{DEMO_CHILD_HOME_LABELS.checklistDone}</span>
					{:else}
						<span class="text-sm text-[var(--color-text-muted)]">
							{pageData.checklistProgress.checkedCount}/{pageData.checklistProgress.totalCount}
						</span>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if pageData.dailyMissions && pageData.dailyMissions.missions.length > 0}
		<div class="mb-[var(--sp-sm)] rounded-[var(--radius-lg)] bg-white shadow-sm border border-[var(--color-border)] overflow-hidden">
			<div class="flex items-center gap-[var(--sp-xs)] px-[var(--sp-md)] pt-[var(--sp-sm)] pb-1">
				<span class="text-lg">🎯</span>
				<span class="font-bold text-sm">{DEMO_CHILD_HOME_LABELS.dailyMissionTitle}</span>
				<span class="text-xs text-[var(--color-text-muted)] ml-auto">
					{pageData.dailyMissions.completedCount}/{pageData.dailyMissions.missions.length}
				</span>
			</div>
			<div class="px-[var(--sp-md)] pb-[var(--sp-sm)]">
				{#each pageData.dailyMissions.missions as mission (mission.id)}
					<div class="flex items-center gap-[var(--sp-sm)] py-1">
						<span class="text-lg w-6 text-center">{mission.completed ? '✅' : '⬜'}</span>
						<span class="text-lg">{mission.activityIcon}</span>
						<span class="text-sm {mission.completed ? 'line-through text-[var(--color-text-muted)]' : 'font-bold'}">
							{mission.activityName}
						</span>
					</div>
				{/each}
				{#if pageData.dailyMissions.allComplete}
					<div class="text-center mt-1 py-1 rounded-[var(--radius-md)] bg-[var(--theme-bg)]">
						<span class="text-sm font-bold text-[var(--theme-accent)]">{DEMO_CHILD_HOME_LABELS.missionComplete(fmtPts(pageData.dailyMissions.bonusAwarded))}</span>
					</div>
				{/if}
			</div>
		</div>
	{/if}

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
					isMust={activity.priority === 'must'}
					onclick={() => handleActivityTap(activity)}
				/>
			{/each}
		</CategorySection>
	{/each}

	{#if pageData.activities.length === 0}
		<div class="flex flex-col items-center justify-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-md)]">📋</span>
			<p class="text-[var(--font-md)]">{DEMO_CHILD_HOME_LABELS.activitiesEmpty}</p>
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
					{submitting ? DEMO_CHILD_HOME_LABELS.recordingLabel : DEMO_CHILD_HOME_LABELS.recordButton}
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
				{formatStreak(resultData.streakDays)}{DEMO_CHILD_HOME_LABELS.resultStreakSuffix}
			</p>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">{DEMO_CHILD_HOME_LABELS.resultTodayPrefix} {homeData.todayRecorded.reduce((sum, r) => sum + r.count, 0) + 1}{DEMO_CHILD_HOME_LABELS.resultTodaySuffix}</p>
			<p class="text-xs text-[var(--color-feedback-warning-text)] mt-3">
				{DEMO_CHILD_HOME_LABELS.demoDataNote}
			</p>
			<a
				href="/demo/signup"
				class="mt-3 block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-[var(--radius-lg)] text-center text-sm"
			>
				{DEMO_CHILD_HOME_LABELS.signupCta}
			</a>
			<Button
				variant="primary"
				size="md"
				class="mt-2 w-full bg-[var(--theme-accent)]"
				onclick={handleResultClose}
			>
				{DEMO_CHILD_HOME_LABELS.closeButton}
			</Button>
		</div>
	{/if}
</Dialog>
