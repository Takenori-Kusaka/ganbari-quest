<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { formatPointValue, getUnitLabel } from '$lib/domain/point-display';
import {
	type AvatarCategory,
	CATEGORY_ICONS,
	CATEGORY_LABELS,
	RARITY_LABELS,
} from '$lib/domain/validation/avatar';
import AvatarDisplay from '$lib/ui/components/AvatarDisplay.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

let { data, form } = $props();

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);
const unit = $derived(getUnitLabel(ps.mode, ps.currency));

type ShopItem = (typeof data.items)[number];

let selectedItem = $state<ShopItem | null>(null);
let dialogOpen = $state(false);
let activeTab = $state<AvatarCategory>('background');

const tabCategories: AvatarCategory[] = ['background', 'frame', 'effect'];
const filteredItems = $derived(data.items.filter((i) => i.category === activeTab));
const ownedCount = $derived(data.items.filter((i) => i.owned).length);

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

function handleTap(item: ShopItem) {
	selectedItem = item;
	dialogOpen = true;
}
</script>

<svelte:head>
	<title>きせかえショップ - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--spacing-md)] py-[var(--spacing-sm)]">
	<!-- Header: avatar preview + points -->
	<div class="bg-white rounded-[var(--radius-md)] p-[var(--spacing-md)] shadow-sm mb-[var(--spacing-md)] flex items-center justify-between">
		<div class="flex items-center gap-[var(--spacing-sm)]">
			{#if data.avatarConfig}
				<AvatarDisplay
					bgCss={data.avatarConfig.bgCss}
					frameCss={data.avatarConfig.frameCss}
					effectClass={data.avatarConfig.effectClass}
					size="lg"
				/>
			{:else}
				<AvatarDisplay size="lg" />
			{/if}
		</div>
		<div class="text-right">
			<p class="text-xs text-[var(--color-text-muted)]">もちポイント</p>
			<p class="text-2xl font-bold" style="color: var(--color-point);">
				{fmtBal(data.balance)}
			</p>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">
				{ownedCount} / {data.items.length} しょじ
			</p>
		</div>
	</div>

	<!-- Error/Success messages -->
	{#if form?.error}
		<div class="bg-red-50 text-red-600 rounded-[var(--radius-md)] p-[var(--spacing-sm)] mb-[var(--spacing-sm)] text-sm font-bold text-center">
			{form.error}
		</div>
	{/if}

	<!-- Category tabs -->
	<div class="flex gap-1 mb-[var(--spacing-md)]">
		{#each tabCategories as cat (cat)}
			<button
				type="button"
				class="flex-1 px-2 py-2 rounded-[var(--radius-md)] text-sm font-bold transition-colors
					{activeTab === cat
					? 'text-white'
					: 'bg-white text-[var(--color-text-muted)] border border-gray-200'}"
				style={activeTab === cat ? 'background: var(--theme-accent);' : ''}
				onclick={() => { activeTab = cat; }}
			>
				{CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
			</button>
		{/each}
	</div>

	<!-- Item grid -->
	{#if filteredItems.length > 0}
		<div class="grid grid-cols-3 gap-[var(--spacing-sm)]">
			{#each filteredItems as item (item.id)}
				{@const border = rarityBorder[item.rarity] ?? 'border-gray-200'}
				{@const bg = rarityBg[item.rarity] ?? 'bg-gray-50'}
				<button
					class="tap-target flex flex-col items-center gap-1 p-[var(--spacing-sm)] rounded-[var(--radius-md)] border-2
						{item.owned ? `${border} ${bg}` : item.locked ? 'border-gray-200 bg-gray-100' : `${border} bg-white`}
						{item.equipped ? 'ring-2 ring-[var(--theme-accent)]' : ''}
						transition-all relative"
					onclick={() => handleTap(item)}
				>
					<span class="text-3xl {item.locked && !item.owned ? 'grayscale opacity-50' : ''}">
						{item.icon}
					</span>
					<span class="text-xs font-bold truncate w-full text-center {item.locked && !item.owned ? 'text-[var(--color-text-muted)]' : ''}">
						{item.locked && !item.owned ? '???' : item.name}
					</span>
					{#if item.equipped}
						<span class="text-[10px] font-bold text-[var(--theme-accent)]">そうび中</span>
					{:else if item.owned}
						<span class="text-[10px] text-[var(--color-text-muted)]">もってる</span>
					{:else if item.locked}
						<span class="text-[10px] text-[var(--color-text-muted)]">🔒</span>
					{:else if item.price > 0}
						<span class="text-[10px] font-bold" style="color: var(--color-point);">{fmtBal(item.price)}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Back link -->
	<div class="mt-[var(--spacing-lg)] text-center">
		<a href="/kinder/status" class="text-sm text-[var(--color-text-muted)] underline">
			← つよさにもどる
		</a>
	</div>
</div>

<!-- Item detail dialog -->
<Dialog bind:open={dialogOpen} title="">
	{#if selectedItem}
		{@const border = rarityBorder[selectedItem.rarity] ?? 'border-gray-200'}
		{@const bg = rarityBg[selectedItem.rarity] ?? 'bg-gray-50'}
		<div class="flex flex-col items-center gap-[var(--spacing-md)] text-center">
			<!-- Preview -->
			<div
				class="w-24 h-24 rounded-[var(--radius-lg)] border-4 {selectedItem.owned || !selectedItem.locked
					? `${border} ${bg}`
					: 'border-gray-200 bg-gray-100'}
					flex items-center justify-center"
			>
				<span class="text-5xl {selectedItem.locked && !selectedItem.owned ? 'grayscale opacity-50' : ''}">
					{selectedItem.icon}
				</span>
			</div>

			<!-- Name -->
			<div>
				<p class="text-xl font-bold">
					{selectedItem.locked && !selectedItem.owned ? '???' : selectedItem.name}
				</p>
				{#if selectedItem.description && (selectedItem.owned || !selectedItem.locked)}
					<p class="text-sm text-[var(--color-text-muted)] mt-1">{selectedItem.description}</p>
				{/if}
			</div>

			<!-- Rarity -->
			<span class="text-xs font-bold px-3 py-1 rounded-full {bg} {border} border">
				{RARITY_LABELS[selectedItem.rarity as keyof typeof RARITY_LABELS] ?? 'ふつう'}
			</span>

			<!-- Lock reason -->
			{#if selectedItem.locked && !selectedItem.owned}
				<div class="px-3 py-2 rounded-[var(--radius-md)] bg-gray-50 w-full">
					<p class="text-sm font-bold text-[var(--color-text-muted)]">
						🔒 {selectedItem.lockReason ?? 'まだてにはいらないよ'}
					</p>
				</div>
			{/if}

			<!-- Actions -->
			{#if selectedItem.owned}
				{#if selectedItem.equipped}
					<form
						method="POST"
						action="?/unequip"
						use:enhance={() => {
							return async ({ result }) => {
								if (result.type === 'success') {
									dialogOpen = false;
									await invalidateAll();
								}
							};
						}}
					>
						<input type="hidden" name="category" value={selectedItem.category} />
						<button
							type="submit"
							class="px-6 py-2 rounded-full text-sm font-bold bg-gray-200 text-[var(--color-text-muted)]"
						>
							はずす
						</button>
					</form>
				{:else}
					<form
						method="POST"
						action="?/equip"
						use:enhance={() => {
							return async ({ result }) => {
								if (result.type === 'success') {
									dialogOpen = false;
									await invalidateAll();
								}
							};
						}}
					>
						<input type="hidden" name="itemId" value={selectedItem.id} />
						<input type="hidden" name="category" value={selectedItem.category} />
						<button
							type="submit"
							class="px-6 py-2 rounded-full text-sm font-bold text-white"
							style="background: var(--theme-accent);"
						>
							そうびする
						</button>
					</form>
				{/if}
			{:else if !selectedItem.locked && selectedItem.price > 0}
				<form
					method="POST"
					action="?/purchase"
					use:enhance={() => {
						return async ({ result }) => {
							if (result.type === 'success') {
								dialogOpen = false;
								await invalidateAll();
							}
						};
					}}
				>
					<input type="hidden" name="itemId" value={selectedItem.id} />
					<button
						type="submit"
						disabled={!selectedItem.canPurchase}
						class="px-6 py-2 rounded-full text-sm font-bold transition-colors
							{selectedItem.canPurchase
							? 'text-white'
							: 'bg-gray-200 text-[var(--color-text-muted)] cursor-not-allowed'}"
						style={selectedItem.canPurchase ? 'background: var(--color-point);' : ''}
					>
						{fmtBal(selectedItem.price)} で かう
					</button>
				</form>
				{#if !selectedItem.canPurchase && data.balance < selectedItem.price}
					<p class="text-xs text-red-400">{unit}がたりません（あと {fmtBal(selectedItem.price - data.balance)}）</p>
				{/if}
			{/if}
		</div>
	{/if}
</Dialog>
