<script lang="ts">
import { enhance } from '$app/forms';
import { joinIcon, splitIcon } from '$lib/domain/icon-utils';
import {
	APP_LABELS,
	ACTIVITY_FORM_LABELS as L,
	ACTIVITY_PRIORITY_FORM_LABELS as P,
	PAGE_TITLES,
} from '$lib/domain/labels';
import {
	DAILY_LIMIT_OPTIONS,
	SUB_ICON_PRESETS,
} from '$lib/features/admin/components/activity-types';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();

const a = $derived(data.activity);
// svelte-ignore state_referenced_locally
const parsed = splitIcon(data.activity.icon);

let editName = $state(a.name);
let editCategoryId = $state(a.categoryId);
let editMainIcon = $state(parsed.main);
let editSubIcon = $state(parsed.sub ?? '');
const editIcon = $derived(joinIcon(editMainIcon, editSubIcon || null));
let editPoints = $state(a.basePoints);
let editAgeMin = $state(a.ageMin != null ? String(a.ageMin) : '');
let editAgeMax = $state(a.ageMax != null ? String(a.ageMax) : '');
let editDailyLimit = $state<string>(a.dailyLimit != null ? String(a.dailyLimit) : '');
let editNameKana = $state(a.nameKana ?? '');
let editNameKanji = $state(a.nameKanji ?? '');
let editTriggerHint = $state(a.triggerHint ?? '');
// #1756 (#1709-B): must トグル
let editIsMust = $state(a.priority === 'must');
let saving = $state(false);
</script>

