<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import {
	CHECKLIST_KIND_ICONS,
	CHECKLIST_KIND_LABELS,
	type ChecklistKind,
} from '$lib/domain/labels';
import { formatPointValueWithSign } from '$lib/domain/point-display';
import type { CelebrationType } from '$lib/ui/components/CelebrationEffect.svelte';
import CelebrationEffect from '$lib/ui/components/CelebrationEffect.svelte';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
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

// 時間帯ラベル
const TIME_SLOT_LABELS: Record<string, string> = {
	morning: 'あさ',
	afternoon: 'ひる',
	evening: 'よる',
	anytime: 'いつでも',
};
const TIME_SLOT_ICONS: Record<string, string> = {
	morning: '☀️',
	afternoon: '🌤️',
	evening: '🌙',
	anytime: '🕐',
};
const currentSlot = $derived(data.currentTimeSlot ?? 'morning');
function isCurrentSlot(slot: string): boolean {
	return slot === currentSlot || slot === 'anytime';
}

function handleCompleteClose() {
	completeOpen = false;
	completeData = null;
	invalidateAll();
}

// #1168: 種別ごとにグルーピング（ルーティンを先に表示）
const kindOrder: ChecklistKind[] = ['routine', 'item'];
const groupedChecklists = $derived(
	kindOrder
		.map((kind) => ({
			kind,
			lists: data.checklists.filter((cl) => (cl.kind ?? 'routine') === kind),
		}))
		.filter((g) => g.lists.length > 0),
);
</script>

<svelte:head>
	<title>もちものチェック - がんばりクエスト</title>
</svelte:head>

<div class="px-[var(--sp-sm)] py-[var(--sp-sm)]">
	<!-- Day of week header -->
	<div class="text-center mb-[var(--sp-md)]">
		<p class="text-sm text-[var(--color-text-muted)]">きょうは</p>
		<p class="text-lg font-bold">{todayDayName}</p>
		<p class="text-sm text-[var(--color-text-muted)]">
			{TIME_SLOT_ICONS[currentSlot]} いまは <span class="font-bold">{TIME_SLOT_LABELS[currentSlot]}</span> のじかん
		</p>
	</div>

	{#if data.checklists.length === 0}
		<div class="flex flex-col items-center justify-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-md)]">📋</span>
			<p class="text-lg font-bold">チェックリストがないよ</p>
			<p class="text-sm">おやにおねがいしてね</p>
		</div>
	{:else}
		{#each groupedChecklists as group (group.kind)}
			<!-- #1168: 種別見出し -->
			<h2
				class="text-base font-bold mt-[var(--sp-md)] mb-[var(--sp-xs)] px-[var(--sp-xs)] text-[var(--color-text-secondary)]"
				data-testid="checklist-group-{group.kind}"
			>
				{CHECKLIST_KIND_ICONS[group.kind]} {CHECKLIST_KIND_LABELS[group.kind]}
			</h2>
			{#each group.lists as checklist (checklist.templateId)}
			<Card padding="none" class="mb-[var(--sp-md)] {isCurrentSlot(checklist.timeSlot) ? 'ring-2 ring-[var(--theme-primary)]' : 'opacity-70'}">
				{#snippet children()}
				<!-- Template header -->
				<div class="px-[var(--sp-md)] py-[var(--sp-sm)] bg-[var(--theme-primary-light)] flex items-center justify-between">
					<div class="flex items-center gap-[var(--sp-xs)]">
						<span class="text-xl">{checklist.templateIcon}</span>
						<span class="font-bold">{checklist.templateName}</span>
						{#if checklist.timeSlot !== 'anytime'}
							<span class="text-xs px-1.5 py-0.5 bg-white/50 rounded">{TIME_SLOT_ICONS[checklist.timeSlot]} {TIME_SLOT_LABELS[checklist.timeSlot]}</span>
						{/if}
					</div>
					<div class="text-sm">
						<span class="font-bold">{checklist.checkedCount}</span>
						<span class="text-[var(--color-text-muted)]">/ {checklist.totalCount}</span>
					</div>
				</div>

				<!-- Progress bar -->
				<div class="h-1.5 bg-[var(--color-surface-secondary)]">
					<div
						class="h-full bg-[var(--theme-primary)] transition-all duration-300"
						style:width="{checklist.totalCount > 0 ? (checklist.checkedCount / checklist.totalCount) * 100 : 0}%"
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
							<Button
								type="submit"
								variant="ghost"
								size="sm"
								class="w-full flex items-center gap-[var(--sp-sm)] px-[var(--sp-md)] py-[var(--sp-sm)] text-left transition-colors {item.checked ? 'bg-[var(--color-feedback-success-bg)]' : 'hover:bg-[var(--color-surface-muted)]'}"
							>
								<span class="text-2xl flex-shrink-0 {item.checked ? 'opacity-100' : 'opacity-30'}">
									{item.checked ? '✅' : '☐'}
								</span>
								<span class="flex-shrink-0"><CompoundIcon icon={item.icon} size="md" /></span>
								<span class="flex-1 font-medium {item.checked ? 'line-through text-[var(--color-text-muted)]' : ''}">
									{item.name}
								</span>
							</Button>
						</form>
					{/each}
				</div>

				<!-- Footer: points info -->
				<div class="px-[var(--sp-md)] py-[var(--sp-xs)] bg-[var(--color-surface-muted)] text-center text-sm text-[var(--color-text-muted)]">
					{#if checklist.completedAll}
						<span class="text-[var(--theme-accent)] font-bold">🎉 ぜんぶできた！ {fmtPts(checklist.pointsAwarded)}</span>
					{:else}
						ぜんぶチェックしたら <span class="font-bold text-[var(--color-point)]">{fmtPts(checklist.totalCount * checklist.pointsPerItem + checklist.completionBonus)}</span>
					{/if}
				</div>
				{/snippet}
			</Card>
			{/each}
		{/each}
	{/if}

	<!-- Back button -->
	<div class="text-center mt-[var(--sp-md)]">
		<a
			href="/{data.uiMode}/home"
			class="inline-block px-[var(--sp-lg)] py-[var(--sp-sm)] rounded-[var(--radius-md)] bg-[var(--color-surface-tertiary)] font-bold text-sm"
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
			<Button variant="primary" size="lg" class="w-full" onclick={handleCompleteClose}>
				やったね！
			</Button>
		</div>
	{/if}
</Dialog>
