<script lang="ts">
import { tick } from 'svelte';
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { parseDisplayConfig } from '$lib/domain/display-config';
import { formatPointValue, formatPointValueWithSign } from '$lib/domain/point-display';
import { CATEGORY_DEFS, getCategoryById } from '$lib/domain/validation/activity';
import BirthdayBanner from '$lib/features/birthday/BirthdayBanner.svelte';
import SiblingCelebration from '$lib/features/challenge/SiblingCelebration.svelte';
import TutorialHintBanner from '$lib/features/child/TutorialHintBanner.svelte';
import OverlaysSection from '$lib/features/child-home/components/OverlaysSection.svelte';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import ActivityEmptyState from '$lib/ui/components/ActivityEmptyState.svelte';
import AdventureStartOverlay from '$lib/ui/components/AdventureStartOverlay.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import type { CelebrationType } from '$lib/ui/components/CelebrationEffect.svelte';
import CelebrationEffect from '$lib/ui/components/CelebrationEffect.svelte';
import ChallengeBanner from '$lib/ui/components/ChallengeBanner.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import EventBanner from '$lib/ui/components/EventBanner.svelte';
import FamilyStreakBanner from '$lib/ui/components/FamilyStreakBanner.svelte';
import FocusMode from '$lib/ui/components/FocusMode.svelte';
import MonthlyRewardModal from '$lib/ui/components/MonthlyRewardModal.svelte';
import ParentMessageOverlay from '$lib/ui/components/ParentMessageOverlay.svelte';
import SiblingCheerOverlay from '$lib/ui/components/SiblingCheerOverlay.svelte';
import SiblingRanking from '$lib/ui/components/SiblingRanking.svelte';
import SpecialRewardProgress from '$lib/ui/components/SpecialRewardProgress.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

// First record special celebration (must be before celebEffect)
let isFirstRecord = $state(false);

const celebEffect = $derived(
	isFirstRecord ? ('legend' as CelebrationType) : ('default' as CelebrationType),
);
const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

const displayConfig = $derived(parseDisplayConfig(data.child?.displayConfig, data.child?.age ?? 4));

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

// Sibling cheer overlay
let showCheerOverlay = $state(true);

// Sibling celebration (all siblings complete)
const celebrationChallenge = $derived(
	data.activeChallenges?.find(
		(c: { allCompleted: boolean; progress: { childId: number; rewardClaimed: number }[] }) =>
			c.allCompleted &&
			c.progress.some(
				(p: { childId: number; rewardClaimed: number }) =>
					p.childId === (data.child?.id ?? 0) && p.rewardClaimed === 0,
			),
	) ?? null,
);
let showCelebration = $state(true);

// Pin context menu state
let pinMenuOpen = $state(false);
let pinMenuActivity = $state<{ id: number; name: string; isPinned: boolean } | null>(null);
let pinSubmitting = $state(false);

// Confirm dialog state
let confirmOpen = $state(false);
let selectedActivity = $state<{
	id: number;
	name: string;
	displayName?: string;
	icon: string;
} | null>(null);

// Record result overlay
let resultOpen = $state(false);
let resultData = $state<{
	logId: number;
	activityName: string;
	totalPoints: number;
	streakDays: number;
	streakBonus: number;
	masteryBonus: number;
	masteryLevel: number;
	masteryLeveledUp: { oldLevel: number; newLevel: number; isMilestone: boolean } | null;
	cancelableUntil: string;
	comboBonus: {
		categoryCombo: { categoryId: number; name: string; bonus: number }[];
		crossCategoryCombo: { name: string; bonus: number } | null;
		miniCombo: { uniqueCount: number; bonus: number } | null;
		hints: { message: string }[];
		totalNewBonus: number;
	} | null;
} | null>(null);

// Error state
let errorMessage = $state('');

// Submitting state (多重送信防止)
let submitting = $state(false);

// Cancel state
let cancelCountdown = $state(0);
let cancelTimerId = $state<ReturnType<typeof setInterval> | null>(null);
let cancelledMessage = $state(false);

// Special reward overlay
let rewardOpen = $state(false);

// Parent message overlay
let messageOpen = $state(false);

// First-time adventure overlay
let adventureOpen = $state(false);
let adventureShown = $state(false);

