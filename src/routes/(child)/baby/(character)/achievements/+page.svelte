<script lang="ts">
import { formatPointValueWithSign } from '$lib/domain/point-display';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

let detailOpen = $state(false);
let selectedAchievement = $state<(typeof data.achievements)[number] | null>(null);

const unlockedCount = $derived(
	data.achievements.filter((a) => a.unlockedAt !== null || a.highestUnlockedMilestone !== null)
		.length,
);

const rarityLabel: Record<string, string> = {
	common: 'ふつう',
	rare: 'レア',
	epic: 'スーパーレア',
	legendary: 'でんせつ',
};

function handleTap(achievement: (typeof data.achievements)[number]) {
	soundService.play('tap');
	selectedAchievement = achievement;
	detailOpen = true;
}

function isUnlocked(achievement: (typeof data.achievements)[number]): boolean {
	if (achievement.repeatable) {
		return (achievement.highestUnlockedMilestone ?? null) !== null;
	}
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
	if (achievement.conditionType === 'all_categories') {
		return `${achievement.currentProgress}/5カテゴリ`;
	}
	if (achievement.conditionType === 'milestone_event') {
		return '';
	}
	return `${achievement.currentProgress}/${achievement.conditionValue}`;
}

function streakStatusText(achievement: (typeof data.achievements)[number]): string | null {
	if (achievement.conditionType !== 'streak_days') return null;
	if (achievement.liveStreak == null || achievement.liveStreak === 0) return null;
	return `いま${achievement.liveStreak}にちれんぞく中`;
}

function milestoneDisplayText(achievement: (typeof data.achievements)[number]): string | null {
	if (!achievement.repeatable || !achievement.highestUnlockedMilestone) return null;
	return `${achievement.highestUnlockedMilestone}たっせい！`;
}

function currentRarity(achievement: (typeof data.achievements)[number]): string {
	if (!achievement.repeatable || achievement.milestones.length === 0) {
		return achievement.rarity;
	}
	const unlockedMilestones = achievement.milestones.filter((m) => m.unlocked);
	if (unlockedMilestones.length === 0) return 'common';
	const ratio = unlockedMilestones.length / achievement.milestones.length;
	if (ratio >= 0.9) return 'legendary';
	if (ratio >= 0.6) return 'epic';
	if (ratio >= 0.3) return 'rare';
	return 'common';
}
</script>

<svelte:head>
	<title>じっせき - がんばりクエスト</title>
</svelte:head>

