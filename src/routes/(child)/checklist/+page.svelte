<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { formatPointValueWithSign } from '$lib/domain/point-display';
import CelebrationEffect from '$lib/ui/components/CelebrationEffect.svelte';
import type { CelebrationType } from '$lib/ui/components/CelebrationEffect.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

let { data } = $props();

const celebEffect: CelebrationType = 'default';
const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

// 完了演出
let completeOpen = $state(false);
let completeData = $state<{ templateName: string; pointsAwarded: number } | null>(null);

const DAY_NAMES = [
	'にちようび',
	'げつようび',
	'かようび',
	'すいようび',
	'もくようび',
	'きんようび',
	'どようび',
];

const todayDayName = $derived(DAY_NAMES[new Date().getDay()]);

function handleCompleteClose() {
	completeOpen = false;
	completeData = null;
	invalidateAll();
}
</script>

<svelte:head>
	<title>もちものチェック - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--sp-sm)] py-[var(--sp-sm)]">
	<!-- Day of week header -->
	<div class="text-center mb-[var(--sp-md)]">
		<p class="text-sm text-[var(--color-text-muted)]">きょうは</p>
		<p class="text-lg font-bold">{todayDayName}</p>
	</div>

	{#if data.checklists.length === 0}
		<div class="flex flex-col items-center justify-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-md)]">📋</span>
			<p class="text-lg font-bold">チェックリストがないよ</p>
			<p class="text-sm">おやにおねがいしてね</p>
		</div>
	{:else}
		{#each data.checklists as checklist (checklist.templateId)}
			<div class="bg-white rounded-[var(--radius-lg)] shadow-sm border border-[var(--color-border)] mb-[var(--sp-md)] overflow-hidden">
				<!-- Template header -->
				<div class="px-[var(--sp-md)] py-[var(--sp-sm)] bg-[var(--theme-primary-light)] flex items-center justify-between">
					<div class="flex items-center gap-[var(--sp-xs)]">
						<span class="text-xl">{checklist.templateIcon}</span>
						<span class="font-bold">{checklist.templateName}</span>
					</div>
					<div class="text-sm">
						<span class="font-bold">{checklist.checkedCount}</span>
						<span class="text-[var(--color-text-muted)]">/ {checklist.totalCount}</span>
					</div>
				</div>

				<!-- Progress bar -->
				<div class="h-1.5 bg-gray-100">
					<div
						class="h-full bg-[var(--theme-primary)] transition-all duration-300"
						style="width: {checklist.totalCount > 0 ? (checklist.checkedCount / checklist.totalCount) * 100 : 0}%"
					></div>
				</div>

				<!-- Items -->
				<div class="divide-y divide-[var(--color-border)]">
					{#each checklist.items as item (item.id)}
						<form
							method="POST"
							action="?/toggle"
							use:enhance={() => {
								return async ({ result }) => {
									if (result.type === 'success' && result.data) {
										const d = result.data as {
											completedAll: boolean;
											pointsAwarded: number;
											newlyCompleted: boolean;
										};
										if (d.newlyCompleted) {
											soundService.playRecordComplete();
											completeData = {
												templateName: checklist.templateName,
												pointsAwarded: d.pointsAwarded,
											};
											completeOpen = true;
										} else {
											soundService.play('tap');
											invalidateAll();
										}
									}
								};
							}}
						>
							<input type="hidden" name="templateId" value={checklist.templateId} />
							<input type="hidden" name="itemId" value={item.id} />
							<input type="hidden" name="checked" value={item.checked ? '0' : '1'} />
							<button
								type="submit"
								class="tap-target w-full flex items-center gap-[var(--sp-sm)] px-[var(--sp-md)] py-[var(--sp-sm)] text-left transition-colors {item.checked ? 'bg-green-50' : 'hover:bg-gray-50'}"
							>
								<span class="text-2xl flex-shrink-0 {item.checked ? 'opacity-100' : 'opacity-30'}">
									{item.checked ? '✅' : '☐'}
								</span>
								<span class="flex-shrink-0"><CompoundIcon icon={item.icon} size="md" /></span>
								<span class="flex-1 font-medium {item.checked ? 'line-through text-[var(--color-text-muted)]' : ''}">
									{item.name}
								</span>
							</button>
						</form>
					{/each}
				</div>

				<!-- Footer: points info -->
				<div class="px-[var(--sp-md)] py-[var(--sp-xs)] bg-gray-50 text-center text-sm text-[var(--color-text-muted)]">
					{#if checklist.completedAll}
						<span class="text-[var(--theme-accent)] font-bold">🎉 ぜんぶできた！ {fmtPts(checklist.pointsAwarded)}</span>
					{:else}
						ぜんぶチェックしたら <span class="font-bold text-[var(--color-point)]">{fmtPts(checklist.totalCount * checklist.pointsPerItem + checklist.completionBonus)}</span>
					{/if}
				</div>
			</div>
		{/each}
	{/if}

	<!-- Back button -->
	<div class="text-center mt-[var(--sp-md)]">
		<a
			href="/{data.uiMode}/home"
			class="inline-block px-[var(--sp-lg)] py-[var(--sp-sm)] rounded-[var(--radius-md)] bg-gray-200 font-bold text-sm"
		>
			もどる
		</a>
	</div>
</div>

<!-- Complete overlay -->
<Dialog bind:open={completeOpen} closable={false} title="">
	{#if completeData}
		<div class="flex flex-col items-center gap-[var(--sp-md)] text-center py-[var(--sp-md)]">
			<div class="relative w-24 h-24 flex items-center justify-center">
				<CelebrationEffect type={celebEffect} />
			</div>
			<p class="text-lg font-bold">{completeData.templateName}<br />ぜんぶできたよ！</p>
			<div class="animate-point-pop">
				<p class="text-2xl font-bold text-[var(--color-point)]">+{completeData.pointsAwarded} ポイント！</p>
			</div>
			<p class="text-sm text-[var(--color-text-muted)]">わすれものなし！すごい！</p>
			<button
				class="tap-target w-full py-4 rounded-[var(--radius-md)] bg-[var(--theme-primary)] text-white font-bold text-lg"
				onclick={handleCompleteClose}
			>
				やったね！
			</button>
		</div>
	{/if}
</Dialog>
