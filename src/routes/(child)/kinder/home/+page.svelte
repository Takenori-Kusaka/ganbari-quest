<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { parseDisplayConfig } from '$lib/domain/display-config';
import { formatPointValue, formatPointValueWithSign } from '$lib/domain/point-display';
import { CATEGORY_DEFS, getCategoryById } from '$lib/domain/validation/activity';
import BirthdayBanner from '$lib/features/birthday/BirthdayBanner.svelte';
import BirthdayModal from '$lib/features/birthday/BirthdayModal.svelte';
import AchievementUnlockOverlay from '$lib/ui/components/AchievementUnlockOverlay.svelte';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import ActivityEmptyState from '$lib/ui/components/ActivityEmptyState.svelte';
import AdventureStartOverlay from '$lib/ui/components/AdventureStartOverlay.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import CelebrationEffect from '$lib/ui/components/CelebrationEffect.svelte';
import type { CelebrationType } from '$lib/ui/components/CelebrationEffect.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import FocusMode from '$lib/ui/components/FocusMode.svelte';
import LevelUpOverlay from '$lib/ui/components/LevelUpOverlay.svelte';
import OmikujiStampOverlay from '$lib/ui/components/OmikujiStampOverlay.svelte';
import ParentMessageOverlay from '$lib/ui/components/ParentMessageOverlay.svelte';
import SpecialRewardOverlay from '$lib/ui/components/SpecialRewardOverlay.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';
import { tick } from 'svelte';

let { data } = $props();

// First record special celebration (must be before celebEffect)
let isFirstRecord = $state(false);

const celebEffect = $derived(
	isFirstRecord ? ('legend' as CelebrationType) : ('default' as CelebrationType),
);
const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

const displayConfig = $derived(parseDisplayConfig(data.child?.displayConfig, data.child?.age ?? 4));

// Birthday bonus state
let birthdayModalOpen = $state(false);

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

// Achievement unlock overlay
let achievementOpen = $state(false);
let unlockedAchievements = $state<
	{ code?: string; name: string; icon: string; bonusPoints: number; rarity: string }[]
>([]);

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

function getCount(activityId: number): number {
	return recordedMap.get(activityId) ?? 0;
}

function isCompleted(activity: { id: number; dailyLimit: number | null }): boolean {
	const limit = activity.dailyLimit ?? 1;
	if (limit === 0) return false; // unlimited
	return getCount(activity.id) >= limit;
}

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
	} else if (unlockedAchievements.length > 0) {
		achievementOpen = true;
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

	// 次に実績解除があれば表示
	if (unlockedAchievements.length > 0) {
		achievementOpen = true;
	} else {
		isFirstRecord = false;
		resultData = null;
		xpGainData = null;
		invalidateAll();
	}
}

