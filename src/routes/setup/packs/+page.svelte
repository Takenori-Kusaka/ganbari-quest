<script lang="ts">
import { enhance } from '$app/forms';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let selectedPacks = $state<Set<string>>(new Set());
let submitting = $state(false);
let skipMode = $state(false);
let expandedPack = $state<string | null>(null);

function isRecommended(packAgeMin: number, packAgeMax: number): boolean {
	return packAgeMin <= data.childAgeMax && packAgeMax >= data.childAgeMin;
}

function togglePack(packId: string) {
	skipMode = false;
	const next = new Set(selectedPacks);
	if (next.has(packId)) {
		next.delete(packId);
	} else {
		next.add(packId);
	}
	selectedPacks = next;
}

function togglePreview(e: Event, packId: string) {
	e.stopPropagation();
	expandedPack = expandedPack === packId ? null : packId;
}

function selectSkip() {
	skipMode = true;
	selectedPacks = new Set();
}

// Category labels for preview
const categoryLabels: Record<string, string> = {
	undou: 'うんどう',
	benkyou: 'べんきょう',
	seikatsu: 'せいかつ',
	kouryuu: 'こうりゅう',
	souzou: 'そうぞう',
};

// Auto-select recommended packs on mount
$effect(() => {
	const recommended = new Set<string>();
	for (const pack of data.packs) {
		if (isRecommended(pack.targetAgeMin, pack.targetAgeMax)) {
			recommended.add(pack.packId);
		}
	}
	selectedPacks = recommended;
});
</script>

<svelte:head>
	<title>活動パック選択 - がんばりクエスト セットアップ</title>
</svelte:head>

<h2 class="text-lg font-bold text-gray-700 mb-2">かつどうパックをえらぼう</h2>
<p class="text-sm text-gray-500 mb-4">
	お子さまの年齢にあわせた活動セットを選んでください。あとから追加・変更できます。
</p>

<form
	method="POST"
	action="?/importPacks"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			submitting = false;
			await update();
		};
	}}
>
	<div class="flex flex-col gap-3 mb-4">
		{#each data.packs as pack (pack.packId)}
			{@const recommended = isRecommended(pack.targetAgeMin, pack.targetAgeMax)}
			{@const selected = selectedPacks.has(pack.packId)}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => togglePack(pack.packId)}
				class="relative w-full text-left p-4 rounded-xl border-2 h-auto items-start
					{selected
					? 'border-blue-500 bg-blue-50 shadow-sm'
					: 'border-gray-200 bg-white hover:border-gray-300'}"
			>
				{#if recommended}
					<span class="absolute -top-2 right-3 text-[10px] font-bold text-white bg-amber-500 rounded-full px-2 py-0.5">
						おすすめ
					</span>
				{/if}
				<div class="flex items-start gap-3">
					<span class="text-2xl mt-0.5">{pack.icon}</span>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2">
							<span class="text-sm font-bold text-gray-700">{pack.packName}</span>
							<span class="text-xs text-gray-400">{pack.activityCount}件</span>
						</div>
						<p class="text-xs text-gray-500 mt-1 line-clamp-2">{pack.description}</p>
						<div class="flex items-center gap-1 mt-2">
							{#each pack.tags as tag}
								<span class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{tag}</span>
							{/each}
							<button
								type="button"
								class="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 ml-auto"
								onclick={(e) => togglePreview(e, pack.packId)}
							>
								{expandedPack === pack.packId ? '▲ とじる' : '▼ なかみ'}
							</button>
						</div>
					</div>
					<div class="flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center mt-1
						{selected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}">
						{#if selected}
							<span class="text-white text-xs font-bold">&#10003;</span>
						{/if}
					</div>
				</div>
				{#if expandedPack === pack.packId && pack.activities?.length}
					<div class="mt-3 pt-3 border-t border-gray-100" onclick={(e) => e.stopPropagation()}>
						<div class="grid grid-cols-2 gap-1">
							{#each pack.activities as act}
								<div class="flex items-center gap-1 text-xs text-gray-600 py-0.5">
									<span>{act.icon}</span>
									<span class="truncate">{act.name}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
				{#if selected}
					<input type="hidden" name="packIds" value={pack.packId} />
				{/if}
			</Button>
		{/each}
	</div>

	<!-- Skip option -->
	<Button
		type="button"
		variant="ghost"
		size="sm"
		onclick={selectSkip}
		class="w-full text-left p-3 rounded-lg border-2 mb-4 h-auto
			{skipMode
			? 'border-gray-400 bg-gray-50'
			: 'border-gray-200 bg-white hover:border-gray-300'}"
	>
		<div class="flex items-center gap-2">
			<div class="w-5 h-5 rounded-full border-2 flex items-center justify-center
				{skipMode ? 'border-gray-500 bg-gray-500' : 'border-gray-300'}">
				{#if skipMode}
					<span class="text-white text-[10px] font-bold">&#10003;</span>
				{/if}
			</div>
			<span class="text-sm text-gray-600">おすすめパックを自動で追加してすすむ</span>
		</div>
	</Button>

	<!-- Navigation buttons -->
	<div class="flex gap-3">
		<a
			href="/setup/children"
			class="flex-1 py-2 text-center text-sm font-bold text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
		>
			&larr; もどる
		</a>
		{#if skipMode}
			<Button type="submit" formaction="?/skip" variant="primary" size="sm" disabled={submitting} class="flex-1">
				{submitting ? '処理中...' : 'おすすめで次へ'}
			</Button>
		{:else}
			<Button type="submit" variant="primary" size="sm" disabled={submitting || selectedPacks.size === 0} class="flex-1">
				{#if submitting}
					インポート中...
				{:else}
					{selectedPacks.size}件のパックを追加 &rarr;
				{/if}
			</Button>
		{/if}
	</div>
</form>
