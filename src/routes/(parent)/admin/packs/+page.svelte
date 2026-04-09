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
	<h1 class="text-lg font-bold text-[var(--color-text)] mb-1">活動パック</h1>
	<p class="text-sm text-[var(--color-text-muted)] mb-4">
		年齢に合わせた活動セットをインポートできます。同じ名前の活動は自動的にスキップされます。
	</p>

	<div class="flex flex-col gap-4">
		{#each data.packs as pack (pack.packId)}
			<div
				class="rounded-xl border-2 overflow-hidden transition-colors
					{pack.isFullyImported
					? 'border-[var(--color-feedback-success-border)] bg-[var(--color-feedback-success-bg)]'
					: pack.isRecommended
						? 'border-[var(--color-feedback-warning-border)] bg-[var(--color-feedback-warning-bg)]'
						: 'border-[var(--color-border)] bg-white'}"
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
								<span class="font-bold text-[var(--color-text)]">{pack.packName}</span>
								<span class="text-xs text-[var(--color-text-tertiary)]">{pack.targetAgeMin}〜{pack.targetAgeMax}歳</span>
								{#if pack.isRecommended && !pack.isFullyImported}
									<span class="text-[10px] font-bold text-white bg-[var(--color-stat-amber)] rounded-full px-2 py-0.5">おすすめ</span>
								{/if}
								{#if pack.isFullyImported}
									<span class="text-[10px] font-bold text-[var(--color-feedback-success-text)] bg-[var(--color-feedback-success-bg-strong)] rounded-full px-2 py-0.5">インポート済</span>
								{:else if pack.importedCount > 0}
									<span class="text-[10px] font-bold text-[var(--color-feedback-info-text)] bg-[var(--color-feedback-info-bg-strong)] rounded-full px-2 py-0.5">
										{pack.importedCount}/{pack.activityCount}件 登録済
									</span>
								{/if}
							</div>
							<p class="text-sm text-[var(--color-text-muted)] mt-1">{pack.description}</p>
							<div class="flex gap-1 mt-2">
								{#each pack.tags as tag}
									<span class="text-[10px] px-1.5 py-0.5 bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] rounded">{tag}</span>
								{/each}
								<span class="text-[10px] text-[var(--color-text-tertiary)] ml-auto">
									{expandedPack === pack.packId ? '▲' : '▼'} {pack.activityCount}件の活動
								</span>
							</div>
						</div>
					</div>
				</button>

				<!-- Expanded content -->
				{#if expandedPack === pack.packId}
					<div class="px-4 pb-4 border-t border-[var(--color-border-light)]">
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-3">
							{#each pack.activities as act}
								<div class="flex items-center gap-2 py-1 px-2 rounded text-sm
									{act.alreadyImported ? 'text-[var(--color-text-tertiary)]' : 'text-[var(--color-text-primary)]'}">
									<span>{act.icon}</span>
									<span class="truncate flex-1">{act.name}</span>
									<span class="text-[10px] text-[var(--color-text-tertiary)]">{categoryLabels[act.categoryCode] ?? act.categoryCode}</span>
									{#if act.alreadyImported}
										<span class="text-[10px] text-[var(--color-feedback-success-text)]">&#10003;</span>
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
