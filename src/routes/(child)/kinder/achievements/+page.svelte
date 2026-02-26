<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

let detailOpen = $state(false);
let selectedAchievement = $state<(typeof data.achievements)[number] | null>(null);

const unlockedCount = $derived(data.achievements.filter((a) => a.unlockedAt !== null).length);

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
</script>

<svelte:head>
	<title>じっせき - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	<!-- Summary -->
	<div class="flex items-center justify-center gap-[var(--spacing-sm)] mb-[var(--spacing-lg)]">
		<span class="text-3xl">🏆</span>
		<p class="text-lg font-bold">
			{unlockedCount} / {data.achievements.length} かいほう
		</p>
	</div>

	<!-- Achievement grid -->
	{#if data.achievements.length > 0}
		<div class="grid grid-cols-3 gap-[var(--spacing-sm)]">
			{#each data.achievements as achievement (achievement.id)}
				{@const unlocked = achievement.unlockedAt !== null}
				{@const border = rarityBorder[achievement.rarity] ?? 'border-gray-200'}
				{@const bg = rarityBg[achievement.rarity] ?? 'bg-gray-50'}
				<button
					class="tap-target flex flex-col items-center gap-1 p-[var(--spacing-sm)] rounded-[var(--radius-md)] border-2
						{unlocked ? `${border} ${bg}` : 'border-gray-200 bg-gray-100 opacity-60'}
						transition-all"
					onclick={() => handleTap(achievement)}
				>
					<span class="text-3xl {unlocked ? '' : 'grayscale'}">
						{unlocked ? achievement.icon : '🔒'}
					</span>
					<span class="text-xs font-bold truncate w-full text-center {unlocked ? '' : 'text-[var(--color-text-muted)]'}">
						{unlocked ? achievement.name : '???'}
					</span>
				</button>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col items-center py-[var(--spacing-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--spacing-sm)]">🏆</span>
			<p class="font-bold">じっせきがまだないよ</p>
		</div>
	{/if}
</div>

<!-- Achievement detail dialog -->
<Dialog bind:open={detailOpen} title="">
	{#if selectedAchievement}
		{@const unlocked = selectedAchievement.unlockedAt !== null}
		{@const border = rarityBorder[selectedAchievement.rarity] ?? 'border-gray-200'}
		{@const bg = rarityBg[selectedAchievement.rarity] ?? 'bg-gray-50'}
		<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center">
			<div
				class="w-24 h-24 rounded-[var(--radius-lg)] border-4 {unlocked ? `${border} ${bg}` : 'border-gray-200 bg-gray-100'}
					flex items-center justify-center"
			>
				<span class="text-5xl {unlocked ? '' : 'grayscale'}">
					{unlocked ? selectedAchievement.icon : '🔒'}
				</span>
			</div>

			<div>
				<p class="text-xl font-bold">{selectedAchievement.name}</p>
				{#if selectedAchievement.description}
					<p class="text-sm text-[var(--color-text-muted)] mt-1">{selectedAchievement.description}</p>
				{/if}
			</div>

			<div class="flex gap-[var(--spacing-md)] text-sm">
				<div class="flex flex-col items-center">
					<span class="font-bold text-[var(--color-point)]">+{selectedAchievement.bonusPoints}P</span>
					<span class="text-[var(--color-text-muted)]">ボーナス</span>
				</div>
				<div class="flex flex-col items-center">
					<span class="font-bold">{rarityLabel[selectedAchievement.rarity] ?? 'ふつう'}</span>
					<span class="text-[var(--color-text-muted)]">レアリティ</span>
				</div>
			</div>

			{#if unlocked}
				<p class="text-xs text-[var(--color-text-muted)]">
					{new Date(selectedAchievement.unlockedAt ?? '').toLocaleDateString('ja-JP')} にかいほう
				</p>
			{:else}
				<p class="text-sm text-[var(--color-text-muted)] font-bold">まだかいほうしてないよ</p>
			{/if}
		</div>
	{/if}
</Dialog>
