<!--
  DashboardView.svelte — ADR-0046 / ADR-0047 Phase 3 (#2097)

  Child Home の共通 UI コンポーネント (demo / 本番統合後の SSOT)。

  ## Phase 3 構造 (ADR-0047)

  本コンポーネントは **`ChildHomeViewModel` 経路のみ** を持つ (型強制 SSOT)。

  - demo / 本番両 `+page.svelte` から同じ `<DashboardView {viewModel} ... />` を呼ぶ
  - `viewModel: ChildHomeViewModel` を必須 prop として受け取る (型強制、`as never` キャスト不可)
  - 本番固有の Drizzle 詳細フィールド (displayName / frozen / triggerHint / isMainQuest)
    は ChildHomeViewModel に含まれないため、互換ブリッジとして `auxiliaryActivities`
    補助 props で受け取る (Phase 4 以降で `ChildHomeActivity` を拡張して削減予定)

  ## Phase 1-3 累積効果

  Phase 1 で ViewModel 型定義 → Phase 2 で Production toViewModel() + 本番 page を ViewModel 経路に
  → Phase 3 で Demo toViewModel() + demo page を ViewModel 経路に + ProdDashboardSections 削除。

  この時点で並行実装 2 系統 (#531 から 6 回目の指摘) が **構造的に解消**: 描画ファイルが
  本コンポーネント 1 件のみ (`grep` で `*DashboardView*` / `*DashboardSection*` が 1 件)。

  ### 削除済コンポーネント

  - `ProdDashboardSections.svelte` (Phase 3 で `git rm`、322 行)
-->
<script lang="ts">
import { enhance } from '$app/forms';
import type { parseDisplayConfig } from '$lib/domain/display-config';
import { CHILD_HOME_LABELS } from '$lib/domain/labels';
import { CATEGORY_DEFS, getCategoryById } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier';
import MustProgressBar from '$lib/features/child/MustProgressBar.svelte';
import type { CategoryXpInfo } from '$lib/server/services/status-service';
import type { ChildHomeViewModel } from '$lib/services/types';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import ActivityEmptyState from '$lib/ui/components/ActivityEmptyState.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import SiblingRanking from '$lib/ui/components/SiblingRanking.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import { soundService } from '$lib/ui/sound';

/**
 * Sibling ranking row 型 (`SiblingRanking.svelte` private interface に整合)。
 */
interface SiblingRankingRow {
	childId: number;
	childName: string;
	totalCount: number;
	categoryCounts: Record<number, number>;
}

/**
 * 本番互換ブリッジ用 auxiliary activity 型 (Phase 4 で `ChildHomeActivity` に統合予定)。
 *
 * `+page.server.ts` から渡される Drizzle 生レコードのうち、ViewModel に含まれない
 * UI 描画必須フィールド (displayName / frozen / triggerHint / isMainQuest) を保持する。
 * `id` で `viewModel.activities[i]` と紐付け。
 */
interface AuxiliaryActivity {
	id: number;
	displayName: string;
	frozen: boolean;
	triggerHint?: string | null;
	isMainQuest?: boolean | number;
}

/**
 * Props — `viewModel` 経路のみ (Phase 3 で `pageData` 経路を削除、SSOT 1 経路化)。
 */
const {
	viewModel,
	auxiliaryActivities = [],
	mustStatus = null,
	siblingRanking = null,
	displayConfig = null,
	childId = 0,
	submitting = false,
	pendingActivityId = null,
	getCategoryXpWithAnim = undefined,
	xpAnimatingCategoryId = null,
	getCategoryMissionCount = undefined,
	getCategoryCompletedMissionCount = undefined,
	activeEventBadge = null,
	onActivityTap = undefined,
	onActivityLongPress = undefined,
	onRecordSubmit = undefined,
	onRecordResult = undefined,
}: {
	viewModel: ChildHomeViewModel;
	auxiliaryActivities?: readonly AuxiliaryActivity[];
	mustStatus?: { logged: number; total: number; granted: boolean; points: number } | null;
	siblingRanking?: { rankings: SiblingRankingRow[] } | null;
	displayConfig?: ReturnType<typeof parseDisplayConfig> | null;
	childId?: number;
	submitting?: boolean;
	pendingActivityId?: number | null;
	getCategoryXpWithAnim?: (categoryId: number) => CategoryXpInfo | null;
	xpAnimatingCategoryId?: number | null;
	getCategoryMissionCount?: (categoryId: number) => number;
	getCategoryCompletedMissionCount?: (categoryId: number) => number;
	activeEventBadge?: string | null;
	onActivityTap?: (activity: { id: number; name: string; icon: string }) => void;
	onActivityLongPress?: (activity: {
		id: number;
		name: string;
		isPinned?: boolean | number;
	}) => void;
	onRecordSubmit?: (activityId: number) => void;
	onRecordResult?: (result: { type: string; data?: Record<string, unknown> }) => void;
} = $props();

// auxiliary activity を id で参照しやすくするマップ
const auxMap = $derived(new Map(auxiliaryActivities.map((a) => [a.id, a])));

// activities by category (ChildHomeViewModel.activities を 5 カテゴリで group 化)
const vmActivitiesByCategory = $derived(
	CATEGORY_DEFS.map((catDef) => ({
		categoryId: catDef.id,
		items: viewModel.activities.filter((a) => a.categoryId === catDef.id),
	})).filter((g) => g.items.length > 0),
);
</script>

<!-- ====================================================================
     ADR-0047 Phase 3 (#2097): ViewModel SSOT 経路 (demo / 本番統合後)
     本番固有 feature (pin / mission / event badge / baby inline form /
     sibling ranking / frozen / triggerHint / mainQuest) を render する。
     ==================================================================== -->
{#if mustStatus && mustStatus.total > 0}
	<MustProgressBar
		logged={mustStatus.logged}
		total={mustStatus.total}
		uiMode={viewModel.uiMode as UiMode}
		bonusGranted={mustStatus.granted}
		bonusPoints={mustStatus.points}
	/>
{/if}

{#each vmActivitiesByCategory as group, groupIdx (group.categoryId)}
	<CategorySection
		categoryId={group.categoryId}
		cardSize={displayConfig?.cardSize}
		itemsPerCategory={displayConfig?.itemsPerCategory}
		collapsible={displayConfig?.collapsible}
		itemCount={group.items.length}
		xpInfo={getCategoryXpWithAnim ? getCategoryXpWithAnim(group.categoryId) : null}
		xpAnimating={xpAnimatingCategoryId === group.categoryId}
		missionCount={getCategoryMissionCount ? getCategoryMissionCount(group.categoryId) : 0}
		completedMissionCount={getCategoryCompletedMissionCount ? getCategoryCompletedMissionCount(group.categoryId) : 0}
	>
		{#each group.items as activity, i (activity.id)}
			{@const aux = auxMap.get(activity.id)}
			{@const displayName = aux?.displayName ?? activity.name}
			{@const completed = activity.todayRecorded >= 1}
			{#if viewModel.features.showPinButton && i > 0 && !activity.isPinned && group.items[i - 1]?.isPinned}
				<div class="col-span-full flex items-center gap-2 my-0.5" aria-hidden="true" data-testid="pin-separator">
					<div class="flex-1 border-t border-dashed border-[var(--color-border-strong)]"></div>
				</div>
			{/if}
			{#if !viewModel.ageContext.isBabyParentMode}
				<!-- Non-baby: ActivityCard + confirm dialog (handled by page) -->
				{#if groupIdx === 0 && i === 0}
					<div data-tutorial="activity-card">
						<ActivityCard
							activityId={activity.id}
							icon={activity.icon}
							name={displayName}
							categoryId={activity.categoryId}
							cardSize={displayConfig?.cardSize}
							{completed}
							count={activity.todayRecorded}
							isMission={activity.isMust}
							isPinned={activity.isPinned}
							frozen={aux?.frozen ?? false}
							triggerHint={aux?.triggerHint}
							eventBadge={activeEventBadge}
							onclick={() => onActivityTap?.({ id: activity.id, name: displayName, icon: activity.icon })}
							onlongpress={() => onActivityLongPress?.({ id: activity.id, name: displayName, isPinned: activity.isPinned })}
						/>
					</div>
				{:else}
					<ActivityCard
						activityId={activity.id}
						icon={activity.icon}
						name={displayName}
						categoryId={activity.categoryId}
						cardSize={displayConfig?.cardSize}
						{completed}
						count={activity.todayRecorded}
						isMission={activity.isMust}
						isPinned={activity.isPinned}
						frozen={aux?.frozen ?? false}
						triggerHint={aux?.triggerHint}
						eventBadge={activeEventBadge}
						onclick={() => onActivityTap?.({ id: activity.id, name: displayName, icon: activity.icon })}
						onlongpress={() => onActivityLongPress?.({ id: activity.id, name: displayName, isPinned: activity.isPinned })}
					/>
				{/if}
			{:else}
				<!-- Baby inline form recording (no confirm dialog) -->
				{@const borderColor = getCategoryById(activity.categoryId)?.color ?? 'var(--theme-primary)'}
				{@const actCount = activity.todayRecorded}
				{@const showMission = activity.isMust && !completed}
				{@const showMainQuest = !!aux?.isMainQuest && !completed}
				{#if completed}
					<div
						class="relative flex flex-col items-center justify-center gap-0.5 w-full aspect-[4/5] min-h-[60px] rounded-[var(--radius-md)] border-2 border-[var(--color-gold-400)] bg-[var(--color-gold-100)] shadow-[0_0_0_2px_rgba(251,191,36,0.3)] transition-all duration-150 ease-out tap-target"
						data-testid="activity-card-{activity.id}"
						data-tutorial={groupIdx === 0 && i === 0 ? 'activity-card' : undefined}
						aria-label={CHILD_HOME_LABELS.completedAriaLabel(displayName)}
					>
						<span class="absolute inset-0 flex items-center justify-center text-3xl opacity-80 z-1 animate-bounce-in">💮</span>
						<CompoundIcon icon={activity.icon} size="lg" faded={true} />
						<span class="text-[10px] font-bold leading-tight text-center line-clamp-2 opacity-40">{displayName}</span>
					</div>
				{:else}
					<form
						method="POST"
						action="?/record"
						data-tutorial={groupIdx === 0 && i === 0 ? 'activity-card' : undefined}
						use:enhance={() => {
							if (submitting) return ({ update }) => update();
							soundService.ensureContext();
							soundService.play('tap');
							onRecordSubmit?.(activity.id);
							return async ({ result }) => {
								onRecordResult?.(result);
							};
						}}
					>
						<input type="hidden" name="activityId" value={activity.id} />
						<Button
							type="submit"
							disabled={submitting}
							variant="outline"
							size="sm"
							class="relative flex flex-col items-center justify-center gap-0.5 w-full aspect-[4/5] min-h-[60px] border-2 border-solid bg-white shadow-sm cursor-pointer duration-150 ease-out hover:shadow-md active:scale-95 {pendingActivityId === activity.id ? 'baby-card-pending' : ''} {showMission ? 'baby-card-mission' : ''} {showMainQuest ? 'baby-card-main-quest' : ''}"
							data-testid="activity-card-{activity.id}"
							style="border-color: {showMainQuest ? 'var(--color-gold-500, #d97706)' : showMission ? 'gold' : borderColor}"
							aria-label="{CHILD_HOME_LABELS.babyCardRecordAriaLabel(displayName)}{showMainQuest ? CHILD_HOME_LABELS.babyCardRecordMainQuestSuffix : ''}{showMission ? CHILD_HOME_LABELS.babyCardRecordMissionSuffix : ''}"
						>
							{#if showMission}
								<span class="absolute -top-1.5 -left-1.5 z-10 text-sm baby-card__mission-star" aria-hidden="true">⭐</span>
							{/if}
							{#if showMainQuest}
								<span class="baby-main-quest-badge" aria-hidden="true">{CHILD_HOME_LABELS.babyCardMainQuestBadge}</span>
							{/if}
							{#if pendingActivityId === activity.id}
								<span class="baby-card__spinner" aria-hidden="true"></span>
								<span class="text-[10px] font-bold leading-tight text-center line-clamp-2">{CHILD_HOME_LABELS.babyCardPendingText}</span>
							{:else}
								{#if actCount > 0}
									<span class="absolute -top-1 -right-1 z-10 flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-brand-600)] text-white text-[10px] font-bold shadow-sm">{actCount}</span>
								{/if}
								<CompoundIcon icon={activity.icon} size="lg" />
								<span class="text-[10px] font-bold leading-tight text-center line-clamp-2">{displayName}</span>
								{#if aux?.triggerHint}
									<span class="text-[9px] font-bold text-orange-500 leading-tight text-center line-clamp-1 px-0.5">{aux.triggerHint}</span>
								{/if}
							{/if}
						</Button>
					</form>
				{/if}
			{/if}
		{/each}
	</CategorySection>
{/each}

{#if viewModel.features.showSiblingRanking && siblingRanking && siblingRanking.rankings.length > 1}
	<SiblingRanking rankings={siblingRanking.rankings} {childId} />
{/if}

{#if viewModel.activities.length === 0}
	<ActivityEmptyState uiMode={viewModel.uiMode as UiMode} />
{/if}
