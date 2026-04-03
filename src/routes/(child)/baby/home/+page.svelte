<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { parseDisplayConfig } from '$lib/domain/display-config';
import { formatPointValueWithSign } from '$lib/domain/point-display';
import { CATEGORY_DEFS, getCategoryById } from '$lib/domain/validation/activity';
import BirthdayBanner from '$lib/features/birthday/BirthdayBanner.svelte';
import OverlaysSection from '$lib/features/child-home/components/OverlaysSection.svelte';
import TutorialHintBanner from '$lib/features/child/TutorialHintBanner.svelte';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import ActivityEmptyState from '$lib/ui/components/ActivityEmptyState.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import CelebrationEffect from '$lib/ui/components/CelebrationEffect.svelte';
import type { CelebrationType } from '$lib/ui/components/CelebrationEffect.svelte';
import ChallengeBanner from '$lib/ui/components/ChallengeBanner.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import FamilyStreakBanner from '$lib/ui/components/FamilyStreakBanner.svelte';
import FocusMode from '$lib/ui/components/FocusMode.svelte';
import MonthlyRewardModal from '$lib/ui/components/MonthlyRewardModal.svelte';
import SeasonPassCard from '$lib/ui/components/SeasonPassCard.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';
import { tick } from 'svelte';

let { data } = $props();

const celebEffect: CelebrationType = 'default';
const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

const displayConfig = $derived(parseDisplayConfig(data.child?.displayConfig, data.child?.age ?? 1));

// Tutorial hint banner (one-time, localStorage)
const tutorialHintKey = `child_tutorial_hint_shown_${data.child?.id ?? 0}`;
let showTutorialHint = $state(false);
$effect(() => {
	if (typeof window !== 'undefined') {
		showTutorialHint = !localStorage.getItem(tutorialHintKey);
	}
});
function dismissTutorialHint() {
	showTutorialHint = false;
	if (typeof window !== 'undefined') localStorage.setItem(tutorialHintKey, '1');
}

// Birthday bonus state
let birthdayModalOpen = $state(false);

// Error state
let errorMessage = $state('');

// Submitting state (多重送信防止)
let submitting = $state(false);
let pendingActivityId = $state<number | null>(null);

// Record result overlay
let resultOpen = $state(false);
let resultName = $state('');
let resultIcon = $state('');
let resultPoints = $state(0);
let resultLogId = $state(0);
let resultComboBonus = $state<{
	categoryCombo: { categoryId: number; name: string; bonus: number }[];
	crossCategoryCombo: { name: string; bonus: number } | null;
	totalNewBonus: number;
} | null>(null);
let resultMasteryBonus = $state(0);
let resultMasteryLevel = $state(1);
let resultMasteryLeveledUp = $state<{
	oldLevel: number;
	newLevel: number;
	isMilestone: boolean;
} | null>(null);
let cancelCountdown = $state(0);
let cancelTimerId = $state<ReturnType<typeof setInterval> | null>(null);
let cancelledMessage = $state(false);

// Achievement unlock overlay
let achievementOpen = $state(false);
let unlockedAchievements = $state<
	{ name: string; icon: string; bonusPoints: number; rarity: string }[]
>([]);

// Special reward overlay
let rewardOpen = $state(false);

// Login stamp state (unified bonus + stamp)
let stampPressOpen = $state(false);
let stampPressData = $state<{
	omikujiRank: string;
	totalPoints: number;
	multiplier: number;
	consecutiveDays: number;
} | null>(null);
let bonusClaiming = $state(false);

// Mission complete result state
let missionResult = $state<{
	missionCompleted: boolean;
	allComplete: boolean;
	bonusAwarded: number;
} | null>(null);

// Level up overlay state
let levelUpOpen = $state(false);
let levelUpData = $state<{
	oldLevel: number;
	oldTitle: string;
	newLevel: number;
	newTitle: string;
	categoryId?: number;
	categoryName?: string;
} | null>(null);

