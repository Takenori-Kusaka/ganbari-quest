<script lang="ts">
import { enhance } from '$app/forms';
import { joinIcon, splitIcon } from '$lib/domain/icon-utils';
import { FEATURES_LABELS } from '$lib/domain/labels';
import type { CategoryDef } from '$lib/domain/validation/activity';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';
import { type ActivityItem, DAILY_LIMIT_OPTIONS, SUB_ICON_PRESETS } from './activity-types';

const L = FEATURES_LABELS.activityEditForm;

interface Props {
	activity: ActivityItem;
	categoryDefs: readonly CategoryDef[];
	logCount: number;
	onsaved: () => void;
	oncancel: () => void;
}

let { activity, categoryDefs, logCount, onsaved, oncancel }: Props = $props();

// svelte-ignore state_referenced_locally
const parsed = splitIcon(activity.icon);
// svelte-ignore state_referenced_locally
let editName = $state(activity.name);
// svelte-ignore state_referenced_locally
let editCategoryId = $state(activity.categoryId);
// svelte-ignore state_referenced_locally
let editMainIcon = $state(parsed.main);
// svelte-ignore state_referenced_locally
let editSubIcon = $state(parsed.sub ?? '');
const editIcon = $derived(joinIcon(editMainIcon, editSubIcon || null));
// svelte-ignore state_referenced_locally
let editPoints = $state(activity.basePoints);
// svelte-ignore state_referenced_locally
let editAgeMin = $state(activity.ageMin != null ? String(activity.ageMin) : '');
// svelte-ignore state_referenced_locally
let editAgeMax = $state(activity.ageMax != null ? String(activity.ageMax) : '');
// svelte-ignore state_referenced_locally
let editDailyLimit = $state<string>(activity.dailyLimit != null ? String(activity.dailyLimit) : '');
// svelte-ignore state_referenced_locally
let editNameKana = $state(activity.nameKana ?? '');
// svelte-ignore state_referenced_locally
let editNameKanji = $state(activity.nameKanji ?? '');
// svelte-ignore state_referenced_locally
let editTriggerHint = $state(activity.triggerHint ?? '');
let deleteConfirmId = $state<number | null>(null);
let actionMessage = $state('');
</script>