<svelte:head>
	<title>{P.editPageTitle}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-bold">{P.editPageTitle}</h1>
		<a
			href="/admin/activities"
			class="text-xs text-[var(--color-text-link)] hover:underline"
			data-testid="activity-edit-back"
		>
			{P.editBackButton}
		</a>
	</div>

	{#if form?.error}
		<div class="rounded-md bg-[var(--color-feedback-error-bg)] border border-[var(--color-feedback-error-border)] p-3 text-sm text-[var(--color-feedback-error-text)]">
			{form.error}
		</div>
	{/if}

	<Card padding="md">
		{#snippet children()}
		<form
			method="POST"
			action="?/save"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
				};
			}}
			class="space-y-4"
		>
			<!-- #1756 (#1709-B): 「今日のおやくそく」トグル — must / optional 切替 -->
			<div
				class="rounded-md border border-[var(--color-border-warning)] bg-[var(--color-feedback-warning-bg)] p-3 space-y-1"
				data-testid="must-toggle-section"
			>
				<label class="flex items-start gap-2 cursor-pointer">
					<input
						type="checkbox"
						name="priority"
						value="must"
						bind:checked={editIsMust}
						class="mt-1 size-4 cursor-pointer accent-[var(--color-warning)]"
						data-testid="must-toggle-checkbox"
					/>
					<div class="flex-1">
						<span class="font-bold text-sm text-[var(--color-feedback-warning-text)]">
							{P.toggleLabel}
						</span>
						<p class="text-xs text-[var(--color-text-warm-muted)] mt-1 leading-relaxed">
							{P.toggleHint}
						</p>
					</div>
				</label>
			</div>

			<!-- 名前 -->
			<FormField label={L.editNameLabel} type="text" name="name" bind:value={editName} required />

			<!-- アイコン -->
			<div>
				<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.editIconLabel}</span>
				<div class="flex gap-1 items-center">
					<input type="text" class="w-10 px-1 py-1.5 border rounded text-sm text-center"
						value={editMainIcon}
						oninput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) editMainIcon = v; }}
					/>
					<span class="text-xs text-[var(--color-text-disabled)]">{L.editIconJoiner}</span>
					<input type="text" class="w-10 px-1 py-1.5 border rounded text-sm text-center" placeholder={L.editIconSubPlaceholder}
						value={editSubIcon}
						oninput={(e) => { editSubIcon = (e.target as HTMLInputElement).value; }}
					/>
					<CompoundIcon icon={editIcon} size="md" />
				</div>
				<div class="flex flex-wrap gap-0.5 mt-1">
					<button type="button" class="w-7 h-7 rounded text-xs flex items-center justify-center {editSubIcon === '' ? 'bg-[var(--color-brand-100)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-neutral-100)]'}" onclick={() => editSubIcon = ''}>{L.subIconNoneOption}</button>
					{#each SUB_ICON_PRESETS.slice(0, 8) as ic}
						<button type="button" class="w-7 h-7 rounded text-sm flex items-center justify-center {editSubIcon === ic ? 'bg-[var(--color-brand-100)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-neutral-100)]'}" onclick={() => editSubIcon = ic}>{ic}</button>
					{/each}
				</div>
				<input type="hidden" name="icon" value={editIcon} />
			</div>

			<!-- カテゴリ + ポイント -->
			<div class="grid grid-cols-2 gap-2">
				<NativeSelect
					name="categoryId"
					label={L.categoryLabel}
					bind:value={editCategoryId}
					options={data.categoryDefs.map((catDef) => ({ value: catDef.id, label: catDef.name }))}
				/>
				<FormField label={L.editPointsLabel} type="number" name="basePoints" bind:value={editPoints} min="1" max="100" />
			</div>

			<!-- 年齢 -->
			<div class="grid grid-cols-2 gap-2">
				<FormField label={L.editAgeMinLabel} type="number" name="ageMin" bind:value={editAgeMin} min="0" max="18" placeholder={L.editAgePlaceholderNone} />
				<FormField label={L.editAgeMaxLabel} type="number" name="ageMax" bind:value={editAgeMax} min="0" max="18" placeholder={L.editAgePlaceholderNone} />
			</div>

			<!-- 1日の制限 -->
			<div>
				<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.dailyLimitLabel}</span>
				<div class="flex gap-1">
					{#each DAILY_LIMIT_OPTIONS as opt}
						<Button
							type="button"
							variant={editDailyLimit === opt.val ? 'primary' : 'ghost'}
							size="sm"
							class={editDailyLimit === opt.val
								? 'flex-1'
								: 'flex-1 bg-[var(--color-neutral-100)] text-[var(--color-text-muted)] hover:bg-[var(--color-neutral-200)]'}
							onclick={() => editDailyLimit = opt.val}
						>
							{opt.label}
						</Button>
					{/each}
				</div>
				<input type="hidden" name="dailyLimit" value={editDailyLimit} />
			</div>

			<!-- かな・漢字 -->
			<div class="grid grid-cols-2 gap-2">
				<FormField label={L.editNameKanaLabel} type="text" name="nameKana" bind:value={editNameKana} placeholder={L.editKanaPlaceholderOptional} />
				<FormField label={L.editNameKanjiLabel} type="text" name="nameKanji" bind:value={editNameKanji} placeholder={L.editKanaPlaceholderOptional} />
			</div>

			<!-- トリガーヒント -->
			<FormField label={L.editTriggerHintLabel} type="text" name="triggerHint" bind:value={editTriggerHint} maxlength={30} placeholder={L.editTriggerHintPlaceholder} hint={L.editTriggerHintNote} />

			<div class="flex gap-2 pt-2">
				<Button type="submit" variant="primary" size="md" class="flex-1" disabled={saving} data-testid="activity-edit-save">
					{P.editSaveButton}
				</Button>
				<a
					href="/admin/activities"
					class="px-4 py-2 rounded-lg font-bold text-sm bg-[var(--color-neutral-100)] text-[var(--color-text-muted)] hover:bg-[var(--color-neutral-200)] transition-colors flex items-center"
				>
					{P.editBackButton}
				</a>
			</div>
		</form>
		{/snippet}
	</Card>
</div>