// Login stamp state (unified bonus + stamp)
let stampPressOpen = $state(false);
let stampPressData = $state<{
	stampEmoji: string;
	stampRarity: string;
	stampName: string;
	instantPoints: number;
	consecutiveDays: number;
	multiplier: number;
	cardFilledSlots: number;
	cardTotalSlots: number;
	cardEntries: { slot: number; emoji: string; rarity: string }[];
	weeklyRedeem: {
		points: number;
		filledSlots: number;
		totalSlots: number;
		completeBonus: number;
	} | null;
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
	// アニメーション中は xpAfter の値で表示
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
const kinderTodayCount = $derived(data.todayRecorded.reduce((sum, r) => sum + r.count, 0));

function getCount(activityId: number): number {
	return recordedMap.get(activityId) ?? 0;
}

function isCompleted(activity: { id: number; dailyLimit: number | null }): boolean {
	const limit = activity.dailyLimit ?? 1;
	if (limit === 0) return false; // unlimited
	return getCount(activity.id) >= limit;
}

// Event badge: show first active event's icon on activity cards (#325)
const activeEventBadge = $derived(
	data.activeEvents && data.activeEvents.length > 0
		? (data.activeEvents[0]?.bannerIcon ?? null)
		: null,
);

// Group activities by category
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

// Quest progress summary (mission-based activities)
const questProgress = $derived.by(() => {
	const missions = data.activities.filter((a) => a.isMission);
	const completed = missions.filter((a) => isCompleted(a));
	return { total: missions.length, completed: completed.length };
});

// Per-category mission counts
function getCategoryMissionCount(categoryId: number) {
	const missions = data.activities.filter((a) => a.categoryId === categoryId && a.isMission);
	return missions.length;
}
function getCategoryCompletedMissionCount(categoryId: number) {
	const missions = data.activities.filter(
		(a) => a.categoryId === categoryId && a.isMission && isCompleted(a),
	);
	return missions.length;
}

function handleActivityTap(activity: { id: number; name: string; icon: string }) {
	if (submitting || confirmOpen || resultOpen || levelUpOpen || rewardOpen || stampPressOpen)
		return;
	soundService.play('tap');
	selectedActivity = activity;
	confirmOpen = true;
}

function handleActivityLongPress(activity: { id: number; name: string; isPinned?: boolean }) {
	soundService.play('tap');
	pinMenuActivity = { id: activity.id, name: activity.name, isPinned: !!activity.isPinned };
	pinMenuOpen = true;
}

async function handlePinToggle() {
	if (!pinMenuActivity) return;
	pinSubmitting = true;
	const formData = new FormData();
	formData.set('activityId', String(pinMenuActivity.id));
	formData.set('pinned', String(!pinMenuActivity.isPinned));
	const res = await fetch('?/togglePin', { method: 'POST', body: formData });
	pinSubmitting = false;
	pinMenuOpen = false;
	pinMenuActivity = null;
	await invalidateAll();
}

function handleConfirmClose() {
	confirmOpen = false;
	selectedActivity = null;
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
		// アニメーション完了後にクリア
		setTimeout(() => {
			xpAnimatingCategoryId = null;
		}, 900);
	}

	// レベルアップがあれば先に表示
	if (levelUpData) {
		levelUpOpen = true;
	} else {
		isFirstRecord = false;
		resultData = null;
		xpGainData = null;
		invalidateAll();
	}
}

function handleLevelUpClose() {
	levelUpOpen = false;
	levelUpData = null;
	isFirstRecord = false;
	resultData = null;
	xpGainData = null;
	invalidateAll();
}

function handleStampPressClose() {
	stampPressOpen = false;
	// スタンプ後に特別報酬チェック
	checkSpecialReward();
	invalidateAll();
}

function checkSpecialReward() {
	if (data.latestReward && !rewardOpen) {
		rewardOpen = true;
	} else {
		checkParentMessage();
	}
}

function checkParentMessage() {
	if (data.latestMessage && !messageOpen && !rewardOpen) {
		messageOpen = true;
	}
}

async function handleMessageClose() {
	if (data.latestMessage) {
		try {
			await fetch(`/api/v1/messages/${data.latestMessage.id}/shown`, { method: 'POST' });
		} catch {
			// ignore
		}
	}
	messageOpen = false;
	invalidateAll();
}

async function handleRewardClose() {
	if (data.latestReward) {
		try {
			await fetch(`/api/v1/special-rewards/${data.latestReward.id}/shown`, { method: 'POST' });
		} catch {
			// API error - ignore, server won't show it again after reload
		}
	}
	rewardOpen = false;
	checkParentMessage();
}

