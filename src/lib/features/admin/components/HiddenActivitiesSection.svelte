<script lang="ts">
import { enhance } from '$app/forms';
import { getActivityDisplayNameForAdult, getCategoryById } from '$lib/domain/validation/activity';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import type { ActivityItem } from './activity-types';

interface Props {
	activities: ActivityItem[];
	logCounts: Record<number, number>;
}

let { activities, logCounts }: Props = $props();

let showHidden = $state(false);
</script>

{#if activities.length > 0}
	<div class="mt-6">
		<button
			type="button"
			class="w-full flex items-center justify-between px-4 py-3 bg-[var(--color-surface-muted-strong)] rounded-lg text-sm font-bold text-[var(--color-text-muted)] hover:bg-[var(--color-neutral-200)] transition-colors"
			onclick={() => showHidden = !showHidden}
		>
			<span>非表示の活動 ({activities.length}件)</span>
			<span class="text-xs">{showHidden ? '▲ 閉じる' : '▼ 開く'}</span>
		</button>
		{#if showHidden}
			<div class="mt-2 space-y-1">
				{#each activities as activity (activity.id)}
					{@const logCount = logCounts[activity.id] ?? 0}
					<div class="bg-[var(--color-surface-muted)] rounded-lg shadow-sm border border-[var(--color-border-default)]">
						<div class="px-3 py-2 flex items-center gap-3">
							<div class="opacity-50">
								<CompoundIcon icon={activity.icon} size="md" />
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-bold text-[var(--color-text-muted)] truncate">{getActivityDisplayNameForAdult(activity)}</p>
								<p class="text-xs text-[var(--color-text-muted)]">
									{getCategoryById(activity.categoryId)?.name ?? ''} / {activity.basePoints}P
									{#if logCount > 0}
										/ 記録 {logCount}件
									{/if}
								</p>
							</div>
							<div class="flex gap-1">
								<form method="POST" action="?/toggleVisibility" use:enhance>
									<input type="hidden" name="id" value={activity.id} />
									<input type="hidden" name="visible" value="true" />
									<button
										type="submit"
										class="px-2 py-1 rounded text-xs font-bold bg-[var(--color-feedback-info-bg-strong)] text-[var(--color-brand-600)] hover:brightness-95 transition-all"
									>
										復活
									</button>
								</form>
								{#if logCount === 0}
									<form
										method="POST"
										action="?/delete"
										use:enhance={() => {
											return async ({ update }) => { await update(); };
										}}
									>
										<input type="hidden" name="id" value={activity.id} />
										<button
											type="submit"
											class="px-2 py-1 rounded text-xs font-bold bg-[var(--color-feedback-error-bg-strong)] text-[var(--color-feedback-error-text)] hover:brightness-95 transition-all"
										>
											完全削除
										</button>
									</form>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