<div class="border-t px-3 py-3 space-y-3 bg-[var(--color-surface-muted)] rounded-b-lg">
	<form
		method="POST"
		action="?/edit"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'success') {
					onsaved();
				}
				await update();
			};
		}}
		class="space-y-3"
	>
		<input type="hidden" name="id" value={activity.id} />
		<div class="grid grid-cols-[1fr,auto] gap-2">
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">{L.nameLabel}</span>
				<input type="text" name="name" bind:value={editName} required class="w-full px-2 py-1.5 border rounded text-sm" />
			</label>
			<div>
				<span class="text-xs font-bold text-[var(--color-text-muted)]">{L.iconLabel}</span>
				<div class="flex gap-1 items-center mt-0.5">
					<input type="text" class="w-10 px-1 py-1.5 border rounded text-sm text-center"
						value={editMainIcon}
						oninput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) editMainIcon = v; }}
					/>
					<span class="text-xs text-[var(--color-text-disabled)]">+</span>
					<input type="text" class="w-10 px-1 py-1.5 border rounded text-sm text-center" placeholder={L.subIconPlaceholder}
						value={editSubIcon}
						oninput={(e) => { editSubIcon = (e.target as HTMLInputElement).value; }}
					/>
					<CompoundIcon icon={editIcon} size="md" />
				</div>
				<div class="flex flex-wrap gap-0.5 mt-1">
					<button type="button" class="w-7 h-7 rounded text-xs flex items-center justify-center {editSubIcon === '' ? 'bg-[var(--color-brand-100)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-neutral-100)]'}" onclick={() => editSubIcon = ''}>{L.subIconNoneBtn}</button>
					{#each SUB_ICON_PRESETS.slice(0, 8) as ic}
						<button type="button" class="w-7 h-7 rounded text-sm flex items-center justify-center {editSubIcon === ic ? 'bg-[var(--color-brand-100)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-neutral-100)]'}" onclick={() => editSubIcon = ic}>{ic}</button>
					{/each}
				</div>
				<input type="hidden" name="icon" value={editIcon} />
			</div>
		</div>
		<div class="grid grid-cols-2 gap-2">
			<NativeSelect
				name="categoryId"
				label={L.categoryLabel}
				bind:value={editCategoryId}
				options={categoryDefs.map((catDef) => ({ value: catDef.id, label: catDef.name }))}
			/>
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">{L.pointsLabel}</span>
				<input type="number" name="basePoints" bind:value={editPoints} min="1" max="100" class="w-full px-2 py-1.5 border rounded text-sm" />
			</label>
		</div>
		<div class="grid grid-cols-2 gap-2">
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">{L.ageMinLabel}</span>
				<input type="number" name="ageMin" bind:value={editAgeMin} min="0" max="18" class="w-full px-2 py-1.5 border rounded text-sm" placeholder={L.agePlaceholder} />
			</label>
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">{L.ageMaxLabel}</span>
				<input type="number" name="ageMax" bind:value={editAgeMax} min="0" max="18" class="w-full px-2 py-1.5 border rounded text-sm" placeholder={L.agePlaceholder} />
			</label>
		</div>
		<!-- dailyLimit -->
		<div>
			<span class="text-xs font-bold text-[var(--color-text-muted)]">{L.dailyLimitLabel}</span>
			<div class="flex gap-1 mt-1">
				{#each DAILY_LIMIT_OPTIONS as opt}
					<button
						type="button"
						class="flex-1 py-1 rounded text-xs font-bold transition-colors
							{editDailyLimit === opt.val ? 'bg-[var(--color-action-primary)] text-[var(--color-text-inverse)]' : 'bg-[var(--color-neutral-100)] text-[var(--color-text-muted)] hover:bg-[var(--color-neutral-200)]'}"
						onclick={() => editDailyLimit = opt.val}
					>
						{opt.label}
					</button>
				{/each}
			</div>
			<input type="hidden" name="dailyLimit" value={editDailyLimit} />
		</div>

		<!-- Hiragana / Kanji notation -->
		<div class="grid grid-cols-2 gap-2">
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">{L.nameKanaLabel}</span>
				<input type="text" name="nameKana" bind:value={editNameKana} class="w-full px-2 py-1.5 border rounded text-sm" placeholder={L.nameKanaPlaceholder} />
			</label>
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">{L.nameKanjiLabel}</span>
				<input type="text" name="nameKanji" bind:value={editNameKanji} class="w-full px-2 py-1.5 border rounded text-sm" placeholder={L.nameKanjiPlaceholder} />
			</label>
		</div>
		<!-- Trigger hint -->
		<label class="block">
			<span class="text-xs font-bold text-[var(--color-text-muted)]">{L.triggerHintLabel}</span>
			<input type="text" name="triggerHint" bind:value={editTriggerHint} maxlength="30" class="w-full px-2 py-1.5 border rounded text-sm" placeholder={L.triggerHintPlaceholder} />
			<span class="text-[10px] text-[var(--color-text-disabled)]">{L.triggerHintNote}</span>
		</label>
		<div class="flex gap-2">
			<button type="submit" class="flex-1 py-2 bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] rounded-lg font-bold text-sm hover:opacity-90 transition-colors">
				{L.saveBtn}
			</button>
			<button
				type="button"
				class="px-4 py-2 bg-[var(--color-feedback-error-bg,#fef2f2)] text-[var(--color-feedback-error-text,#dc2626)] rounded-lg font-bold text-sm hover:opacity-90 transition-colors"
				onclick={() => deleteConfirmId = deleteConfirmId === activity.id ? null : activity.id}
			>
				{L.deleteBtn}
			</button>
		</div>
	</form>

	<!-- Delete confirmation -->
	{#if deleteConfirmId === activity.id}
		<div class="bg-[var(--color-feedback-error-bg,#fef2f2)] border border-[var(--color-border-danger)] rounded-lg p-3 space-y-2">
			{#if logCount > 0}
				<p class="text-sm text-[var(--color-gold-700)] font-bold">{L.hasLogsHeading(logCount)}</p>
				<p class="text-xs text-[var(--color-warning)]">{L.hasLogsDesc}</p>
			{:else}
				<p class="text-sm text-[var(--color-action-danger)] font-bold">{L.confirmDeleteHeading}</p>
				<p class="text-xs text-[var(--color-action-danger)]">{L.confirmDeleteDesc}</p>
			{/if}
			<div class="flex gap-2">
				<form
					method="POST"
					action="?/delete"
					class="flex-1"
					use:enhance={() => {
						return async ({ result, update }) => {
							if (result.type === 'success') {
								onsaved();
								deleteConfirmId = null;
								if (result.data && 'hidden' in result.data) {
									actionMessage = L.hiddenMessage;
									setTimeout(() => { actionMessage = ''; }, 5000);
								}
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="id" value={activity.id} />
					<button type="submit" class="w-full py-2 {logCount > 0 ? 'bg-[var(--color-warning)] hover:opacity-90' : 'bg-[var(--color-action-danger)] hover:opacity-90'} text-[var(--color-text-inverse)] rounded-lg font-bold text-sm transition-colors">
						{logCount > 0 ? L.hideBtn : L.hardDeleteBtn}
					</button>
				</form>
				<button
					type="button"
					class="flex-1 py-2 bg-[var(--color-neutral-200)] rounded-lg font-bold text-sm hover:bg-[var(--color-neutral-300)] transition-colors"
					onclick={() => deleteConfirmId = null}
				>
					{L.cancelBtn}
				</button>
			</div>
		</div>
	{/if}
</div>
