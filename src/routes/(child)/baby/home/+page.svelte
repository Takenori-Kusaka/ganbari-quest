<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import AchievementUnlockOverlay from '$lib/ui/components/AchievementUnlockOverlay.svelte';
import OmikujiOverlay from '$lib/ui/components/OmikujiOverlay.svelte';
import SpecialRewardOverlay from '$lib/ui/components/SpecialRewardOverlay.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

// Category colors for card borders
const categoryColors: Record<string, string> = {
	うんどう: 'var(--color-cat-undou)',
	べんきょう: 'var(--color-cat-benkyou)',
	せいかつ: 'var(--color-cat-seikatsu)',
	こうりゅう: 'var(--color-cat-kouryuu)',
	そうぞう: 'var(--color-cat-souzou)',
};

// Record result overlay
let resultOpen = $state(false);
let resultIcon = $state('');
let resultLogId = $state(0);
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

	if (unlockedAchievements.length > 0) {
		achievementOpen = true;
	} else {
		invalidateAll();
	}
}

function handleAchievementClose() {
	achievementOpen = false;
	unlockedAchievements = [];
	invalidateAll();
}

function handleOmikujiClose() {
	omikujiOpen = false;
	checkSpecialReward();
	invalidateAll();
}

function checkSpecialReward() {
	if (data.latestReward && data.latestReward.id !== seenRewardId) {
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
		try {
			localStorage.setItem('ganbari-last-seen-reward', String(data.latestReward.id));
		} catch {
			// localStorage unavailable
		}
	}
	rewardOpen = false;
}

// Auto-show login bonus
$effect(() => {
	if (data.loginBonusStatus && !data.loginBonusStatus.claimedToday && !bonusClaiming) {
		bonusClaiming = true;
	}
});

// Check special reward on mount
$effect(() => {
	if (data.latestReward && !bonusClaiming && !omikujiOpen) {
		checkSpecialReward();
	}
});
</script>

<svelte:head>
	<title>ホーム - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	<!-- Login bonus auto-claim (hidden) -->
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
		{(() => { if (typeof document !== 'undefined') { document.getElementById('claim-bonus-btn')?.click(); } return ''; })()}
	{/if}

	<!-- Baby activity grid: 1-tap instant record -->
	<div class="grid grid-cols-3 gap-[var(--spacing-md)] justify-items-center">
		{#each data.activities as activity (activity.id)}
			{@const completed = data.todayRecorded.includes(activity.id)}
			{@const borderColor = categoryColors[activity.category] ?? 'var(--theme-primary)'}
			{#if completed}
				<div
					class="w-[var(--age-tap-size)] h-[var(--age-tap-size)] rounded-[var(--age-border-radius)]
						bg-white shadow-sm border-3 opacity-40 flex items-center justify-center relative"
					style="border-color: {borderColor};"
				>
					<span class="text-[var(--age-icon-size)]">{activity.icon}</span>
					<span class="absolute top-1 right-1 text-lg">✅</span>
				</div>
			{:else}
				<form
					method="POST"
					action="?/record"
					use:enhance={() => {
						soundService.ensureContext();
						soundService.play('tap');
						return async ({ result }) => {
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
								resultIcon = activity.icon;
								resultLogId = d.logId;
								unlockedAchievements = d.unlockedAchievements ?? [];
								startCancelCountdown(d.cancelableUntil);
								soundService.play('record-complete');
								resultOpen = true;
							}
						};
					}}
				>
					<input type="hidden" name="activityId" value={activity.id} />
					<button
						type="submit"
						class="tap-target w-[var(--age-tap-size)] h-[var(--age-tap-size)] rounded-[var(--age-border-radius)]
							bg-white shadow-md border-3 flex items-center justify-center
							active:scale-95 transition-transform"
						style="border-color: {borderColor};"
					>
						<span class="text-[var(--age-icon-size)]">{activity.icon}</span>
					</button>
				</form>
			{/if}
		{/each}
	</div>

	{#if data.activities.length === 0}
		<div class="flex flex-col items-center justify-center py-[var(--spacing-2xl)]">
			<span class="text-6xl">📋</span>
		</div>
	{/if}
</div>

<!-- Record result overlay (baby: icon-only, big animation) -->
<Dialog bind:open={resultOpen} closable={false} title="">
	<div class="flex flex-col items-center gap-[var(--spacing-lg)] text-center py-[var(--spacing-lg)]">
		{#if cancelledMessage}
			<span class="text-6xl">↩️</span>
			<button
				class="tap-target w-full py-4 rounded-[var(--age-border-radius)] bg-gray-200 font-bold text-lg"
				onclick={() => {
					cancelledMessage = false;
					resultOpen = false;
					invalidateAll();
				}}
			>
				✕
			</button>
		{:else}
			<span class="text-7xl animate-bounce-in">{resultIcon}</span>
			<span class="text-5xl animate-point-pop">⭐</span>

			<div class="flex gap-[var(--spacing-sm)] w-full">
				<!-- Cancel (small, for parent) -->
				{#if cancelCountdown > 0}
					<form
						method="POST"
						action="?/cancelRecord"
						class="shrink-0"
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
							class="tap-target px-3 py-4 rounded-[var(--radius-md)] bg-gray-200 text-[var(--color-text-muted)] text-xs"
						>
							↩ {cancelCountdown}
						</button>
					</form>
				{/if}
				<button
					class="tap-target flex-1 py-4 rounded-[var(--age-border-radius)] bg-[var(--theme-primary)] text-white font-bold text-2xl"
					onclick={handleResultClose}
				>
					👍
				</button>
			</div>
		{/if}
	</div>
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
