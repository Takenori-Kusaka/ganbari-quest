<script lang="ts">
// SiblingChallengeComparison.svelte
// 兄弟連動 challenge 進捗比較 (#2362 PR-7、ADR-0055、User §6、ADR-0012 Anti-engagement)
//
// 設計原則:
// - admin 画面でのみ表示 (親が把握する用、Anti-engagement)
// - 子供画面では使用しない (兄弟比較で煽らない)
// - 全員完了で簡素な祝福バナーのみ (連続演出禁止)
// - 同じ sourceTemplateId / (title + 期間) を共有する instance を比較

import { ADMIN_CHALLENGES_PAGE_LABELS } from '$lib/domain/labels';
import type { Child, ChildChallengeGroup } from '$lib/server/db/types';
import ProgressFill from '$lib/ui/components/ProgressFill.svelte';

interface Props {
	group: ChildChallengeGroup;
	children: Child[];
}

const { group, children }: Props = $props();

function childLabel(childId: number): string {
	const c = children.find((x) => x.id === childId);
	return c?.nickname ?? `#${childId}`;
}

// 進捗率 (0-100)
function progressPct(currentValue: number, targetValue: number): number {
	if (targetValue <= 0) return 0;
	return Math.min(100, Math.round((currentValue / targetValue) * 100));
}
</script>

<div
	class="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 space-y-2"
	data-testid="sibling-challenge-comparison"
	data-group-key={group.groupKey}
>
	<div class="flex items-center justify-between gap-2">
		<h4 class="text-xs font-semibold text-[var(--color-text-secondary)]">
			{ADMIN_CHALLENGES_PAGE_LABELS.siblingComparisonHeading}
		</h4>
		{#if group.allCompleted}
			<span
				class="rounded bg-[var(--color-feedback-success-bg-strong)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-feedback-success-text)]"
				data-testid="sibling-challenge-all-completed-badge"
			>
				{ADMIN_CHALLENGES_PAGE_LABELS.siblingComparisonAllCompleted}
			</span>
		{/if}
	</div>

	<ul class="space-y-1">
		{#each group.instances as instance (instance.id)}
			{@const pct = progressPct(instance.currentValue, instance.targetValue)}
			<li class="flex items-center gap-2" data-testid="sibling-challenge-row">
				<span class="text-xs font-medium text-[var(--color-text-primary)] w-20 truncate">
					{childLabel(instance.childId)}
				</span>
				<div class="flex-1 h-2 bg-[var(--color-surface-secondary)] rounded-full overflow-hidden">
					<ProgressFill
						pct={pct}
						class="h-full rounded-full transition-all {instance.completed === 1
							? 'bg-[var(--color-feedback-success-border)]'
							: 'bg-[var(--color-feedback-info-border)]'}"
					/>
				</div>
				<span
					class="text-[10px] text-[var(--color-text-muted)] w-14 text-right"
					data-testid="sibling-challenge-progress-text"
				>
					{instance.currentValue}/{instance.targetValue}
					{#if instance.completed === 1}✅{/if}
				</span>
			</li>
		{/each}
	</ul>

	{#if group.allCompleted}
		<p
			class="text-xs text-[var(--color-feedback-success-text)] mt-1"
			data-testid="sibling-challenge-all-completed-message"
		>
			{ADMIN_CHALLENGES_PAGE_LABELS.siblingComparisonAllCompletedMessage}
		</p>
	{/if}
</div>