function handleAchievementClose() {
	achievementOpen = false;
	unlockedAchievements = [];
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
			<button type="submit" id="claim-bonus-btn">claim</button>
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
			</div>
			{#if questProgress.completed >= questProgress.total}
				<span class="text-sm font-bold text-orange-600">コンプリート！</span>
			{:else}
				<span class="text-xs text-orange-500">あと{questProgress.total - questProgress.completed}つ！</span>
			{/if}
		</div>
	{/if}

	<!-- Focus Mode: recommended activities as compact section (#0264, #0283) -->
	{#if data.focusMode && recommendedActivities.length > 0}
		<FocusMode
			{recommendedActivities}
			allCompleted={focusAllCompleted}
			completedCount={focusCompletedCount}
			totalCount={recommendedActivities.length}
		>
			{#snippet activitySlot(activity)}
				<ActivityCard
					activityId={activity.id}
					icon={activity.icon}
					name={activity.displayName ?? activity.name}
					categoryId={activity.categoryId}
					cardSize="small"
					completed={isCompleted(activity)}
					count={getCount(activity.id)}
					isMission={false}
					isPinned={false}
					onclick={() => handleActivityTap(activity)}
					onlongpress={() => handleActivityLongPress(activity)}
				/>
			{/snippet}
		</FocusMode>
	{/if}

	<!-- Activity grid by category (always visible) -->
	{#each activitiesByCategory as group (group.categoryId)}
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
					triggerHint={activity.triggerHint}
					onclick={() => handleActivityTap(activity)}
					onlongpress={() => handleActivityLongPress(activity)}
				/>
			{/each}
		</CategorySection>
	{/each}

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
</div>

<!-- Pin context menu -->
<Dialog bind:open={pinMenuOpen} closable={true} title="">
	{#if pinMenuActivity}
		<div class="flex flex-col items-center gap-3 text-center py-2">
			<p class="text-base font-bold">{pinMenuActivity.name}</p>
			<button
				class="tap-target w-full py-3 rounded-[var(--radius-md)] font-bold text-lg
					{pinMenuActivity.isPinned ? 'bg-gray-200 text-gray-700' : 'bg-amber-100 text-amber-700'}"
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
			</button>
			<button
				class="tap-target w-full py-2 text-sm text-gray-500"
				onclick={() => { pinMenuOpen = false; pinMenuActivity = null; }}
			>
				とじる
			</button>
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
				<button
					class="tap-target flex-1 py-4 rounded-[var(--radius-md)] bg-gray-200 font-bold text-lg"
					data-testid="confirm-cancel-btn"
					disabled={submitting}
					onclick={handleConfirmClose}
				>
					やめる
				</button>
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
									unlockedAchievements: { code?: string; name: string; icon: string; bonusPoints: number; rarity: string }[];
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
								unlockedAchievements = d.unlockedAchievements ?? [];
								isFirstRecord = unlockedAchievements.some((a) => a.code === 'first_step');
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
					<button
						type="submit"
						disabled={submitting}
						data-testid="confirm-record-btn"
						class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold text-lg"
						class:activity-btn--pending={submitting}
					>
						{#if submitting}
							<span class="pending-dot" aria-hidden="true"></span>
							まってね！
						{:else}
							きろく！
						{/if}
					</button>
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
				<button
					class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-gray-200 font-bold text-lg mt-[var(--sp-sm)]"
					onclick={() => {
						cancelledMessage = false;
						resultOpen = false;
						resultData = null;
						invalidateAll();
					}}
				>
					とじる
				</button>
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
						<span style="color: {catDef?.color ?? 'inherit'};">{xpGainData.categoryName}</span>
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
							<button
								type="submit"
								class="tap-target w-full py-3 rounded-[var(--radius-md)] bg-gray-200 text-[var(--color-text-muted)] font-bold text-sm"
							>
								とりけし ({cancelCountdown}s)
							</button>
						</form>
					{/if}
					<button
						class="tap-target flex-1 py-4 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold text-lg"
						onclick={handleResultClose}
					>
						やったね！
					</button>
				</div>
			{/if}
		</div>
	{/if}
</Dialog>

<!-- Level up overlay -->
{#if levelUpData}
	<LevelUpOverlay
		bind:open={levelUpOpen}
		levelUp={levelUpData}
		onClose={handleLevelUpClose}
	/>
{/if}

<!-- Achievement unlock overlay -->
{#if unlockedAchievements.length > 0}
	<AchievementUnlockOverlay
		bind:open={achievementOpen}
		achievements={unlockedAchievements}
		onClose={handleAchievementClose}
	/>
{/if}

<!-- Adventure start overlay (first-time users) -->
{#if data.isFirstTime}
	<AdventureStartOverlay
		bind:open={adventureOpen}
		childName={data.child?.nickname ?? ''}
		onClose={handleAdventureClose}
	/>
{/if}

<!-- Special reward overlay -->
{#if data.latestReward}
	<SpecialRewardOverlay
		bind:open={rewardOpen}
		title={data.latestReward.title}
		points={data.latestReward.points}
		icon={data.latestReward.icon}
		onClose={handleRewardClose}
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

<!-- Omikuji + Stamp overlay (unified) -->
{#if stampPressData}
	<OmikujiStampOverlay
		bind:open={stampPressOpen}
		rank={stampPressData.omikujiRank}
		totalPoints={stampPressData.totalPoints}
		multiplier={stampPressData.multiplier}
		consecutiveDays={stampPressData.consecutiveDays}
		onClose={handleStampPressClose}
	/>
{/if}

<!-- Birthday bonus modal -->
{#if data.birthdayBonus}
	<BirthdayModal
		bind:open={birthdayModalOpen}
		nickname={data.child?.nickname ?? ''}
		newAge={data.birthdayBonus.newAge ?? 0}
		totalPoints={data.birthdayBonus.totalPoints ?? 0}
		uiMode={data.uiMode}
	/>
{/if}

<style>
	.activity-btn--pending {
		animation: btn-pulse 0.8s ease-in-out infinite;
	}

	@keyframes btn-pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(0.97); }
	}

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

</style>
