<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { jstDayOfWeek } from '$lib/domain/date-utils';
import {
	APP_LABELS,
	CHILD_CHECKLIST_TIME_SLOT_ICONS,
	getChildChecklistLabels,
	getChildNavModeLabels,
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

// #4509 ④: 年齢帯文言は labels SSOT の getChildChecklistLabels に集約する。
// 本 route は `[uiMode]` パラメータ配下ではないが、年齢帯は `(child)/+layout.server.ts` が
// 解決済みの `data.uiMode` から受け取れる (route を動かさなくても context は届く)。
// 画面側に `if (uiMode === ...)` を書かない (`src/routes/CLAUDE.md` §年齢帯 variant)。
const t = $derived(getChildChecklistLabels({ ageTier: data.uiMode }));
// #4715: <title> を年齢帯に追従させる (nav ラベルと同じ SSOT から引く)。
const navLabels = $derived(getChildNavModeLabels(data.uiMode));

// 曜日は JST SSOT 経由 (#4015)。ローカル getter だと SSR (UTC Lambda) が JST 00:00〜09:00 に
// 前日の曜日を描画し、hydration で切り替わる (子供画面に誤情報 + ちらつき)。
const todayDayName = $derived(t.dayNames[jstDayOfWeek()]);

const currentSlot = $derived(data.currentTimeSlot ?? 'morning');
function isCurrentSlot(slot: string): boolean {
	return slot === currentSlot || slot === 'anytime';
}

function handleCompleteClose() {
	completeOpen = false;
	completeData = null;
	invalidateAll();
}

// #1755 (#1709-A): kind 削除 — 持ち物純化（旧 'routine' は activities.priority='must' に役割移管）
//   グルーピング解除。後続 sub-issue (#1709-C) で「今日のおやくそく」セクションを別途追加する。
const flatChecklists = $derived(data.checklists);
</script>

<svelte:head>
	<title>{navLabels.checklist}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="px-[var(--sp-sm)] py-[var(--sp-sm)]">
	<!-- Day of week header -->
	<div class="text-center mb-[var(--sp-md)]">
		<p class="text-sm text-[var(--color-text-muted)]">{t.todayPrefix}</p>
		<p class="text-lg font-bold">{todayDayName}</p>
		<p class="text-sm text-[var(--color-text-muted)]">
			{CHILD_CHECKLIST_TIME_SLOT_ICONS[currentSlot]} {t.nowPrefix} <span class="font-bold">{t.timeSlotLabels[currentSlot]}</span> {t.nowSuffix}
		</p>
	</div>

	{#if data.checklists.length === 0}
		<div class="flex flex-col items-center justify-center py-[var(--sp-2xl)] text-[var(--color-text-muted)]">
			<span class="text-4xl mb-[var(--sp-md)]">📋</span>
			<p class="text-lg font-bold">{t.emptyTitle}</p>
			<p class="text-sm">{t.emptyDesc}</p>
		</div>
	{:else}
		<!-- #1755 (#1709-A): kind 削除 — グルーピング解除、持ち物として一覧表示 -->
		{#each flatChecklists as checklist (checklist.templateId)}
			<Card padding="none" class="mb-[var(--sp-md)] {isCurrentSlot(checklist.timeSlot) ? 'ring-2 ring-[var(--theme-primary)]' : 'opacity-70'}">
				{#snippet children()}
				<!-- Template header -->
				<div class="px-[var(--sp-md)] py-[var(--sp-sm)] bg-[var(--theme-primary-light)] flex items-center justify-between">
					<div class="flex items-center gap-[var(--sp-xs)]">
						<span class="text-xl">{checklist.templateIcon}</span>
						<span class="font-bold">{checklist.templateName}</span>
						{#if checklist.timeSlot !== 'anytime'}
							<span class="text-xs px-1.5 py-0.5 bg-white/50 rounded">{CHILD_CHECKLIST_TIME_SLOT_ICONS[checklist.timeSlot]} {t.timeSlotLabels[checklist.timeSlot]}</span>
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
							data-testid="checklist-item-{item.id}"
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
						<span class="text-[var(--theme-accent)] font-bold">{t.completedAll} {fmtPts(checklist.pointsAwarded)}</span>
					{:else}
						{t.checkForPoints} <span class="font-bold text-[var(--color-point)]">{fmtPts(checklist.totalCount * checklist.pointsPerItem + checklist.completionBonus)}</span>
					{/if}
				</div>
				{/snippet}
			</Card>
		{/each}
	{/if}

	<!-- #2196: 「もどる」ボタン撤去 — BottomNav と動線重複 + 他 child タブ (achievements / battle / history / status / shop) 統一性 (ADR-0012 anti-engagement) -->
</div>

<!-- Complete overlay -->
<Dialog bind:open={completeOpen} closable={false} title="">
	{#if completeData}
		<div class="flex flex-col items-center gap-[var(--sp-md)] text-center py-[var(--sp-md)]">
			<div class="relative w-24 h-24 flex items-center justify-center">
				<CelebrationEffect type={celebEffect} />
			</div>
			<p class="text-lg font-bold">{completeData.templateName}<br />{t.completeTitle}</p>
			<div class="animate-point-pop">
				<!-- #4509 ③: フッターと同じ fmtPts を通す (換算非経由の生ポイント表示を根絶) -->
				<p class="text-2xl font-bold text-[var(--color-point)]" data-testid="checklist-complete-points">{fmtPts(completeData.pointsAwarded)}</p>
			</div>
			<p class="text-sm text-[var(--color-text-muted)]">{t.completeMsg}</p>
			<Button variant="primary" size="lg" class="w-full" onclick={handleCompleteClose}>
				{t.completeButton}
			</Button>
		</div>
	{/if}
</Dialog>
