<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { parseDisplayConfig } from '$lib/domain/display-config';
import { formatPointValueWithSign } from '$lib/domain/point-display';
import { CATEGORY_DEFS, getCategoryById } from '$lib/domain/validation/activity';
import AchievementUnlockOverlay from '$lib/ui/components/AchievementUnlockOverlay.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import CelebrationEffect from '$lib/ui/components/CelebrationEffect.svelte';
import type { CelebrationType } from '$lib/ui/components/CelebrationEffect.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import LevelUpOverlay from '$lib/ui/components/LevelUpOverlay.svelte';
import SpecialRewardOverlay from '$lib/ui/components/SpecialRewardOverlay.svelte';
import StampPressOverlay from '$lib/ui/components/StampPressOverlay.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';
import { tick } from 'svelte';

let { data } = $props();

const celebEffect: CelebrationType = 'default';
const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

const displayConfig = $derived(parseDisplayConfig(data.child?.displayConfig, data.child?.age ?? 1));

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
	stampEmoji: string;
	stampRarity: string;
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

<div class="baby-page">
	<!-- Error toast -->
	{#if errorMessage}
		<div class="baby-error-toast animate-bounce-in">
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
						const d = result.data as { stampEmoji: string; stampRarity: string; totalPoints: number; multiplier: number; consecutiveLoginDays: number };
						stampPressData = {
							stampEmoji: d.stampEmoji,
							stampRarity: d.stampRarity,
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

	<!-- Activity grid by category (same layout as kinder, but 1-tap instant record) -->
	{#each activitiesByCategory as group (group.categoryId)}
		<CategorySection
			categoryId={group.categoryId}
			cardSize={displayConfig.cardSize}
			itemsPerCategory={displayConfig.itemsPerCategory}
			collapsible={displayConfig.collapsible}
			itemCount={group.items.length}
			xpInfo={getCategoryXpWithAnim(group.categoryId)}
			xpAnimating={xpAnimatingCategoryId === group.categoryId}
		>
			{#each group.items as activity (activity.id)}
				{@const completed = isCompleted(activity)}
				{@const borderColor = getCategoryById(activity.categoryId)?.color ?? 'var(--theme-primary)'}
				{@const actCount = getCount(activity.id)}
				{@const showMission = activity.isMission && !completed}
				{#if completed}
					<div
						class="baby-card baby-card--done tap-target"
						data-testid="activity-card-{activity.id}"
						aria-label="{activity.displayName}（きろくずみ）"
					>
						<span class="baby-card__done-badge animate-bounce-in">💮</span>
						<CompoundIcon icon={activity.icon} size="lg" faded={true} />
						<span class="baby-card__name baby-card__name--faded">{activity.displayName}</span>
					</div>
				{:else}
					<form
						method="POST"
						action="?/record"
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
						<button
							type="submit"
							disabled={submitting}
							class="baby-card baby-card--active tap-target"
							class:baby-card--pending={pendingActivityId === activity.id}
							class:baby-card--mission={showMission}
							data-testid="activity-card-{activity.id}"
							style="border-color: {showMission ? 'gold' : borderColor};"
							aria-label="{activity.displayName}をきろくする{showMission ? '（ミッション）' : ''}"
						>
							{#if showMission}
								<span class="baby-card__mission-star" aria-hidden="true">⭐</span>
							{/if}
							{#if pendingActivityId === activity.id}
								<span class="baby-card__spinner" aria-hidden="true"></span>
								<span class="baby-card__name">まってね！</span>
							{:else}
								{#if actCount > 0}
									<span class="baby-card__count-badge">{actCount}</span>
								{/if}
								<CompoundIcon icon={activity.icon} size="lg" />
								<span class="baby-card__name">{activity.displayName}</span>
								{#if activity.triggerHint}
									<span class="text-[9px] font-bold text-orange-500 leading-tight text-center line-clamp-1 px-0.5">{activity.triggerHint}</span>
								{/if}
							{/if}
						</button>
					</form>
				{/if}
			{/each}
		</CategorySection>
	{/each}

	{#if data.activities.length === 0}
		<div class="baby-empty">
			<span class="baby-empty__icon">📋</span>
			<p class="baby-empty__text">かつどうがまだないよ</p>
			<p class="baby-empty__sub">おやにおねがいしてね</p>
		</div>
	{/if}
</div>

<!-- Record result overlay -->
<Dialog bind:open={resultOpen} closable={false} title="">
	<div class="baby-result">
		{#if cancelledMessage}
			<span class="baby-result__emoji">↩️</span>
			<p class="baby-result__text">とりけしました</p>
			<button
				type="button"
				class="tap-target baby-result__btn baby-result__btn--close"
				onclick={() => {
					cancelledMessage = false;
					resultOpen = false;
					invalidateAll();
				}}
			>
				とじる
			</button>
		{:else}
			<div class="baby-result__celebration">
				<CelebrationEffect type={celebEffect} />
			</div>
			<p class="baby-result__text">{resultName}をきろくしたよ！</p>
			<div class="animate-point-pop">
				<p class="baby-result__points">{fmtPts(resultPoints)}</p>
			</div>
			{#if resultComboBonus}
				<div class="baby-result__combo">
					{#each resultComboBonus.categoryCombo as cc}
						<p class="baby-result__combo-text">{cc.name}コンボ！ {fmtPts(cc.bonus)}</p>
					{/each}
					{#if resultComboBonus.crossCategoryCombo}
						<p class="baby-result__combo-cross">{resultComboBonus.crossCategoryCombo.name}！ {fmtPts(resultComboBonus.crossCategoryCombo.bonus)}</p>
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
				<div class="baby-result__mission">
					<p class="baby-result__mission-text">
						🎯 ミッションたっせい！
						{#if missionResult.bonusAwarded > 0}
							{fmtPts(missionResult.bonusAwarded)}
						{/if}
					</p>
					{#if missionResult.allComplete}
						<p class="baby-result__mission-complete">🎉 ぜんぶクリア！</p>
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

			<div class="baby-result__actions">
				{#if cancelCountdown > 0}
					<form
						method="POST"
						action="?/cancelRecord"
						class="baby-result__cancel-form"
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
						<button
							type="submit"
							class="tap-target baby-result__btn baby-result__btn--cancel"
						>
							とりけし ({cancelCountdown}s)
						</button>
					</form>
				{/if}
				<button
					type="button"
					class="tap-target baby-result__btn baby-result__btn--ok"
					onclick={handleResultClose}
				>
					やったね！
				</button>
			</div>
		{/if}
	</div>
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

<!-- Stamp press overlay -->
{#if stampPressData}
	<StampPressOverlay
		bind:open={stampPressOpen}
		stampEmoji={stampPressData.stampEmoji}
		stampRarity={stampPressData.stampRarity}
		totalPoints={stampPressData.totalPoints}
		multiplier={stampPressData.multiplier}
		consecutiveDays={stampPressData.consecutiveDays}
		onClose={handleStampPressClose}
	/>
{/if}

<style>
	.baby-page {
		padding: 4px 8px;
	}

	/* Activity card - matches ActivityCard component style */
	.baby-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		width: 100%;
		aspect-ratio: 4 / 5;
		min-height: 60px;
		border-radius: 16px;
		border: 2px solid;
		transition: all 0.15s ease;
	}

	.baby-card--active {
		background: white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		cursor: pointer;
	}

	.baby-card--active:hover {
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
	}

	.baby-card--active:active {
		transform: scale(0.95);
	}

	.baby-card--done {
		background: #fffbeb;
		border-color: #fbbf24;
		box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.3);
	}

	.baby-card__icon {
		font-size: 1.875rem; /* text-3xl */
		line-height: 1;
	}

	.baby-card__icon--faded {
		opacity: 0.4;
	}

	.baby-card__name {
		font-size: 10px;
		font-weight: 700;
		line-height: 1.2;
		text-align: center;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.baby-card__name--faded {
		opacity: 0.4;
	}

	.baby-card__done-badge {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.875rem;
		opacity: 0.8;
		z-index: 1;
	}

	.baby-card__count-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #3b82f6;
		color: white;
		font-size: 10px;
		font-weight: 700;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
	}

	/* Empty state */
	.baby-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 48px 0;
		color: var(--color-text-muted);
	}

	.baby-empty__icon {
		font-size: 2.5rem;
		margin-bottom: 16px;
	}

	.baby-empty__text {
		font-size: 1.125rem;
		font-weight: 700;
	}

	.baby-empty__sub {
		font-size: 0.875rem;
	}

	/* Result overlay */
	.baby-result {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		text-align: center;
		padding: 16px 0;
	}

	.baby-result__emoji {
		font-size: 3.5rem;
	}

	.baby-result__celebration {
		position: relative;
		width: 6rem;
		height: 6rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.baby-result__text {
		font-size: 1.125rem;
		font-weight: 700;
	}

	.baby-result__points {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-point);
	}

	.baby-result__actions {
		display: flex;
		gap: 8px;
		width: 100%;
	}

	.baby-result__cancel-form {
		flex: 1;
	}

	.baby-result__btn {
		width: 100%;
		padding: 14px 12px;
		border-radius: 12px;
		font-weight: 700;
		font-size: 1.125rem;
		border: none;
		cursor: pointer;
	}

	.baby-result__btn--ok {
		flex: 1;
		background: var(--theme-primary);
		color: white;
	}

	.baby-result__btn--cancel {
		background: #e5e7eb;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.baby-result__btn--close {
		background: #e5e7eb;
	}

	.baby-result__combo {
		background: #fff7ed;
		border-radius: 12px;
		padding: 8px 12px;
		width: 100%;
	}

	.baby-result__combo-text {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--theme-accent, #f59e0b);
	}

	.baby-result__combo-cross {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-point, #3b82f6);
	}

	.baby-result__combo-hint {
		font-size: 0.75rem;
		color: #9ca3af;
		margin-top: 2px;
	}


	/* Mission result in dialog */
	.baby-result__mission {
		background: #fffbeb;
		border-radius: 12px;
		padding: 8px 12px;
		width: 100%;
	}

	.baby-result__mission-text {
		font-size: 0.875rem;
		font-weight: 700;
		color: #d97706;
	}

	.baby-result__mission-complete {
		font-size: 0.75rem;
		font-weight: 700;
		color: #b45309;
	}

	/* Mission state */
	.baby-card--mission {
		box-shadow: 0 0 12px rgba(255, 200, 0, 0.5);
		animation: pulse-gold 2s ease-in-out infinite;
	}

	@keyframes pulse-gold {
		0%,
		100% {
			box-shadow: 0 0 8px rgba(255, 200, 0, 0.4);
		}
		50% {
			box-shadow: 0 0 20px rgba(255, 200, 0, 0.8);
		}
	}

	.baby-card__mission-star {
		position: absolute;
		top: -6px;
		left: -6px;
		z-index: 10;
		font-size: 0.875rem;
		animation: star-twinkle 1.5s ease-in-out infinite;
	}

	@keyframes star-twinkle {
		0%,
		100% {
			opacity: 0.7;
			transform: scale(1);
		}
		50% {
			opacity: 1;
			transform: scale(1.2);
		}
	}

	/* Pending state */
	.baby-card--pending {
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

	/* Error toast */
	.baby-error-toast {
		position: fixed;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		background: #ef4444;
		color: white;
		padding: 8px 16px;
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		font-size: 0.875rem;
		font-weight: 700;
	}
</style>
