<script lang="ts">
import { enhance } from '$app/forms';
import { FEATURES_LABELS } from '$lib/domain/labels';
import {
	type CategoryDef,
	getActivityDisplayNameForAdult,
	getCategoryById,
} from '$lib/domain/validation/activity';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import ActivityEditForm from './ActivityEditForm.svelte';
import type { ActivityItem } from './activity-types';

interface Props {
	activity: ActivityItem;
	categoryDefs: readonly CategoryDef[];
	logCount: number;
	isEditing: boolean;
	mainQuestCount: number;
	mainQuestMax: number;
	onedit: () => void;
	oncanceledit: () => void;
}

let {
	activity,
	categoryDefs,
	logCount,
	isEditing,
	mainQuestCount,
	mainQuestMax,
	onedit,
	oncanceledit,
}: Props = $props();

const category = $derived(getCategoryById(activity.categoryId));
const L = FEATURES_LABELS.activityListItem;

function dailyLimitLabel(val: number | null): string {
	if (val === null) return L.dailyLimitDefault;
	if (val === 0) return L.dailyLimitUnlimited;
	return L.dailyLimitN(val);
}
</script>

<div class="activity-list-item {activity.isVisible ? '' : 'opacity-50'} {activity.isMainQuest ? 'main-quest-active' : ''}">
	<div class="px-3 py-2 flex items-center gap-3">
		<CompoundIcon icon={activity.icon} size="md" />
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2 flex-wrap">
				<p class="text-sm font-bold truncate" style:color="var(--color-text)">{getActivityDisplayNameForAdult(activity)}</p>
				<span class="activity-points">{activity.basePoints}P</span>
				{#if activity.isMainQuest}
					<span class="main-quest-badge">{L.mainQuestBadge}</span>
				{/if}
			</div>
			<div class="activity-meta">
				{#if category}
					<span class="category-badge" style:background-color="{category.color}20" style:color={category.accent}>
						{category.icon} {category.name}
					</span>
				{/if}
				{#if activity.dailyLimit !== null}
					<span class="meta-item">{dailyLimitLabel(activity.dailyLimit)}</span>
				{/if}
				{#if activity.ageMin != null || activity.ageMax != null}
					<span class="meta-item">{L.ageRange(activity.ageMin ?? 0, activity.ageMax ?? 18)}</span>
				{/if}
			</div>
		</div>
		<div class="flex gap-1">
			<button
				type="button"
				class="px-2 py-1 rounded text-xs font-bold bg-[var(--color-neutral-100)] text-[var(--color-text-muted)] hover:bg-[var(--color-neutral-200)] transition-colors"
				onclick={() => isEditing ? oncanceledit() : onedit()}
			>
				{isEditing ? L.closeBtn : L.editBtn}
			</button>
			<form method="POST" action="?/toggleVisibility" use:enhance>
				<input type="hidden" name="id" value={activity.id} />
				<input type="hidden" name="visible" value={activity.isVisible ? 'false' : 'true'} />
				<button
					type="submit"
					class="px-2 py-1 rounded text-xs font-bold transition-colors
						{activity.isVisible ? 'bg-[var(--color-rarity-common-bg)] text-[var(--color-action-success)] hover:opacity-80' : 'bg-[var(--color-neutral-100)] text-[var(--color-text-disabled)] hover:bg-[var(--color-neutral-200)]'}"
				>
					{activity.isVisible ? L.visibleBtn : L.hiddenBtn}
				</button>
			</form>
			{#if activity.isVisible}
				<form method="POST" action="?/toggleMainQuest" use:enhance>
					<input type="hidden" name="id" value={activity.id} />
					<input type="hidden" name="enabled" value={activity.isMainQuest ? 'false' : 'true'} />
					<button
						type="submit"
						disabled={!activity.isMainQuest && mainQuestCount >= mainQuestMax}
						class="px-2 py-1 rounded text-xs font-bold transition-colors
							{activity.isMainQuest ? 'bg-[var(--color-surface-warning)] text-[var(--color-warning-text)] hover:opacity-80' : 'bg-[var(--color-neutral-100)] text-[var(--color-text-muted)] hover:bg-[var(--color-neutral-200)]'}
							disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{activity.isMainQuest ? L.mainQuestDisable : L.mainQuestEnable}
					</button>
				</form>
			{/if}
		</div>
	</div>

	{#if isEditing}
		<ActivityEditForm
			{activity}
			{categoryDefs}
			{logCount}
			onsaved={oncanceledit}
			oncancel={oncanceledit}
		/>
	{/if}
</div>

<style>
	.activity-list-item {
		background: var(--color-surface-card);
		border-radius: var(--radius-md, 0.5rem);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	.activity-points {
		display: inline-flex;
		align-items: center;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-point);
		background: linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 215, 0, 0.08));
		padding: 0.125rem 0.5rem;
		border-radius: var(--radius-full, 9999px);
		white-space: nowrap;
	}

	.activity-meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.25rem;
		flex-wrap: wrap;
	}

	.category-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		font-size: 0.625rem;
		font-weight: 600;
		padding: 0.0625rem 0.375rem;
		border-radius: var(--radius-full, 9999px);
		white-space: nowrap;
	}

	.meta-item {
		font-size: 0.625rem;
		color: var(--color-text-muted);
	}

	.main-quest-active {
		border: 2px solid var(--color-border-warning);
		background: linear-gradient(
			135deg,
			var(--color-feedback-warning-bg),
			var(--color-feedback-warning-bg-strong)
		);
	}

	.main-quest-badge {
		display: inline-flex;
		align-items: center;
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--color-warning-text);
		background: linear-gradient(
			135deg,
			var(--color-feedback-warning-bg-strong),
			var(--color-feedback-warning-bg)
		);
		padding: 0.0625rem 0.5rem;
		border-radius: var(--radius-full, 9999px);
		white-space: nowrap;
	}
</style>
