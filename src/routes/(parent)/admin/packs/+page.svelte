<script lang="ts">
import { enhance } from '$app/forms';
import Button from '$lib/ui/primitives/Button.svelte';

let { data } = $props();

let expandedPack = $state<string | null>(null);
let importing = $state<string | null>(null);

const categoryLabels: Record<string, string> = {
	undou: 'うんどう',
	benkyou: 'べんきょう',
	seikatsu: 'せいかつ',
	kouryuu: 'こうりゅう',
	souzou: 'そうぞう',
};
</script>

<svelte:head>
	<title>活動パック - がんばりクエスト</title>
</svelte:head>

<div class="pb-6">
	<h1 class="text-lg font-bold text-gray-800 mb-1">活動パック</h1>
	<p class="text-sm text-gray-500 mb-4">
		年齢に合わせた活動セットをインポートできます。同じ名前の活動は自動的にスキップされます。
	</p>

	<div class="flex flex-col gap-4">
		{#each data.packs as pack (pack.packId)}
			<div
				class="rounded-xl border-2 overflow-hidden transition-colors
					{pack.isFullyImported
					? 'border-green-200 bg-green-50/50'
					: pack.isRecommended
						? 'border-amber-200 bg-amber-50/30'
						: 'border-gray-200 bg-white'}"
			>
				<!-- Pack header -->
				<button
					type="button"
					class="w-full text-left p-4"
					onclick={() => (expandedPack = expandedPack === pack.packId ? null : pack.packId)}
				>
					<div class="flex items-start gap-3">
						<span class="text-3xl">{pack.icon}</span>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="font-bold text-gray-800">{pack.packName}</span>
								<span class="text-xs text-gray-400">{pack.targetAgeMin}〜{pack.targetAgeMax}歳</span>
								{#if pack.isRecommended && !pack.isFullyImported}
									<span class="text-[10px] font-bold text-white bg-amber-500 rounded-full px-2 py-0.5">おすすめ</span>
								{/if}
								{#if pack.isFullyImported}
									<span class="text-[10px] font-bold text-green-700 bg-green-100 rounded-full px-2 py-0.5">インポート済</span>
								{:else if pack.importedCount > 0}
									<span class="text-[10px] font-bold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
										{pack.importedCount}/{pack.activityCount}件 登録済
									</span>
								{/if}
							</div>
							<p class="text-sm text-gray-500 mt-1">{pack.description}</p>
							<div class="flex gap-1 mt-2">
								{#each pack.tags as tag}
									<span class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{tag}</span>
								{/each}
								<span class="text-[10px] text-gray-400 ml-auto">
									{expandedPack === pack.packId ? '▲' : '▼'} {pack.activityCount}件の活動
								</span>
							</div>
						</div>
					</div>
				</button>

				<!-- Expanded content -->
				{#if expandedPack === pack.packId}
					<div class="px-4 pb-4 border-t border-gray-100">
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-3">
							{#each pack.activities as act}
								<div class="flex items-center gap-2 py-1 px-2 rounded text-sm
									{act.alreadyImported ? 'text-gray-400' : 'text-gray-700'}">
									<span>{act.icon}</span>
									<span class="truncate flex-1">{act.name}</span>
									<span class="text-[10px] text-gray-400">{categoryLabels[act.categoryCode] ?? act.categoryCode}</span>
									{#if act.alreadyImported}
										<span class="text-[10px] text-green-600">&#10003;</span>
									{/if}
								</div>
							{/each}
						</div>

						{#if !pack.isFullyImported}
							<form method="POST" action="?/importPack" use:enhance={() => {
								importing = pack.packId;
								return async ({ update }) => {
									importing = null;
									await update();
								};
							}}>
								<input type="hidden" name="packId" value={pack.packId} />
								<Button
									type="submit"
									variant="primary"
									size="sm"
									disabled={importing === pack.packId}
									class="w-full mt-3"
								>
									{#if importing === pack.packId}
										インポート中...
									{:else}
										{pack.activityCount - pack.importedCount}件の新しい活動をインポート
									{/if}
								</Button>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
