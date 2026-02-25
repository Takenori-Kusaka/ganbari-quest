<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { CATEGORIES } from '$lib/domain/validation/activity';
import ActivityCard from '$lib/ui/components/ActivityCard.svelte';
import CategorySection from '$lib/ui/components/CategorySection.svelte';
import OmikujiOverlay from '$lib/ui/components/OmikujiOverlay.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

// Confirm dialog state
let confirmOpen = $state(false);
let selectedActivity = $state<{ id: number; name: string; icon: string } | null>(null);

// Record result overlay
let resultOpen = $state(false);
let resultData = $state<{
	activityName: string;
	totalPoints: number;
	streakDays: number;
	streakBonus: number;
} | null>(null);

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

// Group activities by category
const activitiesByCategory = $derived(
	CATEGORIES.map((cat) => ({
		category: cat,
		items: data.activities.filter((a) => a.category === cat),
	})).filter((g) => g.items.length > 0),
);

function handleActivityTap(activity: { id: number; name: string; icon: string }) {
	selectedActivity = activity;
	confirmOpen = true;
}

function handleConfirmClose() {
	confirmOpen = false;
	selectedActivity = null;
}

function handleOmikujiClose() {
	omikujiOpen = false;
	invalidateAll();
}

function handleResultClose() {
	resultOpen = false;
	resultData = null;
	invalidateAll();
}

// Auto-show login bonus on page load if not claimed
$effect(() => {
	if (data.loginBonusStatus && !data.loginBonusStatus.claimedToday && !bonusClaiming) {
		bonusClaiming = true;
	}
});
</script>

<svelte:head>
	<title>ホーム - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
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

	<!-- Activity grid by category -->
	{#each activitiesByCategory as group (group.category)}
		<CategorySection category={group.category}>
			{#each group.items as activity (activity.id)}
				<ActivityCard
					icon={activity.icon}
					name={activity.name}
					category={activity.category}
					completed={data.todayRecorded.includes(activity.id)}
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
<Dialog bind:open={confirmOpen} title="">
	{#if selectedActivity}
		<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center">
			<span class="text-5xl">{selectedActivity.icon}</span>
			<p class="text-lg font-bold">{selectedActivity.name}を<br />きろくする？</p>
			<div class="flex gap-[var(--spacing-sm)] w-full">
				<button
					class="tap-target flex-1 py-3 rounded-[var(--radius-md)] bg-gray-200 font-bold"
					onclick={handleConfirmClose}
				>
					やめる
				</button>
				<form
					method="POST"
					action="?/record"
					class="flex-1"
					use:enhance={() => {
						confirmOpen = false;
						return async ({ result }) => {
							if (result.type === 'success' && result.data && 'success' in result.data) {
								const d = result.data as { activityName: string; totalPoints: number; streakDays: number; streakBonus: number };
								resultData = d;
								resultOpen = true;
							}
							selectedActivity = null;
						};
					}}
				>
					<input type="hidden" name="activityId" value={selectedActivity.id} />
					<button
						type="submit"
						class="tap-target w-full py-3 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold"
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
			<button
				class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold text-lg mt-[var(--spacing-sm)]"
				onclick={handleResultClose}
			>
				やったね！
			</button>
		</div>
	{/if}
</Dialog>

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
