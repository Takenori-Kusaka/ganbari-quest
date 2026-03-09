<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { tick } from 'svelte';
import { CATEGORIES } from '$lib/domain/validation/activity';
import AchievementUnlockOverlay from '$lib/ui/components/AchievementUnlockOverlay.svelte';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import LevelUpOverlay from '$lib/ui/components/LevelUpOverlay.svelte';
import BirthdayReviewOverlay from '$lib/ui/components/BirthdayReviewOverlay.svelte';
import BirthdayResultOverlay from '$lib/ui/components/BirthdayResultOverlay.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import OmikujiOverlay from '$lib/ui/components/OmikujiOverlay.svelte';
import SpecialRewardOverlay from '$lib/ui/components/SpecialRewardOverlay.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

// Confirm dialog state
let confirmOpen = $state(false);
let selectedActivity = $state<{ id: number; name: string; icon: string } | null>(null);

// Record result overlay
let resultOpen = $state(false);
let resultData = $state<{
	logId: number;
	activityName: string;
	totalPoints: number;
	streakDays: number;
	streakBonus: number;
	cancelableUntil: string;
	comboBonus: {
		categoryCombo: { category: string; name: string; bonus: number }[];
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
	{ name: string; icon: string; bonusPoints: number; rarity: string }[]
>([]);

// Special reward overlay
let rewardOpen = $state(false);

// Login bonus state
let omikujiOpen = $state(false);
let bonusData = $state<{
	rank: string;
	basePoints: number;
	multiplier: number;
	totalPoints: number;
	consecutiveDays: number;
} | null>(null);
let bonusClaiming = $state(false);

// Birthday review state
let birthdayOpen = $state(false);
let birthdayResultOpen = $state(false);
let birthdayResult = $state<{
	basePoints: number;
	healthPoints: number;
	aspirationPoints: number;
	totalPoints: number;
} | null>(null);
let birthdaySubmitting = $state(false);

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
} | null>(null);

// Build recorded counts map: activityId → count
const recordedMap = $derived(
	new Map(data.todayRecorded.map((r) => [r.activityId, r.count])),
);

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
	CATEGORIES.map((cat) => ({
		category: cat,
		items: data.activities.filter((a) => a.category === cat),
	})).filter((g) => g.items.length > 0),
);

function handleActivityTap(activity: { id: number; name: string; icon: string }) {
	soundService.play('tap');
	selectedActivity = activity;
	confirmOpen = true;
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

	// レベルアップがあれば先に表示
	if (levelUpData) {
		levelUpOpen = true;
	} else if (unlockedAchievements.length > 0) {
		achievementOpen = true;
	} else {
		resultData = null;
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
		resultData = null;
		invalidateAll();
	}
}

function handleAchievementClose() {
	achievementOpen = false;
	unlockedAchievements = [];
	resultData = null;
	invalidateAll();
}

function handleOmikujiClose() {
	omikujiOpen = false;
	// おみくじ後に特別報酬チェック
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
	if (data.latestReward && !bonusClaiming && !omikujiOpen) {
		checkSpecialReward();
	}
});

// Auto-show birthday review if it's birthday and not yet reviewed
$effect(() => {
	if (
		data.birthdayStatus &&
		data.birthdayStatus.isBirthday &&
		!data.birthdayStatus.alreadyReviewed &&
		!bonusClaiming &&
		!omikujiOpen &&
		!birthdayOpen &&
		!birthdayResultOpen
	) {
		birthdayOpen = true;
	}
});

let birthdayFormData = $state<{ healthChecks: string; aspirationText: string } | null>(null);

function handleBirthdaySubmit(submitData: { healthChecks: Record<string, boolean>; aspirationText: string }) {
	birthdayFormData = {
		healthChecks: JSON.stringify(submitData.healthChecks),
		aspirationText: submitData.aspirationText,
	};
	birthdaySubmitting = true;
	tick().then(() => {
		document.getElementById('birthday-submit-btn')?.click();
	});
}

function handleBirthdayResultClose() {
	birthdayResultOpen = false;
	birthdayResult = null;
	invalidateAll();
}
</script>

