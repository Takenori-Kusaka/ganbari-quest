<script lang="ts">
import { enhance } from '$app/forms';
import { FEATURES_LABELS } from '$lib/domain/labels';
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
			class="w-full flex items-center justify-between px-4 py-3 bg-[var(--color-neutral-100)] rounded-lg text-sm font-bold text-[var(--color-text-muted)] hover:bg-[var(--color-neutral-200)] transition-colors"
			onclick={() => showHidden = !showHidden}
		>
			<span>{FEATURES_LABELS.hiddenActivities.toggleLabel(activities.length)}</span>
			<span class="text-xs">{showHidden ? FEATURES_LABELS.hiddenActivities.closeIcon : FEATURES_LABELS.hiddenActivities.openIcon}</span>
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
								<p class="text-sm font-bold text-[var(--color-text-disabled)] truncate">{getActivityDisplayNameForAdult(activity)}</p>
								<p class="text-xs text-[var(--color-text-disabled)]">
									{getCategoryById(activity.categoryId)?.name ?? ''} / {activity.basePoints}P
									{#if logCount > 0}
										{FEATURES_LABELS.hiddenActivities.recordCount(logCount)}
									{/if}
								</p>
							</div>
							<div class="flex gap-1">
								<form method="POST" action="?/toggleVisibility" use:enhance>
									<input type="hidden" name="id" value={activity.id} />
									<input type="hidden" name="visible" value="true" />
									<button
										type="submit"
										class="px-2 py-1 rounded text-xs font-bold bg-[var(--color-brand-100)] text-[var(--color-action-primary)] hover:opacity-80 transition-colors"
									>
										{FEATURES_LABELS.hiddenActivities.restoreBtn}
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
											class="px-2 py-1 rounded text-xs font-bold bg-[var(--color-feedback-error-bg,#fef2f2)] text-[var(--color-action-danger)] hover:opacity-80 transition-colors"
										>
											{FEATURES_LABELS.hiddenActivities.permaDeleteBtn}
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