// Auto-show adventure overlay for first-time users (once per page load)
$effect(() => {
	if (data.isFirstTime && !adventureShown && !adventureOpen && !stampPressOpen && !bonusClaiming) {
		adventureOpen = true;
		adventureShown = true;
	}
});

function handleAdventureClose() {
	adventureOpen = false;
	// After adventure, continue with login bonus flow
	triggerLoginBonus();
}

function triggerLoginBonus() {
	if (data.loginBonusStatus && !data.loginBonusStatus.claimedToday && !bonusClaiming) {
		bonusClaiming = true;
		tick().then(() => {
			document.getElementById('claim-bonus-btn')?.click();
		});
	}
}

// Auto-show login bonus on page load if not claimed (skip if adventure is showing)
$effect(() => {
	if (
		data.loginBonusStatus &&
		!data.loginBonusStatus.claimedToday &&
		!bonusClaiming &&
		!adventureOpen
	) {
		bonusClaiming = true;
		tick().then(() => {
			document.getElementById('claim-bonus-btn')?.click();
		});
	}
});

// Check special reward on mount (if no bonus to show)
$effect(() => {
	if (data.latestReward && !bonusClaiming && !stampPressOpen) {
		checkSpecialReward();
	}
});
</script>

<svelte:head>
	<title>ホーム - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--sp-sm)] py-1">
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
		<div class="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-bold animate-bounce-in">
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
						const d = result.data as Record<string, unknown>;
						const cardData = d.cardData as { filledSlots: number; totalSlots: number; entries: { slot: number; emoji: string; rarity: string }[] } | null;
						stampPressData = {
							stampEmoji: (d.stampEmoji as string) || '⭐',
							stampRarity: (d.stampRarity as string) || 'N',
							stampName: (d.stampName as string) || '',
							instantPoints: (d.instantPoints as number) || 0,
							consecutiveDays: (d.consecutiveLoginDays as number) || 0,
							multiplier: (d.multiplier as number) || 1,
							cardFilledSlots: cardData?.filledSlots ?? 0,
							cardTotalSlots: cardData?.totalSlots ?? 7,
							cardEntries: cardData?.entries ?? [],
							weeklyRedeem: d.weeklyRedeem as { points: number; filledSlots: number; totalSlots: number; completeBonus: number } | null,
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

	<!-- Quest progress summary (first view) -->
	{#if questProgress.total > 0}
		<div class="flex items-center gap-2 px-[var(--sp-md)] py-[var(--sp-sm)] mb-[var(--sp-sm)] rounded-[var(--radius-lg)] bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200" data-testid="quest-progress">
			<span class="text-xl">⚔️</span>
			<div class="flex-1">
				<p class="text-xs font-bold text-orange-700">きょうのクエスト</p>
				<div class="flex items-center gap-1 mt-0.5">
					{#each Array(questProgress.total) as _, i}
						<span class="text-base">{i < questProgress.completed ? '⚔️' : '✨'}</span>
					{/each}
					<span class="text-xs font-bold text-orange-600 ml-1">{questProgress.completed}/{questProgress.total}</span>
				</div>
				{#if questProgress.completed === 0}
					<p class="text-[10px] text-orange-400 mt-0.5">⬇ したの カードを タップして きろくしよう！</p>
				{/if}
			</div>
			{#if questProgress.completed >= questProgress.total}
				<span class="text-sm font-bold text-orange-600">コンプリート！</span>
			{:else}
				<span class="text-xs text-orange-500">あと{questProgress.total - questProgress.completed}つ！</span>
			{/if}
		</div>
	{/if}

	<!-- Special reward progress indicator -->
	{#if data.specialRewardProgress && data.specialRewardProgress.remaining > 0}
		<SpecialRewardProgress
			remaining={data.specialRewardProgress.remaining}
			interval={data.specialRewardProgress.interval}
		/>
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
			missionCount={getCategoryMissionCount(group.categoryId)}
			completedMissionCount={getCategoryCompletedMissionCount(group.categoryId)}
		>
			{#each group.items as activity, i (activity.id)}
				{#if i > 0 && !activity.isPinned && group.items[i - 1]?.isPinned}
					<div class="col-span-full flex items-center gap-2 my-0.5" aria-hidden="true" data-testid="pin-separator">
						<div class="flex-1 border-t border-dashed border-gray-300"></div>
					</div>
				{/if}
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
					isPinned={activity.isPinned}
					frozen={!data.isPremium && activity.source === 'custom'}
					triggerHint={activity.triggerHint}
					eventBadge={activeEventBadge}
					onclick={() => handleActivityTap(activity)}
					onlongpress={() => handleActivityLongPress(activity)}
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
					isPinned={activity.isPinned}
					frozen={!data.isPremium && activity.source === 'custom'}
					triggerHint={activity.triggerHint}
					eventBadge={activeEventBadge}
					onclick={() => handleActivityTap(activity)}
					onlongpress={() => handleActivityLongPress(activity)}
				/>
				{/if}
			{/each}
		</CategorySection>
	{/each}

	<!-- Sibling ranking (1-line summary, below activities) -->
	{#if data.siblingRanking && data.siblingRanking.rankings.length > 1}
		<SiblingRanking
			rankings={data.siblingRanking.rankings}
			childId={data.child?.id ?? 0}
		/>
	{/if}

	<!-- おうえんメッセージ（Kinder固有） -->
	{#if kinderTodayCount > 0}
		<div class="mt-[var(--sp-md)] p-4 rounded-2xl bg-[var(--theme-bg)] border border-[var(--theme-secondary)] text-center">
			<div class="text-3xl mb-1">
				{#if kinderTodayCount >= 5}
					🌟
				{:else if kinderTodayCount >= 3}
					⭐
				{:else}
					😊
				{/if}
			</div>
			<p class="text-sm font-bold" style="color: var(--theme-accent);">
				{#if kinderTodayCount >= 5}
					すっごーい！ きょう {kinderTodayCount}かい がんばったね！
				{:else if kinderTodayCount >= 3}
					いいかんじ！ {kinderTodayCount}かい できたよ！
				{:else}
					がんばってるね！ {kinderTodayCount}かい きろくしたよ！
				{/if}
			</p>
			<div class="flex justify-center gap-1 mt-2">
				{#each Array(Math.min(kinderTodayCount, 10)) as _}
					<span class="text-lg">⭐</span>
				{/each}
			</div>
		</div>
	{/if}

	{#if data.activities.length === 0}
		<ActivityEmptyState uiMode={data.uiMode} />
	{/if}

	<!-- Checklist shortcut (below activities to reduce first-view clutter) -->
	{#if data.hasChecklists}
		<a
			href="/checklist"
			class="flex items-center justify-between w-full px-[var(--sp-md)] py-[var(--sp-sm)] mt-[var(--sp-sm)] rounded-[var(--radius-lg)] bg-white shadow-sm border border-[var(--color-border)] tap-target"
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
					<span class="text-[var(--color-text-muted)]">›</span>
				</div>
			{/if}
		</a>
	{/if}

	<!-- Family streak banner (below activities) -->
	{#if data.familyStreak && data.familyStreak.currentStreak > 0}
		<FamilyStreakBanner
			currentStreak={data.familyStreak.currentStreak}
			hasRecordedToday={data.familyStreak.hasRecordedToday}
			todayRecorders={data.familyStreak.todayRecorders}
			childId={data.child?.id ?? 0}
			siblings={data.allChildren?.map((c: { id: number; nickname: string }) => ({ id: c.id, nickname: c.nickname })) ?? []}
			nextMilestone={data.familyStreak.nextMilestone}
			compact
		/>
	{/if}

	<!-- Season event banners -->
	{#if data.activeEvents && data.activeEvents.length > 0}
		<EventBanner events={data.activeEvents} />
	{/if}


	<!-- Sibling challenge banners -->
	{#if data.activeChallenges && data.activeChallenges.length > 0}
		<ChallengeBanner
			challenges={data.activeChallenges}
			childId={data.child?.id ?? 0}
			siblings={data.allChildren?.map((c: { id: number; nickname: string }) => ({ id: c.id, nickname: c.nickname })) ?? []}
		/>
	{/if}

</div>

<!-- Pin context menu -->
<Dialog bind:open={pinMenuOpen} closable={true} title="">
	{#if pinMenuActivity}
		<div class="flex flex-col items-center gap-3 text-center py-2">
			<p class="text-base font-bold">{pinMenuActivity.name}</p>
			<Button
				variant={pinMenuActivity.isPinned ? 'ghost' : 'warning'}
				size="md"
				class="w-full {pinMenuActivity.isPinned ? 'bg-gray-200 text-gray-700' : 'bg-amber-100 text-amber-700'}"
				disabled={pinSubmitting}
				onclick={handlePinToggle}
			>
				{#if pinSubmitting}
					<span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
				{:else if pinMenuActivity.isPinned}
					📌 ピンどめをはずす
				{:else}
					📌 ピンどめする
				{/if}
			</Button>
			<Button
				variant="ghost"
				size="sm"
				class="w-full text-gray-500"
				onclick={() => { pinMenuOpen = false; pinMenuActivity = null; }}
			>
				とじる
			</Button>
		</div>
	{/if}
</Dialog>

<!-- Confirm dialog -->
<Dialog bind:open={confirmOpen} closable={false} title="" testid="confirm-dialog">
	{#if selectedActivity}
		<div class="flex flex-col items-center gap-[var(--sp-md)] text-center">
			<CompoundIcon icon={selectedActivity.icon} size="xl" />
			<p class="text-lg font-bold">{selectedActivity.displayName ?? selectedActivity.name}を<br />きろくする？</p>
			<div class="flex gap-[var(--sp-sm)] w-full">
				<Button
					variant="ghost"
					size="md"
					class="flex-1 bg-gray-200"
					data-testid="confirm-cancel-btn"
					disabled={submitting}
					onclick={handleConfirmClose}
				>
					やめる
				</Button>
				<form
					method="POST"
					action="?/record"
					class="flex-1"
					use:enhance={() => {
						if (submitting) return ({ update }) => update();
						submitting = true;
						soundService.ensureContext();
						soundService.play('tap');
						return async ({ result }) => {
							submitting = false;
							confirmOpen = false;
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
								resultData = {
									logId: d.logId,
									activityName: d.activityName,
									totalPoints: d.totalPoints,
									streakDays: d.streakDays,
									streakBonus: d.streakBonus,
									masteryBonus: d.masteryBonus ?? 0,
									masteryLevel: d.masteryLevel ?? 1,
									masteryLeveledUp: d.masteryLeveledUp ?? null,
									cancelableUntil: d.cancelableUntil,
									comboBonus: d.comboBonus ?? null,
								};
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
							selectedActivity = null;
						};
					}}
				>
					<input type="hidden" name="activityId" value={selectedActivity.id} />
					<Button
						type="submit"
						disabled={submitting}
						variant="primary"
						size="md"
						data-testid="confirm-record-btn"
						class="w-full {submitting ? 'animate-btn-pulse' : ''}"
					>
						{#if submitting}
							<span class="pending-dot" aria-hidden="true"></span>
							まってね！
						{:else}
							きろく！
						{/if}
					</Button>
				</form>
			</div>
		</div>
	{/if}
</Dialog>

<!-- Record result overlay -->
<Dialog bind:open={resultOpen} closable={false} title="">
	{#if resultData}
		<div class="flex flex-col items-center gap-[var(--sp-md)] text-center py-[var(--sp-md)]">
			{#if cancelledMessage}
				<span class="text-5xl">↩️</span>
				<p class="text-lg font-bold">とりけしました</p>
				<Button
					variant="ghost"
					size="md"
					class="w-full bg-gray-200 mt-[var(--sp-sm)]"
					onclick={() => {
						cancelledMessage = false;
						resultOpen = false;
						resultData = null;
						invalidateAll();
					}}
				>
					とじる
				</Button>
			{:else}
				<div class="relative w-24 h-24 flex items-center justify-center">
					<CelebrationEffect type={celebEffect} />
				</div>
				{#if isFirstRecord}
					<p class="text-lg font-bold text-[var(--theme-accent)]">🌟 はじめての いっぽ！ 🌟</p>
					<p class="text-sm font-bold">{resultData.activityName}をきろくしたよ！</p>
				{:else}
					<p class="text-lg font-bold">{resultData.activityName}をきろくしたよ！</p>
				{/if}
				<div class="animate-point-pop">
					<p class="text-2xl font-bold text-[var(--color-point)]">{fmtPts(resultData.totalPoints)}</p>
				</div>
				{#if resultData.streakDays >= 2}
					<p class="text-sm text-[var(--theme-accent)]">
						{resultData.streakDays}にちれんぞく！ +{resultData.streakBonus}ボーナス
					</p>
				{/if}
				{#if resultData.masteryBonus > 0}
					<p class="text-sm text-purple-600">
						📗 なれてきたボーナス +{resultData.masteryBonus} (Lv.{resultData.masteryLevel})
					</p>
				{/if}
				{#if resultData.masteryLeveledUp}
					<div class="bg-purple-50 rounded-[var(--radius-md)] px-3 py-2 w-full">
						<p class="text-sm font-bold text-purple-700">
							🎖️ {resultData.activityName}が Lv.{resultData.masteryLeveledUp.newLevel} になった！
						</p>
					</div>
				{/if}
				{#if resultData.comboBonus}
					<div class="bg-[var(--theme-bg)] rounded-[var(--radius-md)] px-3 py-2 w-full">
						{#each resultData.comboBonus.categoryCombo as cc}
							<p class="text-sm font-bold text-[var(--theme-accent)]">
								{cc.name}コンボ！（{getCategoryById(cc.categoryId)?.name ?? ''}） {fmtPts(cc.bonus)}
							</p>
						{/each}
						{#if resultData.comboBonus.crossCategoryCombo}
							<p class="text-sm font-bold text-[var(--color-point)]">
								{resultData.comboBonus.crossCategoryCombo.name}！ {fmtPts(resultData.comboBonus.crossCategoryCombo.bonus)}
							</p>
						{/if}
					</div>
				{/if}
				{#if missionResult}
					<div class="bg-amber-50 rounded-[var(--radius-md)] px-3 py-2 w-full">
						<p class="text-sm font-bold text-amber-600">
							🎯 ミッションたっせい！
							{#if missionResult.bonusAwarded > 0}
								{fmtPts(missionResult.bonusAwarded)}
							{/if}
						</p>
						{#if missionResult.allComplete}
							<p class="text-xs font-bold text-amber-500">🎉 ぜんぶクリア！</p>
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

				<div class="flex gap-[var(--sp-sm)] w-full mt-[var(--sp-sm)]">
					<!-- Cancel button with countdown -->
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
							<input type="hidden" name="logId" value={resultData.logId} />
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								data-testid="activity-cancel-btn"
								class="w-full bg-gray-200 text-[var(--color-text-muted)]"
							>
								とりけし ({cancelCountdown}s)
							</Button>
						</form>
					{/if}
					<Button
						variant="primary"
						size="md"
						class="flex-1"
						data-testid="activity-confirm-btn"
						onclick={handleResultClose}
					>
						やったね！
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</Dialog>

<OverlaysSection
	bind:levelUpOpen
	{levelUpData}
	onLevelUpClose={handleLevelUpClose}
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

<!-- Adventure start overlay (first-time users) -->
{#if data.isFirstTime}
	<AdventureStartOverlay
		bind:open={adventureOpen}
		childName={data.child?.nickname ?? ''}
		onClose={handleAdventureClose}
	/>
{/if}

<!-- Parent message overlay -->
{#if data.latestMessage}
	<ParentMessageOverlay
		bind:open={messageOpen}
		messageType={data.latestMessage.messageType}
		stampLabel={data.latestMessage.stampLabel}
		body={data.latestMessage.body}
		icon={data.latestMessage.icon}
		onClose={handleMessageClose}
	/>
{/if}

<!-- Sibling celebration (all siblings complete) -->
{#if showCelebration && celebrationChallenge}
	<SiblingCelebration
		challengeTitle={celebrationChallenge.title}
		challengeId={celebrationChallenge.id}
		rewardClaimed={false}
		siblings={celebrationChallenge.progress.map((p: { childId: number; completed: number }) => ({
			name: data.allChildren?.find((c: { id: number }) => c.id === p.childId)?.nickname ?? `#${p.childId}`,
			completed: p.completed === 1,
		}))}
		onDismiss={() => { showCelebration = false; }}
	/>
{/if}

<!-- Sibling cheer overlay -->
{#if showCheerOverlay && data.unshownCheers && data.unshownCheers.length > 0}
	<SiblingCheerOverlay
		cheers={data.unshownCheers}
		onDismiss={() => { showCheerOverlay = false; }}
	/>
{/if}

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
	.pending-dot {
		display: inline-block;
		width: 0.7em;
		height: 0.7em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		vertical-align: middle;
		margin-right: 4px;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	details[open] .ranking-arrow {
		transform: rotate(180deg);
	}

</style>
