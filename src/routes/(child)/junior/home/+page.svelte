<script lang="ts">
import { tick } from 'svelte';
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { parseDisplayConfig } from '$lib/domain/display-config';
import { formatPointValue, formatPointValueWithSign } from '$lib/domain/point-display';
import { CATEGORY_DEFS, getCategoryById } from '$lib/domain/validation/activity';
import BirthdayBanner from '$lib/features/birthday/BirthdayBanner.svelte';
import TutorialHintBanner from '$lib/features/child/TutorialHintBanner.svelte';
import OverlaysSection from '$lib/features/child-home/components/OverlaysSection.svelte';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import ActivityEmptyState from '$lib/ui/components/ActivityEmptyState.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import type { CelebrationType } from '$lib/ui/components/CelebrationEffect.svelte';
import CelebrationEffect from '$lib/ui/components/CelebrationEffect.svelte';
import ChallengeBanner from '$lib/ui/components/ChallengeBanner.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import FamilyStreakBanner from '$lib/ui/components/FamilyStreakBanner.svelte';
import MonthlyRewardModal from '$lib/ui/components/MonthlyRewardModal.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

const celebEffect: CelebrationType = 'default';
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

// Login stamp state (unified bonus + stamp)
let stampPressOpen = $state(false);
let stampPressData = $state<{
	stampEmoji: string;
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

// Group activities by category
const activitiesByCategory = $derived(
	CATEGORY_DEFS.map((catDef) => ({
		categoryId: catDef.id,
		items: data.activities.filter((a) => a.categoryId === catDef.id),
	})).filter((g) => g.items.length > 0),
);

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
		setTimeout(() => {
			xpAnimatingCategoryId = null;
		}, 900);
	}

	// レベルアップがあれば先に表示
	if (levelUpData) {
		levelUpOpen = true;
	} else {
		resultData = null;
		xpGainData = null;
		invalidateAll();
	}
}

function handleLevelUpClose() {
	levelUpOpen = false;
	levelUpData = null;
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
	}
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
}

