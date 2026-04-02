<script lang="ts">
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

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
	common: 'コモン',
	rare: 'レア',
	epic: 'エピック',
	legendary: 'レジェンダリー',
};

function handleTap(title: (typeof data.titles)[number]) {
	soundService.play('tap');
	selectedTitle = title;
	detailOpen = true;
}
</script>

<svelte:head>
	<title>称号 - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--sp-md)] py-[var(--sp-sm)]">
	<div class="flex items-center justify-center gap-[var(--sp-sm)] mb-[var(--sp-md)]">
		<span class="text-3xl">🏅</span>
		<p class="text-lg font-bold">
			{unlockedCount} / {data.titles.length} 解放済み
		</p>
	</div>

	{#if data.activeTitle}
		<div class="bg-white rounded-[var(--radius-md)] p-[var(--sp-sm)] shadow-sm mb-[var(--sp-md)] flex items-center justify-center gap-[var(--sp-sm)]">
			<span class="text-xl">{data.activeTitle.icon}</span>
			<p class="text-sm font-bold text-[var(--theme-accent)]">
				装備中: {data.activeTitle.name}
			</p>
		</div>
	{/if}

	{#if data.titles.length > 0}
		<div class="grid grid-cols-3 gap-[var(--sp-sm)]">
			{#each data.titles as title (title.id)}
				{@const unlocked = title.unlockedAt !== null}
				{@const border = rarityBorder[title.rarity] ?? 'border-gray-200'}
				{@const bg = rarityBg[title.rarity] ?? 'bg-gray-50'}
				<button
					class="tap-target flex flex-col items-center gap-1 p-[var(--sp-sm)] rounded-[var(--radius-md)] border-2
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
						<span class="text-[10px] font-bold text-[var(--theme-accent)]">装備中</span>
					{:else if !unlocked}
						<div class="w-full h-1 rounded-full bg-gray-200 mt-0.5">
							<div
								class="h-full rounded-full bg-[var(--theme-primary)] transition-all"
								style:width="{title.currentProgress}%"
							></div>
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col items-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-sm)]">🏅</span>
			<p class="font-bold">称号はまだありません</p>
		</div>
	{/if}
</div>

<Dialog bind:open={detailOpen} title="">
	{#if selectedTitle}
		{@const unlocked = selectedTitle.unlockedAt !== null}
		{@const border = rarityBorder[selectedTitle.rarity] ?? 'border-gray-200'}
		{@const bg = rarityBg[selectedTitle.rarity] ?? 'bg-gray-50'}
		<div class="flex flex-col items-center gap-[var(--sp-md)] text-center">
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
								style:width="{selectedTitle.currentProgress}%"
							></div>
						</div>
						<span class="text-xs font-bold text-[var(--color-text-muted)] whitespace-nowrap">
							{selectedTitle.currentProgress}%
						</span>
					</div>
				{/if}
			</div>

			<div class="flex flex-col items-center">
				<span class="font-bold">{rarityLabel[selectedTitle.rarity] ?? 'コモン'}</span>
				<span class="text-xs text-[var(--color-text-muted)]">レアリティ</span>
			</div>

			{#if unlocked}
				{#if selectedTitle.isActive}
					<form method="POST" action="?/unset">
						<Button type="submit" variant="ghost" size="sm">外す</Button>
					</form>
				{:else}
					<form method="POST" action="?/setActive">
						<input type="hidden" name="titleId" value={selectedTitle.id} />
						<Button type="submit" variant="primary" size="sm">装備する</Button>
					</form>
				{/if}
			{/if}

			{#if unlocked && selectedTitle.unlockedAt}
				<p class="text-xs text-[var(--color-text-muted)]">
					{new Date(selectedTitle.unlockedAt).toLocaleDateString('ja-JP')} に解放
				</p>
			{/if}
		</div>
	{/if}
</Dialog>
