<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data } = $props();

let detailOpen = $state(false);
let selectedTitle = $state<(typeof data.titles)[number] | null>(null);

const unlockedCount = $derived(data.titles.filter((t) => t.unlockedAt !== null).length);

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

function handleTap(title: (typeof data.titles)[number]) {
	selectedTitle = title;
	detailOpen = true;
}
</script>

<svelte:head>
	<title>しょうごう - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	<!-- Summary -->
	<div class="flex items-center justify-center gap-[var(--spacing-sm)] mb-[var(--spacing-md)]">
		<span class="text-3xl">🏅</span>
		<p class="text-lg font-bold">
			{unlockedCount} / {data.titles.length} かいほう
		</p>
	</div>

	<!-- Active title display -->
	{#if data.activeTitle}
		<div class="bg-white rounded-[var(--radius-md)] p-[var(--spacing-sm)] shadow-sm mb-[var(--spacing-md)] flex items-center justify-center gap-[var(--spacing-sm)]">
			<span class="text-xl">{data.activeTitle.icon}</span>
			<p class="text-sm font-bold" style="color: var(--theme-accent);">
				いまのしょうごう: {data.activeTitle.name}
			</p>
		</div>
	{/if}

	<!-- Title grid -->
	{#if data.titles.length > 0}
		<div class="grid grid-cols-3 gap-[var(--spacing-sm)]">
			{#each data.titles as title (title.id)}
				{@const unlocked = title.unlockedAt !== null}
				{@const border = rarityBorder[title.rarity] ?? 'border-gray-200'}
				{@const bg = rarityBg[title.rarity] ?? 'bg-gray-50'}
				<button
					class="tap-target flex flex-col items-center gap-1 p-[var(--spacing-sm)] rounded-[var(--radius-md)] border-2
						{unlocked ? `${border} ${bg}` : 'border-gray-200 bg-gray-100'}
						{title.isActive ? 'ring-2 ring-[var(--theme-accent)]' : ''}
						transition-all relative overflow-hidden"
					onclick={() => handleTap(title)}
				>
					<span class="text-3xl {unlocked ? '' : 'grayscale opacity-50'}">
						{title.icon}
					</span>
					<span
						class="text-xs font-bold truncate w-full text-center {unlocked ? '' : 'text-[var(--color-text-muted)]'}"
					>
						{unlocked ? title.name : '???'}
					</span>
					{#if title.isActive}
						<span class="text-[10px] font-bold text-[var(--theme-accent)]">そうび中</span>
					{:else if !unlocked}
						<div class="w-full h-1 rounded-full bg-gray-200 mt-0.5">
							<div
								class="h-full rounded-full bg-[var(--theme-primary)] transition-all"
								style="width: {title.currentProgress}%"
							></div>
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col items-center py-[var(--spacing-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--spacing-sm)]">🏅</span>
			<p class="font-bold">しょうごうがまだないよ</p>
		</div>
	{/if}

	<!-- Back link -->
	<div class="mt-[var(--spacing-lg)] text-center">
		<a href="/kinder/status" class="text-sm text-[var(--color-text-muted)] underline">
			← つよさにもどる
		</a>
	</div>
</div>

<!-- Title detail dialog -->
<Dialog bind:open={detailOpen} title="">
	{#if selectedTitle}
		{@const unlocked = selectedTitle.unlockedAt !== null}
		{@const border = rarityBorder[selectedTitle.rarity] ?? 'border-gray-200'}
		{@const bg = rarityBg[selectedTitle.rarity] ?? 'bg-gray-50'}
		<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center">
			<div
				class="w-24 h-24 rounded-[var(--radius-lg)] border-4 {unlocked
					? `${border} ${bg}`
					: 'border-gray-200 bg-gray-100'}
					flex items-center justify-center"
			>
				<span class="text-5xl {unlocked ? '' : 'grayscale opacity-50'}">
					{selectedTitle.icon}
				</span>
			</div>

			<div>
				<p class="text-xl font-bold">{unlocked ? selectedTitle.name : '???'}</p>
				{#if selectedTitle.description && unlocked}
					<p class="text-sm text-[var(--color-text-muted)] mt-1">
						{selectedTitle.description}
					</p>
				{/if}
			</div>

			<!-- Condition -->
			<div class="px-3 py-2 rounded-[var(--radius-md)] bg-gray-50 w-full">
				<p class="text-sm font-bold text-[var(--color-text-muted)]">
					{unlocked ? '✅' : '🎯'}
					{selectedTitle.conditionLabel}
				</p>
				{#if !unlocked}
					<div class="flex items-center gap-2 mt-2">
						<div class="flex-1 h-2 rounded-full bg-gray-200">
							<div
								class="h-full rounded-full bg-[var(--theme-primary)] transition-all"
								style="width: {selectedTitle.currentProgress}%"
							></div>
						</div>
						<span class="text-xs font-bold text-[var(--color-text-muted)] whitespace-nowrap">
							{selectedTitle.currentProgress}%
						</span>
					</div>
				{/if}
			</div>

			<!-- Rarity -->
			<div class="flex flex-col items-center">
				<span class="font-bold">{rarityLabel[selectedTitle.rarity] ?? 'ふつう'}</span>
				<span class="text-xs text-[var(--color-text-muted)]">レアリティ</span>
			</div>

			<!-- Action buttons -->
			{#if unlocked}
				{#if selectedTitle.isActive}
					<form method="POST" action="?/unset">
						<button
							type="submit"
							class="px-6 py-2 rounded-full text-sm font-bold bg-gray-200 text-[var(--color-text-muted)]"
						>
							はずす
						</button>
					</form>
				{:else}
					<form method="POST" action="?/setActive">
						<input type="hidden" name="titleId" value={selectedTitle.id} />
						<button
							type="submit"
							class="px-6 py-2 rounded-full text-sm font-bold text-white"
							style="background: var(--theme-accent);"
						>
							そうびする
						</button>
					</form>
				{/if}
			{/if}

			{#if unlocked && selectedTitle.unlockedAt}
				<p class="text-xs text-[var(--color-text-muted)]">
					{new Date(selectedTitle.unlockedAt).toLocaleDateString('ja-JP')} にかいほう
				</p>
			{/if}
		</div>
	{/if}
</Dialog>