<svelte:head>
	<title>ホーム - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-sm)] py-1">
	<!-- Error toast -->
	{#if errorMessage}
		<div class="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-bold animate-bounce-in">
			{errorMessage}
		</div>
	{/if}

	<!-- Login bonus auto-claim form (hidden) -->
	{#if bonusClaiming && !omikujiOpen}
		<form
			method="POST"
			action="?/claimBonus"
			use:enhance={() => {
				return async ({ result }) => {
					if (result.type === 'success' && result.data && 'bonusClaimed' in result.data) {
						const d = result.data as { rank: string; basePoints: number; multiplier: number; totalPoints: number; consecutiveLoginDays: number };
						bonusData = {
							rank: d.rank,
							basePoints: d.basePoints,
							multiplier: d.multiplier,
							totalPoints: d.totalPoints,
							consecutiveDays: d.consecutiveLoginDays,
						};
						omikujiOpen = true;
					}
					bonusClaiming = false;
				};
			}}
			class="hidden"
		>
			<button type="submit" id="claim-bonus-btn">claim</button>
		</form>
	{/if}

	<!-- Checklist shortcut -->
	{#if data.hasChecklists}
		<a
			href="/checklist"
			class="flex items-center justify-between w-full px-[var(--spacing-md)] py-[var(--spacing-sm)] mb-[var(--spacing-sm)] rounded-[var(--radius-lg)] bg-white shadow-sm border border-[var(--color-border)] tap-target"
		>
			<div class="flex items-center gap-[var(--spacing-sm)]">
				<span class="text-2xl">📋</span>
				<span class="font-bold">もちものチェック</span>
			</div>
			{#if data.checklistProgress}
				<div class="flex items-center gap-[var(--spacing-xs)]">
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

	<!-- Daily missions -->
	{#if data.dailyMissions && data.dailyMissions.missions.length > 0}
		<div class="mb-[var(--spacing-sm)] rounded-[var(--radius-lg)] bg-white shadow-sm border border-[var(--color-border)] overflow-hidden">
			<div class="flex items-center gap-[var(--spacing-xs)] px-[var(--spacing-md)] pt-[var(--spacing-sm)] pb-1">
				<span class="text-lg">🎯</span>
				<span class="font-bold text-sm">きょうのミッション</span>
				<span class="text-xs text-[var(--color-text-muted)] ml-auto">
					{data.dailyMissions.completedCount}/{data.dailyMissions.missions.length}
				</span>
			</div>
			<div class="px-[var(--spacing-md)] pb-[var(--spacing-sm)]">
				{#each data.dailyMissions.missions as mission (mission.id)}
					<div class="flex items-center gap-[var(--spacing-sm)] py-1">
						<span class="text-lg w-6 text-center">{mission.completed ? '✅' : '⬜'}</span>
						<span class="text-lg">{mission.activityIcon}</span>
						<span class="text-sm {mission.completed ? 'line-through text-[var(--color-text-muted)]' : 'font-bold'}">
							{mission.activityName}
						</span>
					</div>
				{/each}
				{#if data.dailyMissions.allComplete}
					<div class="text-center mt-1 py-1 rounded-[var(--radius-md)] bg-[var(--theme-bg)]">
						<span class="text-sm font-bold text-[var(--theme-accent)]">🎉 ミッションコンプリート！ +{data.dailyMissions.bonusAwarded}P</span>
					</div>
				{:else if data.dailyMissions.bonusAwarded > 0}
					<div class="text-center mt-1 py-1 rounded-[var(--radius-md)] bg-[var(--theme-bg)]">
						<span class="text-xs font-bold text-[var(--color-text-muted)]">ボーナス +{data.dailyMissions.bonusAwarded}P</span>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Activity grid by category -->
	{#each activitiesByCategory as group (group.category)}
		<CategorySection category={group.category}>
			{#each group.items as activity (activity.id)}
				<ActivityCard
					icon={activity.icon}
					name={activity.name}
					category={activity.category}
					completed={isCompleted(activity)}
					count={getCount(activity.id)}
					onclick={() => handleActivityTap(activity)}
				/>
			{/each}
		</CategorySection>
	{/each}

	{#if data.activities.length === 0}
		<div class="flex flex-col items-center justify-center py-[var(--spacing-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--spacing-md)]">📋</span>
			<p class="text-lg font-bold">かつどうがまだないよ</p>
			<p class="text-sm">おやにおねがいしてね</p>
		</div>
	{/if}
</div>

<!-- Confirm dialog -->
<Dialog bind:open={confirmOpen} closable={false} title="">
	{#if selectedActivity}
		<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center">
			<CompoundIcon icon={selectedActivity.icon} size="xl" />
			<p class="text-lg font-bold">{selectedActivity.name}を<br />きろくする？</p>
			<div class="flex gap-[var(--spacing-sm)] w-full">
				<button
					class="tap-target flex-1 py-4 rounded-[var(--radius-md)] bg-gray-200 font-bold text-lg"
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
									cancelableUntil: string;
									unlockedAchievements: { name: string; icon: string; bonusPoints: number; rarity: string }[];
									comboBonus: {
										categoryCombo: { category: string; name: string; bonus: number }[];
										crossCategoryCombo: { name: string; bonus: number } | null;
										miniCombo: { uniqueCount: number; bonus: number } | null;
										hints: { message: string }[];
										totalNewBonus: number;
									} | null;
									missionComplete: { missionCompleted: boolean; allComplete: boolean; bonusAwarded: number } | null;
									levelUp: { oldLevel: number; oldTitle: string; newLevel: number; newTitle: string } | null;
								};
								resultData = {
									logId: d.logId,
									activityName: d.activityName,
									totalPoints: d.totalPoints,
									streakDays: d.streakDays,
									streakBonus: d.streakBonus,
									cancelableUntil: d.cancelableUntil,
									comboBonus: d.comboBonus ?? null,
								};
								unlockedAchievements = d.unlockedAchievements ?? [];
								missionResult = d.missionComplete ?? null;
								levelUpData = d.levelUp ?? null;
								startCancelCountdown(d.cancelableUntil);
								soundService.play('record-complete');
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
						class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold text-lg"
					>
						きろく！
					</button>
				</form>
			</div>
		</div>
	{/if}
</Dialog>

<!-- Record result overlay -->
<Dialog bind:open={resultOpen} closable={false} title="">
	{#if resultData}
		<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center py-[var(--spacing-md)]">
			{#if cancelledMessage}
				<span class="text-5xl">↩️</span>
				<p class="text-lg font-bold">とりけしました</p>
				<button
					class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-gray-200 font-bold text-lg mt-[var(--spacing-sm)]"
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
				<span class="text-5xl animate-bounce-in">✅</span>
				<p class="text-lg font-bold">{resultData.activityName}をきろくしたよ！</p>
				<div class="animate-point-pop">
					<p class="text-2xl font-bold text-[var(--color-point)]">+{resultData.totalPoints} ポイント！</p>
				</div>
				{#if resultData.streakDays >= 2}
					<p class="text-sm text-[var(--theme-accent)]">
						{resultData.streakDays}にちれんぞく！ +{resultData.streakBonus}ボーナス
					</p>
				{/if}
				{#if resultData.comboBonus}
					<div class="bg-[var(--theme-bg)] rounded-[var(--radius-md)] px-3 py-2 w-full">
						{#each resultData.comboBonus.categoryCombo as cc}
							<p class="text-sm font-bold text-[var(--theme-accent)]">
								{cc.name}コンボ！（{cc.category}） +{cc.bonus}P
							</p>
						{/each}
						{#if resultData.comboBonus.crossCategoryCombo}
							<p class="text-sm font-bold text-[var(--color-point)]">
								{resultData.comboBonus.crossCategoryCombo.name}！ +{resultData.comboBonus.crossCategoryCombo.bonus}P
							</p>
						{/if}
					</div>
				{/if}
				{#if missionResult}
					<div class="bg-amber-50 rounded-[var(--radius-md)] px-3 py-2 w-full">
						<p class="text-sm font-bold text-amber-600">
							🎯 ミッションたっせい！
							{#if missionResult.bonusAwarded > 0}
								+{missionResult.bonusAwarded}P
							{/if}
						</p>
						{#if missionResult.allComplete}
							<p class="text-xs font-bold text-amber-500">🎉 ぜんぶクリア！</p>
						{/if}
					</div>
				{/if}

				<div class="flex gap-[var(--spacing-sm)] w-full mt-[var(--spacing-sm)]">
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

<!-- Omikuji overlay -->
{#if bonusData}
	<OmikujiOverlay
		bind:open={omikujiOpen}
		rank={bonusData.rank}
		basePoints={bonusData.basePoints}
		multiplier={bonusData.multiplier}
		totalPoints={bonusData.totalPoints}
		consecutiveDays={bonusData.consecutiveDays}
		onClose={handleOmikujiClose}
	/>
{/if}

<!-- Birthday review hidden form -->
{#if birthdaySubmitting && birthdayFormData}
	<form
		method="POST"
		action="?/submitBirthday"
		use:enhance={() => {
			return async ({ result }) => {
				birthdaySubmitting = false;
				if (result.type === 'success' && result.data && 'birthdayReview' in result.data) {
					const d = result.data as { basePoints: number; healthPoints: number; aspirationPoints: number; totalPoints: number };
					birthdayOpen = false;
					birthdayResult = {
						basePoints: d.basePoints,
						healthPoints: d.healthPoints,
						aspirationPoints: d.aspirationPoints,
						totalPoints: d.totalPoints,
					};
					birthdayResultOpen = true;
					soundService.play('record-complete');
				} else {
					birthdayOpen = false;
					invalidateAll();
				}
			};
		}}
		class="hidden"
	>
		<input type="hidden" name="healthChecks" value={birthdayFormData.healthChecks} />
		<input type="hidden" name="aspirationText" value={birthdayFormData.aspirationText} />
		<button type="submit" id="birthday-submit-btn">submit</button>
	</form>
{/if}

<!-- Birthday review overlay -->
{#if data.birthdayStatus}
	<BirthdayReviewOverlay
		bind:open={birthdayOpen}
		childAge={data.birthdayStatus.childAge}
		healthCheckItems={data.healthCheckItems}
		onSubmit={handleBirthdaySubmit}
	/>
{/if}

<!-- Birthday result overlay -->
{#if birthdayResult}
	<BirthdayResultOverlay
		bind:open={birthdayResultOpen}
		childAge={data.birthdayStatus?.childAge ?? 0}
		basePoints={birthdayResult.basePoints}
		healthPoints={birthdayResult.healthPoints}
		aspirationPoints={birthdayResult.aspirationPoints}
		totalPoints={birthdayResult.totalPoints}
		onClose={handleBirthdayResultClose}
	/>
{/if}
