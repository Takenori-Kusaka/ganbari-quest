<script lang="ts">
import { formatPointValueWithSign } from '$lib/domain/point-display';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

let detailOpen = $state(false);
let selectedAchievement = $state<(typeof data.achievements)[number] | null>(null);

const unlockedCount = $derived(
	data.achievements.filter(
		(a: { unlockedAt: string | null; highestUnlockedMilestone: number | null }) =>
			a.unlockedAt !== null || a.highestUnlockedMilestone !== null,
	).length,
);

const rarityBorder: Record<string, string> = {
	common: 'border-green-300',
	rare: 'border-blue-300',
	epic: 'border-purple-300',
	legendary: 'border-yellow-300',
};
const rarityBg: Record<string, string> = {
	common: 'bg-green-50',
	rare: 'bg-blue-50',
	epic: 'bg-purple-50',
	legendary: 'bg-amber-50',
};
const rarityLabel: Record<string, string> = {
	common: 'ふつう',
	rare: 'レア',
	epic: 'スーパーレア',
	legendary: 'でんせつ',
};

function handleTap(achievement: (typeof data.achievements)[number]) {
	selectedAchievement = achievement;
	detailOpen = true;
}

function isUnlocked(achievement: (typeof data.achievements)[number]): boolean {
	if (achievement.repeatable) return (achievement.highestUnlockedMilestone ?? null) !== null;
	return achievement.unlockedAt !== null;
}

function progressPercent(achievement: (typeof data.achievements)[number]): number {
	if (!achievement.repeatable && achievement.unlockedAt) return 100;
	if (achievement.conditionValue <= 0) return 0;
	return Math.min(
		100,
		Math.round((achievement.currentProgress / achievement.conditionValue) * 100),
	);
}

function progressText(achievement: (typeof data.achievements)[number]): string {
	return `${achievement.currentProgress}/${achievement.conditionValue}`;
}

function currentRarity(achievement: (typeof data.achievements)[number]): string {
	if (!achievement.repeatable || achievement.milestones.length === 0) return achievement.rarity;
	const unlockedMilestones = achievement.milestones.filter(
		(m: { unlocked: boolean }) => m.unlocked,
	);
	if (unlockedMilestones.length === 0) return 'common';
	const ratio = unlockedMilestones.length / achievement.milestones.length;
	if (ratio >= 0.9) return 'legendary';
	if (ratio >= 0.6) return 'epic';
	if (ratio >= 0.3) return 'rare';
	return 'common';
}
</script>

<svelte:head>
	<title>じっせき - がんばりクエスト デモ</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	<div class="flex items-center justify-center gap-[var(--spacing-sm)] mb-[var(--spacing-lg)]">
		<span class="text-3xl">🏆</span>
		<p class="text-lg font-bold">{unlockedCount} / {data.achievements.length} たっせい</p>
	</div>

	{#if data.achievements.length > 0}
		<div class="grid grid-cols-3 gap-[var(--spacing-sm)]">
			{#each data.achievements as achievement (achievement.id)}
				{@const unlocked = isUnlocked(achievement)}
				{@const rarity = currentRarity(achievement)}
				{@const border = rarityBorder[rarity] ?? 'border-gray-200'}
				{@const bg = rarityBg[rarity] ?? 'bg-gray-50'}
				{@const pct = progressPercent(achievement)}
				<button
					class="tap-target flex flex-col items-center gap-1 p-[var(--spacing-sm)] rounded-[var(--radius-md)] border-2
						{unlocked ? `${border} ${bg}` : 'border-gray-200 bg-gray-100'}
						transition-all relative overflow-hidden"
					onclick={() => handleTap(achievement)}
				>
					<span class="text-3xl {unlocked ? '' : 'grayscale opacity-50'}">{achievement.icon}</span>
					<span class="text-xs font-bold truncate w-full text-center {unlocked ? '' : 'text-[var(--color-text-muted)]'}">
						{achievement.name}
					</span>
					{#if !unlocked || achievement.nextMilestone}
						<div class="w-full h-1 rounded-full bg-gray-200 mt-0.5">
							<div class="h-full rounded-full bg-[var(--theme-primary)] transition-all" style="width: {pct}%"></div>
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<Dialog bind:open={detailOpen} title="">
	{#if selectedAchievement}
		{@const unlocked = isUnlocked(selectedAchievement)}
		{@const rarity = currentRarity(selectedAchievement)}
		{@const pct = progressPercent(selectedAchievement)}
		<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center">
			<span class="text-5xl {unlocked ? '' : 'grayscale opacity-50'}">{selectedAchievement.icon}</span>
			<div>
				<p class="text-xl font-bold">{selectedAchievement.name}</p>
				{#if selectedAchievement.description}
					<p class="text-sm text-[var(--color-text-muted)] mt-1">{selectedAchievement.description}</p>
				{/if}
			</div>
			{#if selectedAchievement.conditionLabel}
				<div class="px-3 py-2 rounded-[var(--radius-md)] bg-gray-50 w-full">
					<p class="text-sm font-bold text-[var(--color-text-muted)]">
						{unlocked ? '✅' : '🎯'} {selectedAchievement.conditionLabel}
					</p>
					{#if !unlocked}
						<div class="flex items-center gap-2 mt-2">
							<div class="flex-1 h-2 rounded-full bg-gray-200">
								<div class="h-full rounded-full bg-[var(--theme-primary)]" style="width: {pct}%"></div>
							</div>
							<span class="text-xs font-bold text-[var(--color-text-muted)]">{progressText(selectedAchievement)}</span>
						</div>
					{/if}
				</div>
			{/if}
			<div class="flex gap-[var(--spacing-md)] text-sm">
				<div class="flex flex-col items-center">
					<span class="font-bold text-[var(--color-point)]">{fmtPts(selectedAchievement.bonusPoints)}</span>
					<span class="text-[var(--color-text-muted)]">ボーナス</span>
				</div>
				<div class="flex flex-col items-center">
					<span class="font-bold">{rarityLabel[rarity] ?? 'ふつう'}</span>
					<span class="text-[var(--color-text-muted)]">レアリティ</span>
				</div>
			</div>
		</div>
	{/if}
</Dialog>