// XP gain animation state
let xpGainData = $state<{
	categoryId: number;
	categoryName: string;
	xpBefore: number;
	xpAfter: number;
	maxValue: number;
	levelBefore: number;
	levelAfter: number;
} | null>(null);
let xpAnimatingCategoryId = $state<number | null>(null);

/** categoryXp にアニメーション用の上書き値を適用 */
function getCategoryXpWithAnim(categoryId: number) {
	const base = data.categoryXp?.[categoryId] ?? null;
	if (!base) return null;
	if (xpGainData && xpGainData.categoryId === categoryId && xpAnimatingCategoryId === categoryId) {
		return {
			...base,
			value: xpGainData.xpAfter,
			level: xpGainData.levelAfter,
		};
	}
	return base;
}

// Build recorded counts map: activityId → count
const recordedMap = $derived(new Map(data.todayRecorded.map((r) => [r.activityId, r.count])));

function getCount(activityId: number): number {
	return recordedMap.get(activityId) ?? 0;
}

function isCompleted(activity: { id: number; dailyLimit: number | null }): boolean {
	const limit = activity.dailyLimit ?? 1;
	if (limit === 0) return false; // unlimited
	return getCount(activity.id) >= limit;
}

// Group activities by category (same as kinder)
const activitiesByCategory = $derived(
	CATEGORY_DEFS.map((catDef) => ({
		categoryId: catDef.id,
		items: data.activities.filter((a) => a.categoryId === catDef.id),
	})).filter((g) => g.items.length > 0),
);

// Focus mode (#0264): recommended activities
const recommendedIdSet = $derived(new Set(data.recommendedActivityIds ?? []));
const recommendedActivities = $derived(data.activities.filter((a) => recommendedIdSet.has(a.id)));
const focusCompletedCount = $derived(recommendedActivities.filter((a) => isCompleted(a)).length);
const focusAllCompleted = $derived(
	recommendedActivities.length > 0 && focusCompletedCount === recommendedActivities.length,
);
// Focus mode: programmatic record for ActivityCard tap
let focusRecordActivityId = $state<number | null>(null);

function handleActivityTap(activity: { id: number; name: string; icon: string }) {
	if (submitting) return;
	focusRecordActivityId = activity.id;
	soundService.ensureContext();
	soundService.play('tap');
	tick().then(() => {
		document.getElementById('focus-record-btn')?.click();
	});
}

function handleActivityLongPress(_activity: { id: number; name: string; isPinned?: boolean }) {
	// Baby mode does not support long press actions
}

function startCancelCountdown(until: string) {
	const remaining = Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
	cancelCountdown = remaining;

	if (cancelTimerId) clearInterval(cancelTimerId);
	cancelTimerId = setInterval(() => {
		cancelCountdown--;
		if (cancelCountdown <= 0) {
			if (cancelTimerId) clearInterval(cancelTimerId);
			cancelTimerId = null;
		}
	}, 1000);
}

function handleResultClose() {
	if (cancelTimerId) clearInterval(cancelTimerId);
	cancelTimerId = null;
	resultOpen = false;
	missionResult = null;

	// XPバーアニメーションを開始
	if (xpGainData) {
		xpAnimatingCategoryId = xpGainData.categoryId;
		setTimeout(() => {
			xpAnimatingCategoryId = null;
		}, 900);
	}

	if (levelUpData) {
		levelUpOpen = true;
	} else if (unlockedAchievements.length > 0) {
		achievementOpen = true;
	} else {
		xpGainData = null;
		invalidateAll();
	}
}

function handleLevelUpClose() {
	levelUpOpen = false;
	levelUpData = null;

	if (unlockedAchievements.length > 0) {
		achievementOpen = true;
	} else {
		xpGainData = null;
		invalidateAll();
	}
}

function handleAchievementClose() {
	achievementOpen = false;
	unlockedAchievements = [];
	xpGainData = null;
	invalidateAll();
}

function handleStampPressClose() {
	stampPressOpen = false;
	checkSpecialReward();
	invalidateAll();
}

