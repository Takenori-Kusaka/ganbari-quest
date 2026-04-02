<script lang="ts">
import { enhance } from '$app/forms';
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
	onedit: () => void;
	oncanceledit: () => void;
}

let { activity, categoryDefs, logCount, isEditing, onedit, oncanceledit }: Props = $props();

function dailyLimitLabel(val: number | null): string {
	if (val === null) return '1回/日';
	if (val === 0) return '無制限';
	return `${val}回/日`;
}
</script>

<div class="bg-white rounded-lg shadow-sm {activity.isVisible ? '' : 'opacity-50'}">
	<div class="px-3 py-2 flex items-center gap-3">
		<CompoundIcon icon={activity.icon} size="md" />
		<div class="flex-1 min-w-0">
			<p class="text-sm font-bold text-gray-700 truncate">{getActivityDisplayNameForAdult(activity)}</p>
			<p class="text-xs text-gray-400">
				{getCategoryById(activity.categoryId)?.name ?? ''} / {activity.basePoints}P
				{#if activity.dailyLimit !== null}
					/ {dailyLimitLabel(activity.dailyLimit)}
				{/if}
				{#if activity.ageMin != null || activity.ageMax != null}
					/ {activity.ageMin ?? 0}-{activity.ageMax ?? 18}歳
				{/if}
			</p>
		</div>
		<div class="flex gap-1">
			<button
				type="button"
				class="px-2 py-1 rounded text-xs font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
				onclick={() => isEditing ? oncanceledit() : onedit()}
			>
				{isEditing ? '閉じる' : '編集'}
			</button>
			<form method="POST" action="?/toggleVisibility" use:enhance>
				<input type="hidden" name="id" value={activity.id} />
				<input type="hidden" name="visible" value={activity.isVisible ? 'false' : 'true'} />
				<button
					type="submit"
					class="px-2 py-1 rounded text-xs font-bold transition-colors
						{activity.isVisible ? 'bg-green-100 text-green-600 hover:bg-green-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}"
				>
					{activity.isVisible ? '表示' : '非表示'}
				</button>
			</form>
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
