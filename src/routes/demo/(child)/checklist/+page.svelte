<script lang="ts">
// #704: デモ画面のもちものチェック (本番 src/routes/(child)/checklist/+page.svelte に相当)
// 書き込みは行わず、UI 操作はクライアント側の $state でのみ反映する。
import {
	APP_LABELS,
	CHECKLIST_KIND_ICONS,
	CHECKLIST_KIND_LABELS,
	type ChecklistKind,
	PAGE_TITLES,
} from '$lib/domain/labels';
import { formatPointValueWithSign } from '$lib/domain/point-display';
import { getScreenshotMode } from '$lib/features/demo/screenshot-mode.js';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const ps = $derived(data.pointSettings);
const fmtPts = (pts: number) => formatPointValueWithSign(pts, ps.mode, ps.currency, ps.rate);

// デモではローカル state でチェック ON/OFF を表現する。
// SSR 時も data.checklists をそのまま初期値に使い、childId 切替時に $effect で再同期する。
type DemoChecklist = (typeof data.checklists)[number];
// svelte-ignore state_referenced_locally
let localChecklists = $state<DemoChecklist[]>(structuredClone(data.checklists));

$effect(() => {
	// childId 切替時に data.checklists が変わったら再同期
	localChecklists = structuredClone(data.checklists);
});

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

// #1168: kind ごとにグループ表示（ルーティン → 持ち物 の順）
const kindOrder: ChecklistKind[] = ['routine', 'item'];
const groupedChecklists = $derived(
	kindOrder
		.map((kind) => ({
			kind,
			lists: localChecklists.filter((cl) => (cl.kind ?? 'routine') === kind),
		}))
		.filter((g) => g.lists.length > 0),
);

function toggleItem(templateId: number, itemId: number) {
	localChecklists = localChecklists.map((cl) => {
		if (cl.templateId !== templateId) return cl;
		const items = cl.items.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it));
		const checkedCount = items.filter((i) => i.checked).length;
		const completedAll = checkedCount === cl.totalCount && cl.totalCount > 0;
		return {
			...cl,
			items,
			checkedCount,
			completedAll,
			pointsAwarded: completedAll ? cl.totalCount * cl.pointsPerItem + cl.completionBonus : 0,
		};
	});
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.demoChildChecklist}{APP_LABELS.pageTitleSuffix}</title>
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

	<!-- デモ注意書き (LP SS 撮影時 (`?screenshot=1`) は非表示にする: #1164 / context 化 #1209) -->
	{#if !getScreenshotMode()}
		<div class="mb-[var(--sp-md)] p-[var(--sp-sm)] rounded-[var(--radius-md)] bg-[var(--color-surface-warning)] text-xs text-[var(--color-text-warm)] text-center">
			これはデモです。チェックは保存されません。
		</div>
	{/if}

	{#if localChecklists.length === 0}
		<div class="flex flex-col items-center justify-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-md)]">📋</span>
			<p class="text-lg font-bold">チェックリストがないよ</p>
			<p class="text-sm">おやにおねがいしてね</p>
		</div>
	{:else}
		{#each groupedChecklists as group (group.kind)}
			<h2
				class="text-sm font-bold text-[var(--color-text-muted)] mb-[var(--sp-xs)] mt-[var(--sp-md)] first:mt-0"
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
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="w-full flex items-center gap-[var(--sp-sm)] px-[var(--sp-md)] py-[var(--sp-sm)] text-left transition-colors {item.checked ? 'bg-[var(--color-feedback-success-bg)]' : 'hover:bg-[var(--color-surface-muted)]'}"
							onclick={() => toggleItem(checklist.templateId, item.id)}
							data-testid="demo-checklist-item-{item.id}"
						>
							<span class="text-2xl flex-shrink-0 {item.checked ? 'opacity-100' : 'opacity-30'}">
								{item.checked ? '✅' : '☐'}
							</span>
							<span class="flex-shrink-0"><CompoundIcon icon={item.icon} size="md" /></span>
							<span class="flex-1 font-medium {item.checked ? 'line-through text-[var(--color-text-muted)]' : ''}">
								{item.name}
							</span>
						</Button>
					{/each}
				</div>

				<!-- Footer: points info -->
				<div class="px-[var(--sp-md)] py-[var(--sp-xs)] bg-[var(--color-surface-muted)] text-center text-sm text-[var(--color-text-muted)]">
					{#if checklist.completedAll}
						<span class="text-[var(--theme-accent)] font-bold">🎉 ぜんぶできた！ {fmtPts(checklist.totalCount * checklist.pointsPerItem + checklist.completionBonus)}</span>
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
			href="/demo/{data.uiMode}/home?childId={data.child?.id ?? ''}"
			class="inline-block px-[var(--sp-lg)] py-[var(--sp-sm)] rounded-[var(--radius-md)] bg-[var(--color-surface-tertiary)] font-bold text-sm"
		>
			もどる
		</a>
	</div>
</div>