<div class="px-4 py-1">
	<!-- Summary -->
	<div class="flex items-center justify-center gap-2 mb-6">
		<span class="text-3xl">🏆</span>
		<p class="text-lg font-bold">
			{unlockedCount} / {data.achievements.length} たっせい
		</p>
	</div>

	<!-- Achievement grid -->
	{#if data.achievements.length > 0}
		<div class="grid grid-cols-3 gap-2">
			{#each data.achievements as achievement (achievement.id)}
				{@const unlocked = isUnlocked(achievement)}
				{@const rarity = currentRarity(achievement)}
				{@const pct = progressPercent(achievement)}
				<button
					class="tap-target ach-card flex flex-col items-center gap-1 p-2 rounded-2xl border-2 border-solid relative overflow-hidden cursor-pointer bg-none transition-all duration-150 ease-in-out {unlocked ? 'ach-card--unlocked ach-card--' + rarity : 'ach-card--locked'}"
					onclick={() => handleTap(achievement)}
				>
					<span class="text-3xl {unlocked ? '' : 'grayscale opacity-50'}">
						{achievement.icon}
					</span>
					<span class="text-xs font-bold text-center overflow-hidden text-ellipsis whitespace-nowrap w-full {unlocked ? '' : 'text-[var(--color-text-muted)]'}">
						{achievement.name}
					</span>
					{#if achievement.repeatable && unlocked && achievement.highestUnlockedMilestone}
						<span class="text-[10px] font-bold text-[var(--theme-accent)]">
							{achievement.highestUnlockedMilestone}{achievement.conditionType === 'streak_days' ? 'にち' : ''}
						</span>
					{/if}
					{#if !unlocked || achievement.nextMilestone}
						<div class="w-full h-1 rounded-full bg-[var(--color-neutral-200)] mt-0.5">
							<div class="ach-progress-fill h-full rounded-full bg-[var(--theme-primary)]" style:width="{pct}%"></div>
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col items-center py-12 text-[var(--color-text-muted)]">
			<span class="text-4xl mb-2">🏆</span>
			<p class="font-bold">じっせきがまだないよ</p>
		</div>
	{/if}
</div>

<!-- Achievement detail dialog -->
<Dialog bind:open={detailOpen} title="">
	{#if selectedAchievement}
		{@const unlocked = isUnlocked(selectedAchievement)}
		{@const rarity = currentRarity(selectedAchievement)}
		{@const pct = progressPercent(selectedAchievement)}
		{@const streakText = streakStatusText(selectedAchievement)}
		{@const milestoneText = milestoneDisplayText(selectedAchievement)}
		<div class="flex flex-col items-center gap-4 text-center">
			<div class="ach-detail-icon w-24 h-24 rounded-3xl border-4 border-solid flex items-center justify-center {unlocked ? 'ach-detail-icon--' + rarity : 'ach-detail-icon--locked'}">
				<span class="text-5xl {unlocked ? '' : 'grayscale opacity-50'}">
					{selectedAchievement.icon}
				</span>
			</div>

			<div>
				<p class="text-xl font-bold">{selectedAchievement.name}</p>
				{#if selectedAchievement.description}
					<p class="text-sm text-[var(--color-text-muted)] mt-1">{selectedAchievement.description}</p>
				{/if}
			</div>

			<!-- Milestone chips (repeatable) -->
			{#if selectedAchievement.repeatable && selectedAchievement.milestones.length > 0}
				<div class="flex flex-wrap gap-1 justify-center">
					{#each selectedAchievement.milestones as m}
						<span class="text-xs px-2 py-0.5 rounded-full font-bold {m.unlocked ? 'bg-[var(--theme-primary)] text-white' : 'bg-[var(--color-neutral-200)] text-[var(--color-text-muted)]'}">
							{m.value}
						</span>
					{/each}
				</div>
				{#if milestoneText}
					<p class="text-sm font-bold text-[var(--theme-accent)]">{milestoneText}</p>
				{/if}
			{/if}

			<!-- Condition -->
			{#if selectedAchievement.conditionLabel && selectedAchievement.conditionType !== 'milestone_event'}
				<div class="px-3 py-2 rounded-xl bg-[var(--color-neutral-50)] w-full">
					<p class="text-sm font-bold text-[var(--color-text-muted)]">
						{unlocked && !selectedAchievement.nextMilestone ? '✅' : '🎯'} {selectedAchievement.conditionLabel}
					</p>
					{#if selectedAchievement.nextMilestone || !unlocked}
						<div class="flex items-center gap-2 mt-2">
							<div class="flex-1 h-2 rounded-full bg-[var(--color-neutral-200)]">
								<div class="ach-progress-fill h-full rounded-full bg-[var(--theme-primary)]" style:width="{pct}%"></div>
							</div>
							<span class="text-xs font-bold text-[var(--color-text-muted)] whitespace-nowrap">
								{progressText(selectedAchievement)}
							</span>
						</div>
						{#if streakText}
							<p class="text-xs text-[var(--theme-accent)] mt-1">({streakText})</p>
						{/if}
					{:else}
						<p class="text-xs text-[var(--theme-accent)] font-bold mt-1">ぜんぶたっせい！</p>
						{#if streakText}
							<p class="text-xs text-[var(--color-text-muted)] mt-1">({streakText})</p>
						{/if}
					{/if}
				</div>
			{/if}

			<!-- Life milestone -->
			{#if selectedAchievement.conditionType === 'milestone_event'}
				<div class="px-3 py-2 rounded-xl bg-[var(--color-neutral-50)] w-full">
					{#if unlocked}
						<p class="text-xs text-[var(--theme-accent)] font-bold mt-1">✅ たっせい！おめでとう！</p>
					{:else}
						<p class="text-sm font-bold text-[var(--color-text-muted)]">おやがきろくしてくれるよ</p>
					{/if}
				</div>
			{/if}

			<div class="flex gap-4 text-sm">
				<div class="flex flex-col items-center">
					<span class="font-bold text-[var(--color-point)]">{fmtPts(selectedAchievement.bonusPoints)}</span>
					<span class="text-[var(--color-text-muted)]">ボーナス</span>
				</div>
				<div class="flex flex-col items-center">
					<span class="font-bold">{rarityLabel[rarity] ?? 'ふつう'}</span>
					<span class="text-[var(--color-text-muted)]">レアリティ</span>
				</div>
			</div>

			{#if unlocked && selectedAchievement.unlockedAt}
				<p class="text-xs text-[var(--color-text-muted)]">
					{new Date(selectedAchievement.unlockedAt).toLocaleDateString('ja-JP')} にたっせい
				</p>
			{/if}
		</div>
	{/if}
</Dialog>

<style>
	/* Rarity variants for card grid — dynamic class names require CSS rules */
	.ach-card--locked { border-color: var(--color-neutral-200); background: var(--color-neutral-100); }
	.ach-card--unlocked.ach-card--common { border-color: var(--color-rarity-common); background: var(--color-rarity-common-bg); }
	.ach-card--unlocked.ach-card--rare { border-color: var(--color-rarity-rare); background: var(--color-rarity-rare-bg); }
	.ach-card--unlocked.ach-card--epic { border-color: var(--color-rarity-epic); background: var(--color-rarity-epic-bg); }
	.ach-card--unlocked.ach-card--legendary { border-color: var(--color-rarity-legendary); background: var(--color-rarity-legendary-bg); }

	/* Rarity variants for detail icon */
	.ach-detail-icon--locked { border-color: var(--color-neutral-200); background: var(--color-neutral-100); }
	.ach-detail-icon--common { border-color: var(--color-rarity-common); background: var(--color-rarity-common-bg); }
	.ach-detail-icon--rare { border-color: var(--color-rarity-rare); background: var(--color-rarity-rare-bg); }
	.ach-detail-icon--epic { border-color: var(--color-rarity-epic); background: var(--color-rarity-epic-bg); }
	.ach-detail-icon--legendary { border-color: var(--color-rarity-legendary); background: var(--color-rarity-legendary-bg); }

	/* Progress bar width transition — not possible with Tailwind alone */
	.ach-progress-fill { transition: width 0.3s ease; }
</style>
