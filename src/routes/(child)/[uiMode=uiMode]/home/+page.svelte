<script lang="ts">
import { tick } from 'svelte';
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { parseDisplayConfig } from '$lib/domain/display-config';
import { formatPointValueWithSign } from '$lib/domain/point-display';
import { CATEGORY_DEFS, getCategoryById } from '$lib/domain/validation/activity';
import type { UiMode } from '$lib/domain/validation/age-tier';
import BirthdayBanner from '$lib/features/birthday/BirthdayBanner.svelte';
import SiblingCelebration from '$lib/features/challenge/SiblingCelebration.svelte';
import TutorialHintBanner from '$lib/features/child/TutorialHintBanner.svelte';
import OverlaysSection from '$lib/features/child-home/components/OverlaysSection.svelte';
import { DialogFSM } from '$lib/features/child-home/dialog-state-machine';
import { getModeVariant } from '$lib/features/child-home/variants';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import ActivityEmptyState from '$lib/ui/components/ActivityEmptyState.svelte';
import AdventureStartOverlay from '$lib/ui/components/AdventureStartOverlay.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import type { CelebrationType } from '$lib/ui/components/CelebrationEffect.svelte';
import CelebrationEffect from '$lib/ui/components/CelebrationEffect.svelte';
import ChallengeBanner from '$lib/ui/components/ChallengeBanner.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import EventBanner from '$lib/ui/components/EventBanner.svelte';
import MonthlyRewardModal from '$lib/ui/components/MonthlyRewardModal.svelte';
import ParentMessageOverlay from '$lib/ui/components/ParentMessageOverlay.svelte';
import SiblingCheerOverlay from '$lib/ui/components/SiblingCheerOverlay.svelte';
import SiblingRanking from '$lib/ui/components/SiblingRanking.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

const variant = $derived(getModeVariant((data.uiMode ?? 'preschool') as UiMode));
const f = $derived(variant.features);

// --- Dialog FSM: single source of truth for overlay state (#671) ---
let fsm = $state(new DialogFSM());

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

// Confirm dialog state (non-baby modes) — kept separate from FSM
// because confirm/result/levelUp are a sequential user-initiated flow
let confirmOpen = $state(false);
let selectedActivity = $state<{
	id: number;
	name: string;
	displayName?: string;
	icon: string;
} | null>(null);

// Baby mode: pending activity for inline form
let pendingActivityId = $state<number | null>(null);

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

