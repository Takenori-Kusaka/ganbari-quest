<!--
  DashboardView.svelte — ADR-0046 / ADR-0047 Phase 2

  Child Home の共通 UI コンポーネント。

  ## Phase 2 構造 (ADR-0047)

  本コンポーネントは **`ChildHomeViewModel` 入力経路** をメインに昇格した。
  Phase 2 では UI 等価性 (本番 degrade なし) を最優先とし、本番固有 feature
  (pin / mission badge / event badge / baby inline form / xp animation /
  sibling ranking / frozen activity / triggerHint / mainQuest) を全て render する。

  ### 入力経路

  1. **`viewModel` 経路 (本番、ADR-0047)**:
     - `viewModel: ChildHomeViewModel` を main contract として受け取る
     - 本番固有 feature の表示判定は `viewModel.features.*` フラグで行う
     - 本番固有の Drizzle 詳細フィールド (displayName / frozen / triggerHint /
       isMainQuest 等) は ChildHomeViewModel に含まれないため、互換ブリッジとして
       `auxiliaryActivities` 補助 props で受け取る。Phase 4 以降で `ChildHomeActivity`
       を拡張して補助 props を削減予定。

  2. **`pageData` 経路 (demo、Phase 3 で廃止)**:
     - 旧 demo 側 `+page.svelte` からそのまま `pageData` を受け取る互換 path
     - Phase 3 で `DemoDashboardService.toViewModel()` 実装後、本 path は削除

  ### 旧 `ProdDashboardSections.svelte` との関係

  ProdDashboardSections.svelte は Phase 2 完了時点で `+page.svelte` から呼ばれなくなる
  (孤児コンポーネント)。Phase 3 で demo 側を ViewModel 化する PR にて `git rm` される。
-->
<script lang="ts">
import { enhance } from '$app/forms';
import type { parseDisplayConfig } from '$lib/domain/display-config';
import { CHILD_HOME_LABELS, DEMO_CHILD_HOME_LABELS, formatStreak } from '$lib/domain/labels';
import { formatPointValueWithSign } from '$lib/domain/point-display';
import { CATEGORY_DEFS, getCategoryById } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier';
import MustProgressBar from '$lib/features/child/MustProgressBar.svelte';
import type { CategoryXpInfo } from '$lib/server/services/status-service';
import { getDashboardService } from '$lib/services/context';
import type { ChildHomeViewModel } from '$lib/services/types';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import ActivityEmptyState from '$lib/ui/components/ActivityEmptyState.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import SiblingRanking from '$lib/ui/components/SiblingRanking.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
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
 * Props — `viewModel` 経路 (本番) / `pageData` 経路 (demo) の hybrid。
 */
const {
	// ---- viewModel 経路 (本番、ADR-0047) ----
	viewModel = undefined,
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
	// ---- pageData 経路 (demo、Phase 3 で廃止) ----
	pageData = undefined,
}: {
	viewModel?: ChildHomeViewModel;
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
	pageData?: {
		activities: {
			id: number;
			name: string;
			displayName: string;
			icon: string;
			categoryId: number;
			dailyLimit: number | null;
			isMission: boolean;
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
		mustStatus: { logged: number; total: number; granted: boolean; points: number } | null;
	};
} = $props();

// ADR-0046: getDashboardService は viewModel 経路でも todayRecorded を共有するため使う
const service = getDashboardService();
const homeData = $derived(service.getHomeData());

// auxiliary activity を id で参照しやすくするマップ
const auxMap = $derived(new Map(auxiliaryActivities.map((a) => [a.id, a])));

// =============================================================================
// viewModel 経路 (本番、ADR-0047) — activities by category
// =============================================================================

const vmActivitiesByCategory = $derived(
	viewModel
		? CATEGORY_DEFS.map((catDef) => ({
				categoryId: catDef.id,
				items: viewModel.activities.filter((a) => a.categoryId === catDef.id),
			})).filter((g) => g.items.length > 0)
		: [],
);

// =============================================================================
// pageData 経路 (demo 互換、Phase 3 で削除予定)
// =============================================================================

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

const demoActivitiesByCategory = $derived(
	pageData
		? CATEGORY_DEFS.map((catDef) => ({
				categoryId: catDef.id,
				items: pageData.activities.filter((a) => a.categoryId === catDef.id),
			})).filter((g) => g.items.length > 0)
		: [],
);

// Confirm / result dialog state (pageData 経路で使う)
let confirmOpen = $state(false);
let selectedActivity = $state<{
	id: number;
	name: string;
	displayName?: string;
	icon: string;
} | null>(null);
let demoSubmitting = $state(false);
let resultOpen = $state(false);
let resultData = $state<{ activityName: string; totalPoints: number; streakDays: number } | null>(
	null,
);

const anyDialogOpen = $derived(confirmOpen || resultOpen);

function handleDemoActivityTap(activity: {
	id: number;
	name: string;
	displayName?: string;
	icon: string;
}) {
	if (anyDialogOpen || demoSubmitting) return;
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

{#if viewModel}
	<!-- ====================================================================
	     本番経路 (ADR-0047 Phase 2): ViewModel ベース dashboard sections
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
{:else if pageData}
	<!-- ====================================================================
	     demo 互換経路 (Phase 3 で削除): 旧 pageData ベース
	     ==================================================================== -->
	<div class="px-[var(--sp-sm)] py-1">
		{#if pageData.mustStatus && pageData.mustStatus.total > 0 && pageData.uiMode !== 'baby'}
			<MustProgressBar
				logged={pageData.mustStatus.logged}
				total={pageData.mustStatus.total}
				uiMode={pageData.uiMode as UiMode}
				bonusGranted={pageData.mustStatus.granted}
				bonusPoints={pageData.mustStatus.points}
			/>
		{/if}

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

		{#each demoActivitiesByCategory as group (group.categoryId)}
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
						onclick={() => handleDemoActivityTap(activity)}
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
						demoSubmitting = true;
						return async ({ result }) => {
							demoSubmitting = false;
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
						disabled={demoSubmitting}
						class="w-full bg-[var(--theme-accent)] disabled:opacity-50"
					>
						{demoSubmitting ? DEMO_CHILD_HOME_LABELS.recordingLabel : DEMO_CHILD_HOME_LABELS.recordButton}
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
{/if}
