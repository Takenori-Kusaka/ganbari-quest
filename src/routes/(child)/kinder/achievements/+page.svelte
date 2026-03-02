<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

let detailOpen = $state(false);
let selectedAchievement = $state<(typeof data.achievements)[number] | null>(null);

const unlockedCount = $derived(
	data.achievements.filter((a) => a.unlockedAt !== null || a.highestUnlockedMilestone !== null)
		.length,
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
	if (achievement.repeatable) {
		return (achievement.highestUnlockedMilestone ?? null) !== null;
	}
	return achievement.unlockedAt !== null;
}

function progressPercent(achievement: (typeof data.achievements)[number]): number {
	if (!achievement.repeatable && achievement.unlockedAt) return 100;
	if (achievement.conditionValue <= 0) return 0;
	return Math.min(100, Math.round((achievement.currentProgress / achievement.conditionValue) * 100));
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

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	<!-- Summary -->
	<div class="flex items-center justify-center gap-[var(--spacing-sm)] mb-[var(--spacing-lg)]">
		<span class="text-3xl">🏆</span>
		<p class="text-lg font-bold">
			{unlockedCount} / {data.achievements.length} たっせい
		</p>
	</div>

	<!-- Achievement grid -->
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
					<span class="text-3xl {unlocked ? '' : 'grayscale opacity-50'}">
						{achievement.icon}
					</span>
					<span
						class="text-xs font-bold truncate w-full text-center {unlocked ? '' : 'text-[var(--color-text-muted)]'}"
					>
						{achievement.name}
					</span>
					{#if achievement.repeatable && unlocked && achievement.highestUnlockedMilestone}
						<span class="text-[10px] font-bold text-[var(--theme-accent)]">
							{achievement.highestUnlockedMilestone}{achievement.conditionType === 'streak_days' ? 'にち' : ''}
						</span>
					{/if}
					{#if !unlocked || achievement.nextMilestone}
						<div class="w-full h-1 rounded-full bg-gray-200 mt-0.5">
							<div
								class="h-full rounded-full bg-[var(--theme-primary)] transition-all"
								style="width: {pct}%"
							></div>
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{:else}
		<div
			class="flex flex-col items-center py-[var(--spacing-2xl)] text-[var(--color-text-muted)]"
		>
			<span class="text-4xl mb-[var(--spacing-sm)]">🏆</span>
			<p class="font-bold">じっせきがまだないよ</p>
		</div>
	{/if}
</div>

<!-- Achievement detail dialog -->
<Dialog bind:open={detailOpen} title="">
	{#if selectedAchievement}
		{@const unlocked = isUnlocked(selectedAchievement)}
		{@const rarity = currentRarity(selectedAchievement)}
		{@const border = rarityBorder[rarity] ?? 'border-gray-200'}
		{@const bg = rarityBg[rarity] ?? 'bg-gray-50'}
		{@const pct = progressPercent(selectedAchievement)}
		{@const streakText = streakStatusText(selectedAchievement)}
		{@const milestoneText = milestoneDisplayText(selectedAchievement)}
		<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center">
			<div
				class="w-24 h-24 rounded-[var(--radius-lg)] border-4 {unlocked
					? `${border} ${bg}`
					: 'border-gray-200 bg-gray-100'}
					flex items-center justify-center"
			>
				<span class="text-5xl {unlocked ? '' : 'grayscale opacity-50'}">
					{selectedAchievement.icon}
				</span>
			</div>

			<div>
				<p class="text-xl font-bold">{selectedAchievement.name}</p>
				{#if selectedAchievement.description}
					<p class="text-sm text-[var(--color-text-muted)] mt-1">
						{selectedAchievement.description}
					</p>
				{/if}
			</div>

			<!-- Milestone progress (repeatable achievements) -->
			{#if selectedAchievement.repeatable && selectedAchievement.milestones.length > 0}
				<div class="w-full px-2">
					<div class="flex flex-wrap gap-1 justify-center">
						{#each selectedAchievement.milestones as m}
							<span
								class="text-xs px-2 py-0.5 rounded-full font-bold
									{m.unlocked
									? 'bg-[var(--theme-primary)] text-white'
									: 'bg-gray-200 text-[var(--color-text-muted)]'}"
							>
								{m.value}
							</span>
						{/each}
					</div>
					{#if milestoneText}
						<p class="text-sm font-bold text-[var(--theme-accent)] mt-2">
							{milestoneText}
						</p>
					{/if}
				</div>
			{/if}

			<!-- Condition -->
			{#if selectedAchievement.conditionLabel}
				<div class="px-3 py-2 rounded-[var(--radius-md)] bg-gray-50 w-full">
					<p class="text-sm font-bold text-[var(--color-text-muted)]">
						{unlocked && !selectedAchievement.nextMilestone ? '✅' : '🎯'}
						{selectedAchievement.conditionLabel}
					</p>
					{#if selectedAchievement.nextMilestone || !unlocked}
						<div class="flex items-center gap-2 mt-2">
							<div class="flex-1 h-2 rounded-full bg-gray-200">
								<div
									class="h-full rounded-full bg-[var(--theme-primary)] transition-all"
									style="width: {pct}%"
								></div>
							</div>
							<span
								class="text-xs font-bold text-[var(--color-text-muted)] whitespace-nowrap"
							>
								{progressText(selectedAchievement)}
							</span>
						</div>
						{#if streakText}
							<p class="text-xs text-[var(--theme-accent)] mt-1">({streakText})</p>
						{/if}
					{:else}
						<p class="text-xs text-[var(--theme-accent)] font-bold mt-1">
							ぜんぶたっせい！
						</p>
						{#if streakText}
							<p class="text-xs text-[var(--color-text-muted)] mt-1">
								({streakText})
							</p>
						{/if}
					{/if}
				</div>
			{/if}

			<!-- Life milestone message -->
			{#if selectedAchievement.conditionType === 'milestone_event'}
				<div class="px-3 py-2 rounded-[var(--radius-md)] bg-gray-50 w-full">
					{#if unlocked}
						<p class="text-sm font-bold text-[var(--theme-accent)]">
							✅ たっせい！おめでとう！
						</p>
					{:else}
						<p class="text-sm text-[var(--color-text-muted)]">
							おやがきろくしてくれるよ
						</p>
					{/if}
				</div>
			{/if}

			<div class="flex gap-[var(--spacing-md)] text-sm">
				<div class="flex flex-col items-center">
					<span class="font-bold text-[var(--color-point)]"
						>+{selectedAchievement.bonusPoints}P</span
					>
					<span class="text-[var(--color-text-muted)]">ボーナス</span>
				</div>
				<div class="flex flex-col items-center">
					<span class="font-bold"
						>{rarityLabel[rarity] ?? 'ふつう'}</span
					>
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
