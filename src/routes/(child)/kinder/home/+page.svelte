<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { CATEGORIES } from '$lib/domain/validation/activity';
import AchievementUnlockOverlay from '$lib/ui/components/AchievementUnlockOverlay.svelte';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
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
} | null>(null);

// Error state
let errorMessage = $state('');

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
let seenRewardId = $state<number | null>(null);

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

	// 実績解除があれば表示
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
	if (data.latestReward && data.latestReward.id !== seenRewardId) {
		// localStorage で表示済みチェック
		const lastSeenKey = 'ganbari-last-seen-reward';
		const lastSeen = typeof window !== 'undefined' ? localStorage.getItem(lastSeenKey) : null;
		if (lastSeen !== String(data.latestReward.id)) {
			rewardOpen = true;
		}
	}
}

function handleRewardClose() {
	if (data.latestReward) {
		seenRewardId = data.latestReward.id;
		const lastSeenKey = 'ganbari-last-seen-reward';
		try {
			localStorage.setItem(lastSeenKey, String(data.latestReward.id));
		} catch {
			// localStorage unavailable
		}
	}
	rewardOpen = false;
}

// Auto-show login bonus on page load if not claimed
$effect(() => {
	if (data.loginBonusStatus && !data.loginBonusStatus.claimedToday && !bonusClaiming) {
		bonusClaiming = true;
	}
});

// Check special reward on mount (if no bonus to show)
$effect(() => {
	if (data.latestReward && !bonusClaiming && !omikujiOpen) {
		checkSpecialReward();
	}
});
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
		<!-- Auto-submit -->
		{(() => { if (typeof document !== 'undefined') { document.getElementById('claim-bonus-btn')?.click(); } return ''; })()}
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
			<span class="text-5xl">{selectedActivity.icon}</span>
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
						soundService.ensureContext();
						return async ({ result }) => {
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
								};
								resultData = {
									logId: d.logId,
									activityName: d.activityName,
									totalPoints: d.totalPoints,
									streakDays: d.streakDays,
									streakBonus: d.streakBonus,
									cancelableUntil: d.cancelableUntil,
								};
								unlockedAchievements = d.unlockedAchievements ?? [];
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