function checkSpecialReward() {
	if (data.latestReward && !rewardOpen) {
		rewardOpen = true;
	}
}

async function handleRewardClose() {
	if (data.latestReward) {
		try {
			await fetch(`/api/v1/special-rewards/${data.latestReward.id}/shown`, { method: 'POST' });
		} catch {
			// API error - ignore
		}
	}
	rewardOpen = false;
}

// Auto-show login bonus
$effect(() => {
	if (data.loginBonusStatus && !data.loginBonusStatus.claimedToday && !bonusClaiming) {
		bonusClaiming = true;
		tick().then(() => {
			document.getElementById('claim-bonus-btn')?.click();
		});
	}
});

// Check special reward on mount
$effect(() => {
	if (data.latestReward && !bonusClaiming && !stampPressOpen) {
		checkSpecialReward();
	}
});
</script>

<svelte:head>
	<title>ホーム - がんばりクエスト</title>
</svelte:head>

<div class="px-2 py-1">
	<!-- Birthday bonus banner -->
	{#if data.birthdayBonus}
		<BirthdayBanner
			nickname={data.child?.nickname ?? ''}
			newAge={data.birthdayBonus.newAge ?? 0}
			totalPoints={data.birthdayBonus.totalPoints ?? 0}
			onclick={() => { birthdayModalOpen = true; }}
		/>
	{/if}

	<!-- Error toast -->
	{#if errorMessage}
		<div class="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[var(--color-danger)] text-white px-4 py-2 rounded-lg shadow-lg text-sm font-bold animate-bounce-in">
			{errorMessage}
		</div>
	{/if}

	<!-- Login stamp auto-claim form (hidden) — unified bonus + stamp -->
	{#if bonusClaiming && !stampPressOpen}
		<form
			method="POST"
			action="?/loginStamp"
			use:enhance={() => {
				return async ({ result }) => {
					if (result.type === 'success' && result.data && 'loginStamp' in result.data) {
						const d = result.data as { omikujiRank: string; totalPoints: number; multiplier: number; consecutiveLoginDays: number };
						stampPressData = {
							omikujiRank: d.omikujiRank || '吉',
							totalPoints: d.totalPoints,
							multiplier: d.multiplier,
							consecutiveDays: d.consecutiveLoginDays,
						};
						stampPressOpen = true;
					}
					bonusClaiming = false;
				};
			}}
			class="hidden"
		>
			<Button type="submit" id="claim-bonus-btn" variant="ghost" size="sm">claim</Button>
		</form>
	{/if}

	<!-- Hidden form for focus mode programmatic record -->
	{#if focusRecordActivityId !== null}
		<form
			method="POST"
			action="?/record"
			use:enhance={() => {
				submitting = true;
				pendingActivityId = focusRecordActivityId;
				return async ({ result }) => {
					submitting = false;
					pendingActivityId = null;
					focusRecordActivityId = null;
					if (result.type === 'success' && result.data && 'success' in result.data) {
						const d = result.data as {
							logId: number; activityName: string; totalPoints: number; streakDays: number; streakBonus: number;
							masteryBonus?: number; masteryLevel?: number;
							masteryLeveledUp?: { oldLevel: number; newLevel: number; isMilestone: boolean } | null;
							cancelableUntil: string;
							unlockedAchievements: { name: string; icon: string; bonusPoints: number; rarity: string }[];
							comboBonus: { categoryCombo: { categoryId: number; name: string; bonus: number }[]; crossCategoryCombo: { name: string; bonus: number } | null; miniCombo: { uniqueCount: number; bonus: number } | null; hints: { message: string }[]; totalNewBonus: number } | null;
							missionComplete: { missionCompleted: boolean; allComplete: boolean; bonusAwarded: number } | null;
							levelUp: { oldLevel: number; oldTitle: string; newLevel: number; newTitle: string; categoryId?: number; categoryName?: string; spGranted?: number } | null;
							xpGain?: { categoryId: number; categoryName: string; xpBefore: number; xpAfter: number; maxValue: number; levelBefore: number; levelAfter: number };
						};
						resultIcon = '';
						resultName = d.activityName;
						resultPoints = d.totalPoints;
						resultLogId = d.logId;
						resultComboBonus = d.comboBonus ?? null;
						resultMasteryBonus = d.masteryBonus ?? 0;
						resultMasteryLevel = d.masteryLevel ?? 1;
						resultMasteryLeveledUp = d.masteryLeveledUp ?? null;
						unlockedAchievements = d.unlockedAchievements ?? [];
						missionResult = d.missionComplete ?? null;
						levelUpData = d.levelUp ?? null;
						xpGainData = d.xpGain ?? null;
						startCancelCountdown(d.cancelableUntil);
						soundService.playRecordComplete();
						setTimeout(() => soundService.play('point-gain'), 300);
						resultOpen = true;
					} else if (result.type === 'failure' && result.data && 'error' in result.data) {
						errorMessage = String(result.data.error);
						soundService.play('error');
						setTimeout(() => { errorMessage = ''; }, 3000);
						invalidateAll();
					} else {
						invalidateAll();
					}
				};
			}}
			class="hidden"
		>
			<input type="hidden" name="activityId" value={focusRecordActivityId} />
			<Button type="submit" id="focus-record-btn" variant="ghost" size="sm">record</Button>
		</form>
	{/if}

	<!-- Tutorial hint banner (one-time) -->
	<TutorialHintBanner visible={showTutorialHint} onDismiss={dismissTutorialHint} />

	<!-- Daily Quest: compact recommended activities (#0288) -->
	{#if data.focusMode && recommendedActivities.length > 0}
		<div data-tutorial="daily-missions">
		<FocusMode
			{recommendedActivities}
			allCompleted={focusAllCompleted}
			completedCount={focusCompletedCount}
			totalCount={recommendedActivities.length}
			completedIds={new Set(recommendedActivities.filter((a) => isCompleted(a)).map((a) => a.id))}
			onactivityclick={(activity) => handleActivityTap(activity)}
		/>
		</div>
	{/if}

	<!-- Activity grid by category (always visible) -->
	{#each activitiesByCategory as group, groupIdx (group.categoryId)}
			<CategorySection
				categoryId={group.categoryId}
				cardSize={displayConfig.cardSize}
				itemsPerCategory={displayConfig.itemsPerCategory}
				collapsible={displayConfig.collapsible}
				itemCount={group.items.length}
				xpInfo={getCategoryXpWithAnim(group.categoryId)}
				xpAnimating={xpAnimatingCategoryId === group.categoryId}
			>
				{#each group.items as activity, actIdx (activity.id)}
					{@const completed = isCompleted(activity)}
					{@const borderColor = getCategoryById(activity.categoryId)?.color ?? 'var(--theme-primary)'}
					{@const actCount = getCount(activity.id)}
					{@const showMission = activity.isMission && !completed}
					{#if completed}
						<div
							class="relative flex flex-col items-center justify-center gap-0.5 w-full aspect-[4/5] min-h-[60px] rounded-[var(--radius-md)] border-2 border-[var(--color-gold-400)] bg-[var(--color-gold-100)] shadow-[0_0_0_2px_rgba(251,191,36,0.3)] transition-all duration-150 ease-out tap-target"
							data-testid="activity-card-{activity.id}"
							data-tutorial={groupIdx === 0 && actIdx === 0 ? 'activity-card' : undefined}
							aria-label="{activity.displayName}（きろくずみ）"
						>
							<span class="absolute inset-0 flex items-center justify-center text-3xl opacity-80 z-1 animate-bounce-in">💮</span>
							<CompoundIcon icon={activity.icon} size="lg" faded={true} />
							<span class="text-[10px] font-bold leading-tight text-center line-clamp-2 opacity-40">{activity.displayName}</span>
						</div>
					{:else}
						<form
							method="POST"
							action="?/record"
							data-tutorial={groupIdx === 0 && actIdx === 0 ? 'activity-card' : undefined}
							use:enhance={() => {
								if (submitting) return ({ update }) => update();
								submitting = true;
								pendingActivityId = activity.id;
								soundService.ensureContext();
								soundService.play('tap');
								return async ({ result }) => {
									submitting = false;
									pendingActivityId = null;
									if (result.type === 'success' && result.data && 'success' in result.data) {
										const d = result.data as {
											logId: number;
											activityName: string;
											totalPoints: number;
											streakDays: number;
											streakBonus: number;
											masteryBonus?: number;
											masteryLevel?: number;
											masteryLeveledUp?: { oldLevel: number; newLevel: number; isMilestone: boolean } | null;
											cancelableUntil: string;
											unlockedAchievements: { name: string; icon: string; bonusPoints: number; rarity: string }[];
											comboBonus: {
												categoryCombo: { categoryId: number; name: string; bonus: number }[];
												crossCategoryCombo: { name: string; bonus: number } | null;
												miniCombo: { uniqueCount: number; bonus: number } | null;
												hints: { message: string }[];
												totalNewBonus: number;
											} | null;
											missionComplete: { missionCompleted: boolean; allComplete: boolean; bonusAwarded: number } | null;
											levelUp: { oldLevel: number; oldTitle: string; newLevel: number; newTitle: string; categoryId?: number; categoryName?: string; spGranted?: number } | null;
											xpGain?: { categoryId: number; categoryName: string; xpBefore: number; xpAfter: number; maxValue: number; levelBefore: number; levelAfter: number };
										};
										resultIcon = activity.icon;
										resultName = d.activityName;
										resultPoints = d.totalPoints;
										resultLogId = d.logId;
										resultComboBonus = d.comboBonus ?? null;
										resultMasteryBonus = d.masteryBonus ?? 0;
										resultMasteryLevel = d.masteryLevel ?? 1;
										resultMasteryLeveledUp = d.masteryLeveledUp ?? null;
										unlockedAchievements = d.unlockedAchievements ?? [];
										missionResult = d.missionComplete ?? null;
										levelUpData = d.levelUp ?? null;
										xpGainData = d.xpGain ?? null;
										startCancelCountdown(d.cancelableUntil);
										soundService.playRecordComplete();
										setTimeout(() => soundService.play('point-gain'), 300);
										resultOpen = true;
									} else if (result.type === 'failure' && result.data && 'error' in result.data) {
										errorMessage = String(result.data.error);
										soundService.play('error');
										setTimeout(() => { errorMessage = ''; }, 3000);
										invalidateAll();
									} else {
										invalidateAll();
									}
								};
							}}
						>
							<input type="hidden" name="activityId" value={activity.id} />
							<Button
								type="submit"
								disabled={submitting}
								variant="outline"
								size="sm"
								class="relative flex flex-col items-center justify-center gap-0.5 w-full aspect-[4/5] min-h-[60px] border-2 border-solid bg-white shadow-sm cursor-pointer duration-150 ease-out hover:shadow-md active:scale-95 {pendingActivityId === activity.id ? 'baby-card-pending' : ''} {showMission ? 'baby-card-mission' : ''}"
								data-testid="activity-card-{activity.id}"
								style="border-color: {showMission ? 'gold' : borderColor}"
								aria-label="{activity.displayName}をきろくする{showMission ? '（ミッション）' : ''}"
							>
								{#if showMission}
									<span class="absolute -top-1.5 -left-1.5 z-10 text-sm baby-card__mission-star" aria-hidden="true">⭐</span>
								{/if}
								{#if pendingActivityId === activity.id}
									<span class="baby-card__spinner" aria-hidden="true"></span>
									<span class="text-[10px] font-bold leading-tight text-center line-clamp-2">まってね！</span>
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
				{/each}
			</CategorySection>
		{/each}

	{#if data.activities.length === 0}
		<ActivityEmptyState uiMode={data.uiMode} />
	{/if}

	<!-- Family streak banner (below activities) -->
	{#if data.familyStreak && data.familyStreak.currentStreak > 0}
		<FamilyStreakBanner
			currentStreak={data.familyStreak.currentStreak}
			hasRecordedToday={data.familyStreak.hasRecordedToday}
			todayRecorders={data.familyStreak.todayRecorders}
			childId={data.child?.id ?? 0}
			siblings={data.allChildren ?? []}
			nextMilestone={data.familyStreak.nextMilestone}
			compact
		/>
	{/if}

	<!-- Season pass card -->
	{#if data.seasonPass}
		<SeasonPassCard
			eventName={data.seasonPass.event.name}
			eventId={data.seasonPass.event.id}
			bannerIcon={data.seasonPass.event.bannerIcon}
			milestones={data.seasonPass.milestones}
			currentCount={data.seasonPass.progress.count}
			maxTarget={Math.max(...data.seasonPass.milestones.map((m: { target: number }) => m.target), 1)}
			remainingDays={data.seasonPass.remainingDays}
			isPremium={data.isPremium ?? false}
		/>
	{/if}

	<!-- Sibling challenge banners -->
	{#if data.activeChallenges && data.activeChallenges.length > 0}
		<ChallengeBanner
			challenges={data.activeChallenges}
			childId={data.child?.id ?? 0}
			siblings={data.allChildren?.map((c) => ({ id: c.id, nickname: c.nickname })) ?? []}
		/>
	{/if}
</div>

<!-- Record result overlay -->
<Dialog bind:open={resultOpen} closable={false} title="">
	<div class="flex flex-col items-center gap-4 text-center py-4">
		{#if cancelledMessage}
			<span class="text-[3.5rem]">↩️</span>
			<p class="text-lg font-bold">とりけしました</p>
			<Button
				type="button"
				variant="ghost"
				size="md"
				class="w-full bg-[var(--color-neutral-200)]"
				onclick={() => {
					cancelledMessage = false;
					resultOpen = false;
					invalidateAll();
				}}
			>
				とじる
			</Button>
		{:else}
			<div class="relative w-24 h-24 flex items-center justify-center">
				<CelebrationEffect type={celebEffect} />
			</div>
			<p class="text-lg font-bold">{resultName}をきろくしたよ！</p>
			<div class="animate-point-pop">
				<p class="text-2xl font-bold text-[var(--color-point)]">{fmtPts(resultPoints)}</p>
			</div>
			{#if resultComboBonus}
				<div class="bg-[var(--color-gold-100)] rounded-xl px-3 py-2 w-full">
					{#each resultComboBonus.categoryCombo as cc}
						<p class="text-sm font-bold text-[var(--theme-accent)]">{cc.name}コンボ！ {fmtPts(cc.bonus)}</p>
					{/each}
					{#if resultComboBonus.crossCategoryCombo}
						<p class="text-sm font-bold text-[var(--color-point)]">{resultComboBonus.crossCategoryCombo.name}！ {fmtPts(resultComboBonus.crossCategoryCombo.bonus)}</p>
					{/if}
				</div>
			{/if}
			{#if resultMasteryLeveledUp}
				<div class="bg-purple-50 rounded-[var(--radius-md)] px-3 py-2 w-full">
					<p class="text-sm font-bold text-purple-700">
						🎖️ {resultName}が Lv.{resultMasteryLeveledUp.newLevel} になった！
					</p>
				</div>
			{/if}
			{#if missionResult}
				<div class="bg-[var(--color-gold-100)] rounded-xl px-3 py-2 w-full">
					<p class="text-sm font-bold text-[var(--color-warning)]">
						🎯 ミッションたっせい！
						{#if missionResult.bonusAwarded > 0}
							{fmtPts(missionResult.bonusAwarded)}
						{/if}
					</p>
					{#if missionResult.allComplete}
						<p class="text-xs font-bold text-[var(--color-gold-700)]">🎉 ぜんぶクリア！</p>
					{/if}
				</div>
			{/if}

			{#if xpGainData}
				{@const catDef = getCategoryById(xpGainData.categoryId)}
				<div class="mt-1 text-center text-xs text-[var(--color-text-muted)] border-t border-gray-100 pt-2 w-full">
					<span style:color={catDef?.color ?? 'inherit'}>{xpGainData.categoryName}</span>
					けいけんち
					<span class="font-bold text-[var(--color-text)]">+0.3</span>
					{#if xpGainData.levelAfter > xpGainData.levelBefore}
						<span class="font-bold text-amber-600"> → Lv.{xpGainData.levelAfter} ↑</span>
					{/if}
				</div>
			{/if}

			<div class="flex gap-2 w-full">
				{#if cancelCountdown > 0}
					<form
						method="POST"
						action="?/cancelRecord"
						class="flex-1"
						use:enhance={() => {
							return async ({ result }) => {
								if (result.type === 'success' && result.data && 'cancelled' in result.data) {
									if (cancelTimerId) clearInterval(cancelTimerId);
									cancelTimerId = null;
									cancelledMessage = true;
								}
							};
						}}
					>
						<input type="hidden" name="logId" value={resultLogId} />
						<Button
							type="submit"
							variant="ghost"
							size="sm"
							data-testid="activity-cancel-btn"
							class="w-full bg-[var(--color-neutral-200)] text-[var(--color-text-muted)]"
						>
							とりけし ({cancelCountdown}s)
						</Button>
					</form>
				{/if}
				<Button
					type="button"
					variant="primary"
					size="md"
					class="flex-1 w-full"
					data-testid="activity-confirm-btn"
					onclick={handleResultClose}
				>
					やったね！
				</Button>
			</div>
		{/if}
	</div>
</Dialog>

<OverlaysSection
	bind:levelUpOpen
	{levelUpData}
	onLevelUpClose={handleLevelUpClose}
	bind:achievementOpen
	{unlockedAchievements}
	onAchievementClose={handleAchievementClose}
	bind:rewardOpen
	latestReward={data.latestReward}
	onRewardClose={handleRewardClose}
	bind:stampPressOpen
	{stampPressData}
	onStampPressClose={handleStampPressClose}
	bind:birthdayModalOpen
	birthdayBonus={data.birthdayBonus}
	nickname={data.child?.nickname ?? ''}
	uiMode={data.uiMode}
/>

<!-- Monthly premium reward modal -->
{#if data.monthlyPremiumReward && !data.monthlyPremiumReward.claimed}
	<MonthlyRewardModal
		eventId={data.monthlyPremiumReward.event.id}
		rewardName={data.monthlyPremiumReward.config.name}
		rewardIcon={data.monthlyPremiumReward.config.icon}
		rewardDescription={data.monthlyPremiumReward.config.description}
		claimed={data.monthlyPremiumReward.claimed}
	/>
{/if}

<style>
	/* Animations only — all layout/color via Tailwind utilities */
	/* :global() needed because these classes are applied to Button component's inner <button> */
	:global(.baby-card-mission) {
		box-shadow: 0 0 12px rgba(255, 200, 0, 0.5);
		animation: pulse-gold 2s ease-in-out infinite;
	}
	@keyframes pulse-gold {
		0%, 100% { box-shadow: 0 0 8px rgba(255, 200, 0, 0.4); }
		50% { box-shadow: 0 0 20px rgba(255, 200, 0, 0.8); }
	}
	.baby-card__mission-star {
		animation: star-twinkle 1.5s ease-in-out infinite;
	}
	@keyframes star-twinkle {
		0%, 100% { opacity: 0.7; transform: scale(1); }
		50% { opacity: 1; transform: scale(1.2); }
	}
	/* :global() needed because this class is applied to Button component's inner <button> */
	:global(.baby-card-pending) {
		animation: card-pulse 0.8s ease-in-out infinite;
		opacity: 0.7;
	}
	@keyframes card-pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(0.97); }
	}
	.baby-card__spinner {
		display: inline-block;
		width: 2rem;
		height: 2rem;
		border: 3px solid var(--theme-primary, #6366f1);
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