// Auto-show login bonus on page load if not claimed
$effect(() => {
	if (data.loginBonusStatus && !data.loginBonusStatus.claimedToday && !bonusClaiming) {
		bonusClaiming = true;
		// Wait for DOM update then auto-submit the hidden form
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
						const cardData = d.cardData as { filledSlots: number; totalSlots: number; entries: { slot: number; emoji: string; rarity: string; omikujiRank: string | null }[] } | null;
						stampPressData = {
							stampEmoji: (d.stampEmoji as string) || '⭐',
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

	<!-- Tutorial hint banner (one-time) -->
	<TutorialHintBanner visible={showTutorialHint} onDismiss={dismissTutorialHint} />

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
						onclick={() => handleActivityTap(activity)}
						onlongpress={() => handleActivityLongPress(activity)}
					/>
					{/if}
				{/each}
			</CategorySection>
		{/each}

	<!-- 週間アクティビティサマリー（Upper固有） -->
	{#if data.weeklySummary}
		{@const ws = data.weeklySummary}
		{@const todayCount = data.todayRecorded.reduce((sum, r) => sum + r.count, 0)}
		{@const maxDayCount = Math.max(...ws.days.map((d) => d.count), 1)}
		<Card padding="md" class="mt-[var(--sp-md)]">
			{#snippet children()}
			<div class="flex items-center justify-between mb-2">
				<h3 class="text-sm font-bold text-[var(--color-text-muted)]">📊 今週のがんばり</h3>
				<span class="text-xs text-[var(--color-text-muted)]">{ws.totalCount}回 / {ws.totalPoints}P</span>
			</div>
			<!-- 7日バーチャート -->
			<div class="flex items-end gap-1 h-16 mb-2">
				{#each ws.days as day}
					{@const pct = Math.max((day.count / maxDayCount) * 100, 4)}
					{@const isToday = day.date === ws.days[ws.days.length - 1]?.date}
					<div class="flex-1 flex flex-col items-center gap-0.5">
						<span class="text-[9px] font-bold text-[var(--color-text-muted)]">{day.count || ''}</span>
						<div
							class="w-full rounded-t-sm transition-all duration-300"
							style="height: {pct}%; background: {isToday ? 'var(--theme-accent)' : 'var(--theme-secondary)'}; opacity: {day.count > 0 ? 1 : 0.3}; min-height: 2px;"
						></div>
						<span class="text-[9px] text-[var(--color-text-muted)]">
							{['日', '月', '火', '水', '木', '金', '土'][new Date(day.date).getDay()]}
						</span>
					</div>
				{/each}
			</div>
			<!-- カテゴリ別内訳 -->
			{#if Object.keys(ws.byCategory).length > 0}
				<div class="flex gap-2 flex-wrap mt-1 pt-2 border-t border-gray-100">
					{#each Object.entries(ws.byCategory) as [catId, cat]}
						{@const catDef = getCategoryById(Number(catId))}
						{#if catDef}
							<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: {catDef.color}20; color: {catDef.color};">
								{catDef.name} {cat.count}回
							</span>
						{/if}
					{/each}
				</div>
			{/if}
			{#if todayCount > 0}
				<div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
					<span class="text-xs text-[var(--color-text-muted)]">📝 今日の記録</span>
					<span class="text-sm font-bold">{todayCount}回</span>
				</div>
			{/if}
			{/snippet}
		</Card>
	{/if}

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


	<!-- Sibling challenge banners -->
	{#if data.activeChallenges && data.activeChallenges.length > 0}
		<ChallengeBanner
			challenges={data.activeChallenges}
			childId={data.child?.id ?? 0}
			siblings={data.allChildren?.map((c) => ({ id: c.id, nickname: c.nickname })) ?? []}
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
					📌 ピン留めを解除
				{:else}
					📌 ピン留めする
				{/if}
			</Button>
			<Button
				variant="ghost"
				size="sm"
				class="w-full text-gray-500"
				onclick={() => { pinMenuOpen = false; pinMenuActivity = null; }}
			>
				閉じる
			</Button>
		</div>
	{/if}
</Dialog>

<!-- Confirm dialog -->
<Dialog bind:open={confirmOpen} closable={false} title="" testid="confirm-dialog">
	{#if selectedActivity}
		<div class="flex flex-col items-center gap-[var(--sp-md)] text-center">
			<CompoundIcon icon={selectedActivity.icon} size="xl" />
			<p class="text-lg font-bold">{selectedActivity.displayName ?? selectedActivity.name}を<br />記録しますか？</p>
			<div class="flex gap-[var(--sp-sm)] w-full">
				<Button
					variant="ghost"
					size="md"
					class="flex-1 bg-gray-200"
					data-testid="confirm-cancel-btn"
					disabled={submitting}
					onclick={handleConfirmClose}
				>
					キャンセル
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
							記録中...
						{:else}
							記録する
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
				<p class="text-lg font-bold">取り消しました</p>
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
					閉じる
				</Button>
			{:else}
				<div class="relative w-24 h-24 flex items-center justify-center">
					<CelebrationEffect type={celebEffect} />
				</div>
				<p class="text-lg font-bold">{resultData.activityName}を記録しました！</p>
				<div class="animate-point-pop">
					<p class="text-2xl font-bold text-[var(--color-point)]">{fmtPts(resultData.totalPoints)}</p>
				</div>
				{#if resultData.streakDays >= 2}
					<p class="text-sm text-[var(--theme-accent)]">
						{resultData.streakDays}日連続！ +{resultData.streakBonus}ボーナス
					</p>
				{/if}
				{#if resultData.masteryBonus > 0}
					<p class="text-sm text-purple-600">
						📗 習熟ボーナス +{resultData.masteryBonus} (Lv.{resultData.masteryLevel})
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
							🎯 ミッション達成！
							{#if missionResult.bonusAwarded > 0}
								{fmtPts(missionResult.bonusAwarded)}
							{/if}
						</p>
						{#if missionResult.allComplete}
							<p class="text-xs font-bold text-amber-500">🎉 全クリア！</p>
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
								class="w-full bg-gray-200 text-[var(--color-text-muted)]"
							>
								取消 ({cancelCountdown}s)
							</Button>
						</form>
					{/if}
					<Button
						variant="primary"
						size="md"
						class="flex-1"
						onclick={handleResultClose}
					>
						OK
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


</style>
