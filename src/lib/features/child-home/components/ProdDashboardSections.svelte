<!--
  ProdDashboardSections.svelte — ADR-0046 / Issue #2084 follow-up

  本番 child home (`src/routes/(child)/[uiMode=uiMode]/home/+page.svelte`) の
  共通 dashboard sections を `DashboardView.svelte` の派生として抽出したもの。

  ## 役割

  本番 page から以下を集約描画する:

    - カテゴリ別アクティビティグリッド (`CategorySection` + `ActivityCard`/baby inline form)
      （#2146: priority='must' のカードは ActivityCard 自身に riboon badge を表示。
        旧 MustProgressBar 専用セクションは廃止）
    - 空状態 (`ActivityEmptyState`)
    - きょうだいランキング (`SiblingRanking`)

  本番固有のオーバーレイ / 確認 dialog / 結果 dialog / xp animation 等は
  page 側に残し、本コンポーネントは Service Interface 経由でデータを参照する。

  ## Issue #2084 AC との整合

    - AC1 「共通 UI 描画ロジックの少なくとも 50% を DashboardView (もしくは派生コンポーネント) に集約」
      → 本派生コンポーネントが該当 (約 200 行を本ファイルに移行)
    - AC2 「本番側で `getDashboardService().getHomeData()` 経由で
      child / todayRecorded / pointSettings を参照する」
      → 本コンポーネント内で `getDashboardService()` を呼ぶ

  ## demo 側 `DashboardView.svelte` との関係

  demo 側 (`DashboardView.svelte`) は POC のシンプル UI で完結。本派生は本番固有
  feature (pin / mission badge / event badge / xp animation / baby inline form) を
  含むため demo に逆輸入はしない (POC scope 厳守)。
  Tier 3 (#566) で demo / 本番統合時に本派生を SSOT 化するロードマップ。
-->
<script lang="ts">
import { enhance } from '$app/forms';
import type { parseDisplayConfig } from '$lib/domain/display-config';
import { CHILD_HOME_LABELS } from '$lib/domain/labels';
import { CATEGORY_DEFS, getCategoryById } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier';
import type { CategoryXpInfo } from '$lib/server/services/status-service';
import { getDashboardService } from '$lib/services/context';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import ActivityEmptyState from '$lib/ui/components/ActivityEmptyState.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import SiblingRanking from '$lib/ui/components/SiblingRanking.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import { soundService } from '$lib/ui/sound';

/**
 * Sibling ranking data type — `SiblingRanking.svelte` の private interface に整合する形。
 * (private のため duplicate 定義、改名時は同期必要)
 */
interface SiblingRankingRow {
	childId: number;
	childName: string;
	totalCount: number;
	categoryCounts: Record<number, number>;
}

/**
 * Props — 本番 page 側で組み立て済みの状態 + コールバック束。
 *
 * - データ取得は **Context 経由** で `getDashboardService()` を内部で呼ぶ
 *   (`child` / `todayRecorded` / `pointSettings`)。
 * - 本番固有の派生値 (xpInfo / missionCount / displayConfig / activeEventBadge 等) は
 *   props で受け取り、本派生は描画のみに専念する。
 */
const {
	uiMode,
	activities,
	siblingRanking,
	activeEventBadge,
	displayConfig,
	features,
	isPremium,
	childId,
	submitting,
	pendingActivityId,
	getCategoryXpWithAnim,
	xpAnimatingCategoryId,
	getCategoryMissionCount,
	getCategoryCompletedMissionCount,
	onActivityTap,
	onActivityLongPress,
	onRecordSubmit,
	onRecordResult,
}: {
	uiMode: UiMode;
	/**
	 * 本番 `+page.server.ts` から渡される活動配列。Drizzle の生レコード
	 * (isPinned/isMainQuest が 0|1 の number, source が string 等) を緩く受ける形。
	 * UI 描画箇所でのみ boolean 評価 / cast する。
	 *
	 * #2146: priority (`'must' | 'optional'`) は ActivityCard / baby inline form で
	 * 「今日のおやくそく」riboon badge を出すために参照する。
	 */
	activities: Array<{
		id: number;
		name: string;
		displayName: string;
		icon: string;
		categoryId: number;
		dailyLimit: number | null;
		isMission: boolean;
		isMainQuest?: boolean | number;
		isPinned?: boolean | number;
		source?: string;
		triggerHint?: string | null;
		priority?: 'must' | 'optional';
		[key: string]: unknown;
	}>;
	siblingRanking: { rankings: SiblingRankingRow[] } | null;
	activeEventBadge: string | null;
	displayConfig: ReturnType<typeof parseDisplayConfig>;
	features: {
		showPin: boolean;
		showConfirmDialog: boolean;
		showSiblingFeatures: boolean;
		showEvents: boolean;
	};
	isPremium: boolean;
	childId: number;
	submitting: boolean;
	pendingActivityId: number | null;
	getCategoryXpWithAnim: (categoryId: number) => CategoryXpInfo | null;
	xpAnimatingCategoryId: number | null;
	getCategoryMissionCount: (categoryId: number) => number;
	getCategoryCompletedMissionCount: (categoryId: number) => number;
	onActivityTap: (activity: { id: number; name: string; icon: string }) => void;
	onActivityLongPress: (activity: {
		id: number;
		name: string;
		isPinned?: boolean | number;
	}) => void;
	onRecordSubmit: (activityId: number) => void;
	onRecordResult: (result: { type: string; data?: Record<string, unknown> }) => void;
} = $props();

// ADR-0046 / Issue #2084 AC2: getDashboardService 経由で child / todayRecorded / pointSettings を参照
const service = getDashboardService();
const homeData = $derived(service.getHomeData());
const recordedMap = $derived(new Map(homeData.todayRecorded.map((r) => [r.activityId, r.count])));

function getCount(activityId: number): number {
	return recordedMap.get(activityId) ?? 0;
}

function isCompleted(activity: { id: number; dailyLimit: number | null }): boolean {
	const limit = activity.dailyLimit ?? 1;
	if (limit === 0) return false;
	return getCount(activity.id) >= limit;
}

// Group activities by category (本番 page と同じ派生)
const activitiesByCategory = $derived(
	CATEGORY_DEFS.map((catDef) => ({
		categoryId: catDef.id,
		items: activities.filter((a) => a.categoryId === catDef.id),
	})).filter((g) => g.items.length > 0),
);

// childId は context の child の id と一致するはず。一致しない場合は
// (child)/+layout.server.ts ↔ home/+page.server.ts 間の load 順序問題の可能性があるが、
// 現実装では `data.child` を service と props の両方に同じ load 経由で渡しているため
// 不整合は発生しない。アサーション維持のため $effect は置かず props 利用に留める。
</script>

<!--
	#2146: 「今日のおやくそく」専用セクション (MustProgressBar) は廃止。
	priority='must' の活動は ActivityCard 自身に riboon badge + gold border で表示する。
	全達成 bonus 通知 (mustStatus.granted) は呼び出し側 (+page.svelte) で Toast 演出を継続。
-->

<!-- Activity grid by category -->
{#each activitiesByCategory as group, groupIdx (group.categoryId)}
	<CategorySection
		categoryId={group.categoryId}
		cardSize={displayConfig.cardSize}
		itemsPerCategory={displayConfig.itemsPerCategory}
		collapsible={displayConfig.collapsible}
		itemCount={group.items.length}
		xpInfo={getCategoryXpWithAnim(group.categoryId)}
		xpAnimating={xpAnimatingCategoryId === group.categoryId}
		missionCount={getCategoryMissionCount(group.categoryId)}
		completedMissionCount={getCategoryCompletedMissionCount(group.categoryId)}
	>
		{#each group.items as activity, i (activity.id)}
			{#if features.showPin && i > 0 && !activity.isPinned && group.items[i - 1]?.isPinned}
				<div class="col-span-full flex items-center gap-2 my-0.5" aria-hidden="true" data-testid="pin-separator">
					<div class="flex-1 border-t border-dashed border-[var(--color-border-strong)]"></div>
				</div>
			{/if}
			{#if features.showConfirmDialog}
				<!-- Non-baby: ActivityCard + confirm dialog -->
				{#if groupIdx === 0 && i === 0}
				<div data-tutorial="activity-card">
				<ActivityCard
					activityId={activity.id}
					icon={activity.icon}
					name={activity.displayName}
					categoryId={activity.categoryId}
					cardSize={displayConfig.cardSize}
					completed={isCompleted(activity)}
					count={getCount(activity.id)}
					isMission={activity.isMission}
					isPinned={!!activity.isPinned}
					frozen={!isPremium && activity.source === 'custom'}
					triggerHint={activity.triggerHint}
					eventBadge={activeEventBadge}
					isMust={activity.priority === 'must'}
					onclick={() => onActivityTap(activity)}
					onlongpress={() => onActivityLongPress(activity)}
				/>
				</div>
				{:else}
				<ActivityCard
					activityId={activity.id}
					icon={activity.icon}
					name={activity.displayName}
					categoryId={activity.categoryId}
					cardSize={displayConfig.cardSize}
					completed={isCompleted(activity)}
					count={getCount(activity.id)}
					isMission={activity.isMission}
					isPinned={!!activity.isPinned}
					frozen={!isPremium && activity.source === 'custom'}
					triggerHint={activity.triggerHint}
					eventBadge={activeEventBadge}
					isMust={activity.priority === 'must'}
					onclick={() => onActivityTap(activity)}
					onlongpress={() => onActivityLongPress(activity)}
				/>
				{/if}
			{:else}
				<!-- Baby: inline form recording (no confirm dialog) -->
				{@const completed = isCompleted(activity)}
				{@const borderColor = getCategoryById(activity.categoryId)?.color ?? 'var(--theme-primary)'}
				{@const actCount = getCount(activity.id)}
				{@const showMission = activity.isMission && !completed}
				{@const showMainQuest = !!activity.isMainQuest && !completed}
				{#if completed}
					<div
						class="relative flex flex-col items-center justify-center gap-0.5 w-full aspect-[4/5] min-h-[60px] rounded-[var(--radius-md)] border-2 border-[var(--color-gold-400)] bg-[var(--color-gold-100)] shadow-[0_0_0_2px_rgba(251,191,36,0.3)] transition-all duration-150 ease-out tap-target"
						data-testid="activity-card-{activity.id}"
						data-tutorial={groupIdx === 0 && i === 0 ? 'activity-card' : undefined}
						aria-label={CHILD_HOME_LABELS.completedAriaLabel(activity.displayName)}
					>
						<span class="absolute inset-0 flex items-center justify-center text-3xl opacity-80 z-1 animate-bounce-in">💮</span>
						<CompoundIcon icon={activity.icon} size="lg" faded={true} />
						<span class="text-[10px] font-bold leading-tight text-center line-clamp-2 opacity-40">{activity.displayName}</span>
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
							onRecordSubmit(activity.id);
							return async ({ result }) => {
								onRecordResult(result);
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
							aria-label="{CHILD_HOME_LABELS.babyCardRecordAriaLabel(activity.displayName)}{showMainQuest ? CHILD_HOME_LABELS.babyCardRecordMainQuestSuffix : ''}{showMission ? CHILD_HOME_LABELS.babyCardRecordMissionSuffix : ''}"
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
								<span class="text-[10px] font-bold leading-tight text-center line-clamp-2">{activity.displayName}</span>
								{#if activity.triggerHint}
									<span class="text-[9px] font-bold text-orange-500 leading-tight text-center line-clamp-1 px-0.5">{activity.triggerHint}</span>
								{/if}
							{/if}
						</Button>
					</form>
				{/if}
			{/if}
		{/each}
	</CategorySection>
{/each}

<!-- Sibling ranking (non-baby) -->
{#if features.showSiblingFeatures && siblingRanking && siblingRanking.rankings.length > 1}
	<SiblingRanking
		rankings={siblingRanking.rankings}
		{childId}
	/>
{/if}

{#if activities.length === 0}
	<ActivityEmptyState {uiMode} />
{/if}