// Login stamp data (populated by form action result)
let stampPressData = $state<{
	stampRarity: string;
	stampName: string;
	stampOmikujiRank: string | null;
	instantPoints: number;
	consecutiveDays: number;
	multiplier: number;
	cardFilledSlots: number;
	cardTotalSlots: number;
	cardEntries: { slot: number; emoji: string; rarity: string; omikujiRank: string | null }[];
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

// Level up overlay state (kept separate — part of user-initiated record flow)
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
const todayTotalCount = $derived(data.todayRecorded.reduce((sum, r) => sum + r.count, 0));

function getCount(activityId: number): number {
	return recordedMap.get(activityId) ?? 0;
}

function isCompleted(activity: { id: number; dailyLimit: number | null }): boolean {
	const limit = activity.dailyLimit ?? 1;
	if (limit === 0) return false;
	return getCount(activity.id) >= limit;
}

// Event badge: show first active event's icon on activity cards
const activeEventBadge = $derived(
	f.showEvents && data.activeEvents && data.activeEvents.length > 0
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

// Per-category mission counts
function getCategoryMissionCount(categoryId: number) {
	return data.activities.filter((a) => a.categoryId === categoryId && a.isMission).length;
}
function getCategoryCompletedMissionCount(categoryId: number) {
	return data.activities.filter((a) => a.categoryId === categoryId && a.isMission && isCompleted(a))
		.length;
}

function handleActivityTap(activity: { id: number; name: string; icon: string }) {
	if (submitting || confirmOpen || resultOpen) return;
	soundService.play('tap');
	selectedActivity = activity;
	confirmOpen = true;
}

function handleActivityLongPress(activity: { id: number; name: string; isPinned?: boolean }) {
	if (!f.showPin) return;
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
	await fetch('?/togglePin', { method: 'POST', body: formData });
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
		setTimeout(() => {
			xpAnimatingCategoryId = null;
		}, 900);
	}

	// レベルアップがあれば FSM 経由で表示
	if (levelUpData) {
		fsm.transition('levelUp', levelUpData);
	} else {
		isFirstRecord = false;
		resultData = null;
		xpGainData = null;
		invalidateAll();
	}
}

function handleLevelUpClose() {
	fsm.close();
	levelUpData = null;
	isFirstRecord = false;
	resultData = null;
	xpGainData = null;
	invalidateAll();
}

function handleStampPressClose() {
	fsm.close();
	invalidateAll();
}

async function handleMessageClose() {
	if (data.latestMessage) {
		try {
			await fetch(`/api/v1/messages/${data.latestMessage.id}/shown`, { method: 'POST' });
		} catch {
			// ignore
		}
	}
	fsm.close();
	invalidateAll();
}

async function handleRewardClose() {
	if (data.latestReward) {
		try {
			await fetch(`/api/v1/special-rewards/${data.latestReward.id}/shown`, { method: 'POST' });
		} catch {
			// ignore
		}
	}
	fsm.close();
}

function handleAdventureClose() {
	fsm.close();
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

function handleBirthdayOpen() {
	fsm.transition('birthday', data.birthdayBonus);
}

// --- Page load: enqueue auto-triggered dialogs via FSM (#671) ---
$effect(() => {
	if (typeof window === 'undefined') return;

	// Build triggers from page data
	const shouldShowAdventure = f.showAdventureStart && data.isFirstTime;
	const shouldShowReward = data.latestReward && !bonusClaiming;
	const shouldShowMessage = f.showParentMessages && data.latestMessage;

	fsm.onDataLoad({
		adventure: shouldShowAdventure ? { childName: data.child?.nickname ?? '' } : undefined,
		specialReward: shouldShowReward ? data.latestReward : undefined,
		parentMessage: shouldShowMessage ? data.latestMessage : undefined,
		// birthday は自動トリガーから除外 — バナークリック(handleBirthdayOpen)でのみ開く
	});

	// If adventure is not showing and login bonus unclaimed, trigger it
	// Note: use shouldShowAdventure (not fsm.current) to avoid circular $effect dependency
	if (
		!shouldShowAdventure &&
		data.loginBonusStatus &&
		!data.loginBonusStatus.claimedToday &&
		!bonusClaiming
	) {
		triggerLoginBonus();
	}
});

/** Record result handler shared by confirm dialog and baby inline forms */
function handleRecordResult(result: { type: string; data?: Record<string, unknown> }) {
	submitting = false;
	pendingActivityId = null;
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
			missionComplete: {
				missionCompleted: boolean;
				allComplete: boolean;
				bonusAwarded: number;
			} | null;
			levelUp: {
				oldLevel: number;
				oldTitle: string;
				newLevel: number;
				newTitle: string;
				categoryId?: number;
				categoryName?: string;
				spGranted?: number;
			} | null;
			xpGain?: {
				categoryId: number;
				categoryName: string;
				xpBefore: number;
				xpAfter: number;
				maxValue: number;
				levelBefore: number;
				levelAfter: number;
			};
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
		setTimeout(() => {
			errorMessage = '';
		}, 3000);
		invalidateAll();
	} else {
		invalidateAll();
	}
	selectedActivity = null;
}
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
			onclick={handleBirthdayOpen}
		/>
	{/if}

	<!-- Error toast -->
	{#if errorMessage}
		<div class="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[var(--color-stat-red)] text-white px-4 py-2 rounded-lg shadow-lg text-sm font-bold animate-bounce-in">
			{errorMessage}
		</div>
	{/if}

	<!-- Login stamp auto-claim form (hidden) — unified bonus + stamp -->
	{#if bonusClaiming && fsm.current !== 'stampPress'}
		<form
			method="POST"
			action="?/loginStamp"
			use:enhance={() => {
				return async ({ result }) => {
					if (result.type === 'success' && result.data && 'loginStamp' in result.data) {
						const d = result.data as Record<string, unknown>;
						const cardData = d.cardData as { filledSlots: number; totalSlots: number; entries: { slot: number; emoji: string; rarity: string; omikujiRank: string | null }[] } | null;
						stampPressData = {
							stampRarity: (d.stampRarity as string) || 'N',
							stampName: (d.stampName as string) || '',
							stampOmikujiRank: (d.omikujiRank as string) ?? null,
							instantPoints: (d.instantPoints as number) || 0,
							consecutiveDays: (d.consecutiveLoginDays as number) || 0,
							multiplier: (d.multiplier as number) || 1,
							cardFilledSlots: cardData?.filledSlots ?? 0,
							cardTotalSlots: cardData?.totalSlots ?? 5,
							cardEntries: cardData?.entries ?? [],
							weeklyRedeem: d.weeklyRedeem as { points: number; filledSlots: number; totalSlots: number; completeBonus: number } | null,
						};
						fsm.transition('stampPress', stampPressData);
					}
					bonusClaiming = false;
				};
			}}
			class="hidden"
		>
			<Button type="submit" id="claim-bonus-btn" variant="ghost" size="sm">claim</Button>
		</form>
	{/if}

	<!-- Tutorial hint banner (one-time) -->
	<TutorialHintBanner visible={showTutorialHint} onDismiss={dismissTutorialHint} />

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
				{#if f.showPin && i > 0 && !activity.isPinned && group.items[i - 1]?.isPinned}
					<div class="col-span-full flex items-center gap-2 my-0.5" aria-hidden="true" data-testid="pin-separator">
						<div class="flex-1 border-t border-dashed border-[var(--color-border-strong)]"></div>
					</div>
				{/if}
				{#if f.showConfirmDialog}
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
							data-tutorial={groupIdx === 0 && i === 0 ? 'activity-card' : undefined}
							use:enhance={() => {
								if (submitting || resultOpen) return ({ update }) => update();
								submitting = true;
								pendingActivityId = activity.id;
								soundService.ensureContext();
								soundService.play('tap');
								return async ({ result }) => {
									handleRecordResult(result);
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
								aria-label="{activity.displayName}をきろくする{showMainQuest ? '（メインクエスト×2）' : ''}{showMission ? '（ミッション）' : ''}"
							>
								{#if showMission}
									<span class="absolute -top-1.5 -left-1.5 z-10 text-sm baby-card__mission-star" aria-hidden="true">⭐</span>
								{/if}
								{#if showMainQuest}
									<span class="baby-main-quest-badge" aria-hidden="true">⚔️ 2ばい!</span>
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
				{/if}
			{/each}
		</CategorySection>
	{/each}

	<!-- Sibling ranking (non-baby) -->
	{#if f.showSiblingFeatures && data.siblingRanking && data.siblingRanking.rankings.length > 1}
		<SiblingRanking
			rankings={data.siblingRanking.rankings}
			childId={data.child?.id ?? 0}
		/>
	{/if}

	{#if data.activities.length === 0}
		<ActivityEmptyState uiMode={data.uiMode} />
	{/if}

	<!-- Season event banners (non-baby) -->
	{#if f.showEvents && data.activeEvents && data.activeEvents.length > 0}
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

<!-- Pin context menu (non-baby) -->
{#if f.showPin}
<Dialog bind:open={pinMenuOpen} closable={true} title="">
	{#if pinMenuActivity}
		<div class="flex flex-col items-center gap-3 text-center py-2">
			<p class="text-base font-bold">{pinMenuActivity.name}</p>
			<Button
				variant={pinMenuActivity.isPinned ? 'ghost' : 'warning'}
				size="md"
				class="w-full {pinMenuActivity.isPinned ? 'bg-[var(--color-surface-tertiary)] text-[var(--color-text-primary)]' : 'bg-[var(--color-feedback-warning-bg-strong)] text-[var(--color-feedback-warning-text)]'}"
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
				class="w-full text-[var(--color-text-muted)]"
				onclick={() => { pinMenuOpen = false; pinMenuActivity = null; }}
			>
				とじる
			</Button>
		</div>
	{/if}
</Dialog>
{/if}

<!-- Confirm dialog (non-baby) -->
{#if f.showConfirmDialog}
<Dialog bind:open={confirmOpen} closable={false} title="" testid="confirm-dialog">
	{#if selectedActivity}
		<div class="flex flex-col items-center gap-[var(--sp-md)] text-center">
			<CompoundIcon icon={selectedActivity.icon} size="xl" />
			<p class="text-lg font-bold">{selectedActivity.displayName ?? selectedActivity.name}を<br />きろくする？</p>
			<div class="flex gap-[var(--sp-sm)] w-full">
				<Button
					variant="ghost"
					size="md"
					class="flex-1 bg-[var(--color-surface-tertiary)]"
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
							handleRecordResult(result);
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
{/if}

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
					class="w-full bg-[var(--color-surface-tertiary)] mt-[var(--sp-sm)]"
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
					<p class="text-sm text-[var(--color-stat-purple)]">
						📗 なれてきたボーナス +{resultData.masteryBonus} (Lv.{resultData.masteryLevel})
					</p>
				{/if}
				{#if resultData.masteryLeveledUp}
					<div class="bg-[var(--color-stat-purple-bg)] rounded-[var(--radius-md)] px-3 py-2 w-full">
						<p class="text-sm font-bold text-[var(--color-stat-purple)]">
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
					<div class="bg-[var(--color-feedback-warning-bg)] rounded-[var(--radius-md)] px-3 py-2 w-full">
						<p class="text-sm font-bold text-[var(--color-feedback-warning-text)]">
							🎯 ミッションたっせい！
							{#if missionResult.bonusAwarded > 0}
								{fmtPts(missionResult.bonusAwarded)}
							{/if}
						</p>
						{#if missionResult.allComplete}
							<p class="text-xs font-bold text-[var(--color-feedback-warning-text)]">🎉 ぜんぶクリア！</p>
						{/if}
					</div>
				{/if}

				{#if xpGainData}
					{@const catDef = getCategoryById(xpGainData.categoryId)}
					<div class="mt-1 text-center text-xs text-[var(--color-text-muted)] border-t border-[var(--color-border-light)] pt-2 w-full">
						<span style:color={catDef?.color ?? 'inherit'}>{xpGainData.categoryName}</span>
						けいけんち
						<span class="font-bold text-[var(--color-text)]">+0.3</span>
						{#if xpGainData.levelAfter > xpGainData.levelBefore}
							<span class="font-bold text-[var(--color-feedback-warning-text)]"> → Lv.{xpGainData.levelAfter} ↑</span>
						{/if}
					</div>
				{/if}

				<p class="text-xs text-[var(--color-text-muted)]">きょう {todayTotalCount + 1}かいめ！</p>
				{#if data.specialRewardProgress && data.specialRewardProgress.remaining > 0}
					<p class="text-xs text-[var(--color-text-muted)]">
						🎁 あと<strong class="text-[var(--color-point)]">{Math.max(data.specialRewardProgress.remaining - 1, 0)}</strong>かいで とくべつごほうび！
					</p>
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
								class="w-full bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)]"
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
	{fsm}
	{levelUpData}
	onLevelUpClose={handleLevelUpClose}
	latestReward={data.latestReward}
	onRewardClose={handleRewardClose}
	{stampPressData}
	onStampPressClose={handleStampPressClose}
	birthdayBonus={data.birthdayBonus}
	onBirthdayClose={() => fsm.close()}
	nickname={data.child?.nickname ?? ''}
	uiMode={data.uiMode}
/>

<!-- Adventure start overlay (first-time users, non-baby) -->
{#if f.showAdventureStart && data.isFirstTime && fsm.current === 'adventure'}
	<AdventureStartOverlay
		open={true}
		childName={data.child?.nickname ?? ''}
		onClose={handleAdventureClose}
	/>
{/if}

<!-- Parent message overlay (non-baby) -->
{#if f.showParentMessages && data.latestMessage && fsm.current === 'parentMessage'}
	<ParentMessageOverlay
		open={true}
		messageType={data.latestMessage.messageType}
		stampLabel={data.latestMessage.stampLabel}
		body={data.latestMessage.body}
		icon={data.latestMessage.icon}
		onClose={handleMessageClose}
	/>
{/if}

<!-- Sibling celebration (all siblings complete, non-baby) -->
{#if f.showSiblingFeatures && showCelebration && celebrationChallenge}
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

<!-- Sibling cheer overlay (non-baby) -->
{#if f.showSiblingFeatures && showCheerOverlay && data.unshownCheers && data.unshownCheers.length > 0}
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

	details[open] .ranking-arrow {
		transform: rotate(180deg);
	}

	/* Baby mode card animations */
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
	:global(.baby-card-main-quest) {
		box-shadow: 0 0 12px rgba(217, 119, 6, 0.4);
		background: linear-gradient(135deg, #fffbeb, #fef3c7) !important;
	}
	.baby-main-quest-badge {
		position: absolute;
		top: -0.375rem;
		right: -0.375rem;
		z-index: 10;
		padding: 0.125rem 0.375rem;
		border-radius: 9999px;
		background: linear-gradient(135deg, #f59e0b, #d97706);
		color: white;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1;
		white-space: nowrap;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
	}
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
