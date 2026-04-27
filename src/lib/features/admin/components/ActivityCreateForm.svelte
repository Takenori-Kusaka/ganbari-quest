<script lang="ts">
import { enhance } from '$app/forms';
import { joinIcon } from '$lib/domain/icon-utils';
import { FEATURES_LABELS } from '$lib/domain/labels';
import { type CategoryDef, getCategoryById } from '$lib/domain/validation/activity';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import {
	CATEGORY_INFO,
	DAILY_LIMIT_OPTIONS,
	POINT_GUIDE,
	SUB_ICON_PRESETS,
} from './activity-types';

const L = FEATURES_LABELS.activityCreateForm;

interface Props {
	categoryDefs: readonly CategoryDef[];
	/** Pre-filled form values (e.g. from AI suggestion) */
	initialName?: string;
	initialCategoryId?: number;
	initialMainIcon?: string;
	initialSubIcon?: string;
	initialPoints?: number;
	initialNameKana?: string;
	initialNameKanji?: string;
	oncreated: () => void;
}

let {
	categoryDefs,
	initialName = '',
	initialCategoryId = 1,
	initialMainIcon = '🤸',
	initialSubIcon = '',
	initialPoints = 5,
	initialNameKana = '',
	initialNameKanji = '',
	oncreated,
}: Props = $props();

// svelte-ignore state_referenced_locally
let formName = $state(initialName);
// svelte-ignore state_referenced_locally
let formCategoryId = $state(initialCategoryId);
// svelte-ignore state_referenced_locally
let formMainIcon = $state(initialMainIcon);
// svelte-ignore state_referenced_locally
let formSubIcon = $state(initialSubIcon);
const formIcon = $derived(joinIcon(formMainIcon, formSubIcon || null));
// svelte-ignore state_referenced_locally
let formPoints = $state(initialPoints);
let formAgeMin = $state('');
let formAgeMax = $state('');
let formDailyLimit = $state<string>('');
// svelte-ignore state_referenced_locally
let formNameKana = $state(initialNameKana);
// svelte-ignore state_referenced_locally
let formNameKanji = $state(initialNameKanji);
let formTriggerHint = $state('');

// Sync initial values when they change (e.g. AI suggestion accepted)
$effect(() => {
	formName = initialName;
});
$effect(() => {
	formCategoryId = initialCategoryId;
});
$effect(() => {
	formMainIcon = initialMainIcon;
});
$effect(() => {
	formSubIcon = initialSubIcon;
});
$effect(() => {
	formPoints = initialPoints;
});
$effect(() => {
	formNameKana = initialNameKana;
});
$effect(() => {
	formNameKanji = initialNameKanji;
});

function onCategoryChange(catId: number) {
	formCategoryId = catId;
	const catDef = getCategoryById(catId);
	const info = catDef ? CATEGORY_INFO[catDef.name] : undefined;
	if (info?.icons[0]) {
		formMainIcon = info.icons[0];
	}
}

function resetForm() {
	formName = '';
	formCategoryId = 1;
	formMainIcon = '🤸';
	formSubIcon = '';
	formPoints = 5;
	formAgeMin = '';
	formAgeMax = '';
	formDailyLimit = '';
	formNameKana = '';
	formNameKanji = '';
	formTriggerHint = '';
}
</script>

<form
	method="POST"
	action="?/create"
	use:enhance={() => {
		return async ({ result, update }) => {
			if (result.type === 'success') {
				resetForm();
				oncreated();
			}
			await update();
		};
	}}
	class="bg-[var(--color-surface-card)] rounded-xl p-4 shadow-sm space-y-4"
>
	<h3 class="font-bold text-[var(--color-text)]">{L.heading}</h3>

	<!-- Name -->
	<label class="block">
		<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.nameLabel}</span>
		<input
			type="text" name="name" bind:value={formName} required
			class="w-full px-3 py-2 border rounded-lg text-sm"
			placeholder={L.namePlaceholder}
		/>
	</label>

	<!-- Category -->
	<div>
		<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.categoryLabel}</span>
		<div class="grid grid-cols-5 gap-1">
			{#each categoryDefs as catDef}
				{@const info = CATEGORY_INFO[catDef.name]}
				<button
					type="button"
					class="px-2 py-2 rounded-lg text-xs font-bold transition-colors text-center
						{formCategoryId === catDef.id ? 'bg-[var(--color-action-primary)] text-[var(--color-text-inverse)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text)] hover:bg-[var(--color-neutral-200)]'}"
					onclick={() => onCategoryChange(catDef.id)}
				>
					{info?.icons[0] ?? '📝'} {catDef.name}
				</button>
			{/each}
		</div>
		{#if CATEGORY_INFO[getCategoryById(formCategoryId)?.name ?? '']?.desc}
			<p class="text-xs text-[var(--color-text-disabled)] mt-1">{CATEGORY_INFO[getCategoryById(formCategoryId)?.name ?? '']?.desc}</p>
		{/if}
		<input type="hidden" name="categoryId" value={formCategoryId} />
	</div>

	<!-- Icon -->
	<div>
		<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.mainIconLabel}</span>
		{#if CATEGORY_INFO[getCategoryById(formCategoryId)?.name ?? '']?.icons}
			<div class="flex flex-wrap gap-1 mb-2">
				{#each CATEGORY_INFO[getCategoryById(formCategoryId)?.name ?? '']?.icons ?? [] as ic}
					<button
						type="button"
						class="w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-colors
							{formMainIcon === ic ? 'bg-[var(--color-brand-100)] ring-2 ring-[var(--color-action-primary)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-neutral-100)]'}"
						onclick={() => formMainIcon = ic}
					>
						{ic}
					</button>
				{/each}
			</div>
		{/if}
		<p class="text-xs text-[var(--color-text-disabled)] mb-3">{L.directInputLabel}
			<input type="text" class="w-10 px-1 border rounded text-center text-sm inline-block"
				value={formMainIcon}
				oninput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) formMainIcon = v; }}
			/>
		</p>

		<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.subIconLabel}</span>
		<div class="flex flex-wrap gap-1 mb-2">
			<button type="button"
				class="w-9 h-9 rounded-lg text-xs flex items-center justify-center transition-colors
					{formSubIcon === '' ? 'bg-[var(--color-brand-100)] ring-2 ring-[var(--color-action-primary)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-neutral-100)]'}"
				onclick={() => formSubIcon = ''}
			>{L.subIconNoneBtn}</button>
			{#each SUB_ICON_PRESETS as ic}
				<button type="button"
					class="w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-colors
						{formSubIcon === ic ? 'bg-[var(--color-brand-100)] ring-2 ring-[var(--color-action-primary)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-neutral-100)]'}"
					onclick={() => formSubIcon = ic}
				>{ic}</button>
			{/each}
		</div>
		<p class="text-xs text-[var(--color-text-disabled)] mb-2">{L.directInputLabel}
			<input type="text" class="w-10 px-1 border rounded text-center text-sm inline-block"
				value={formSubIcon}
				oninput={(e) => { formSubIcon = (e.target as HTMLInputElement).value; }}
			/>
		</p>

		<div class="flex items-center gap-2 p-2 bg-[var(--color-surface-muted)] rounded-lg">
			<span class="text-xs text-[var(--color-text-disabled)]">{L.previewLabel}</span>
			<CompoundIcon icon={formIcon} size="lg" />
		</div>
		<input type="hidden" name="icon" value={formIcon} />
	</div>

	<!-- Points -->
	<div>
		<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.pointsLabel}</span>
		<div class="flex gap-1 mb-2">
			{#each POINT_GUIDE as guide}
				<button
					type="button"
					class="flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors text-center
						{formPoints === guide.points ? guide.color + ' ring-2 ring-offset-1 ring-[var(--color-action-primary)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:bg-[var(--color-neutral-100)]'}"
					onclick={() => formPoints = guide.points}
				>
					{guide.points}P<br /><span class="font-normal">{guide.label}</span>
				</button>
			{/each}
		</div>
		{#if POINT_GUIDE.find(g => g.points === formPoints)?.desc}
			<p class="text-xs text-[var(--color-text-disabled)]">{POINT_GUIDE.find(g => g.points === formPoints)?.desc}</p>
		{/if}
		<input type="hidden" name="basePoints" value={formPoints} />
	</div>

	<!-- Age range -->
	<div>
		<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.ageRangeLabel}</span>
		<div class="flex gap-1 items-center">
			<input type="number" name="ageMin" bind:value={formAgeMin} min="0" max="18" class="w-16 px-2 py-2 border rounded-lg text-sm" placeholder="0" aria-label={L.ageMinAriaLabel} />
			<span class="text-[var(--color-text-disabled)]">{L.ageRangeSeparator}</span>
			<input type="number" name="ageMax" bind:value={formAgeMax} min="0" max="18" class="w-16 px-2 py-2 border rounded-lg text-sm" placeholder="18" aria-label={L.ageMaxAriaLabel} />
			<span class="text-xs text-[var(--color-text-disabled)]">{L.ageUnit}</span>
		</div>
	</div>

	<!-- Daily limit -->
	<div>
		<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.dailyLimitLabel}</span>
		<div class="flex gap-1">
			{#each DAILY_LIMIT_OPTIONS as opt}
				<button
					type="button"
					class="flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors
						{formDailyLimit === opt.val ? 'bg-[var(--color-action-primary)] text-[var(--color-text-inverse)]' : 'bg-[var(--color-neutral-100)] text-[var(--color-text-muted)] hover:bg-[var(--color-neutral-200)]'}"
					onclick={() => formDailyLimit = opt.val}
				>
					{opt.label}
				</button>
			{/each}
		</div>
		<p class="text-xs text-[var(--color-text-disabled)] mt-1">{L.dailyLimitHint}</p>
		<input type="hidden" name="dailyLimit" value={formDailyLimit} />
	</div>

	<!-- Hiragana / Kanji notation -->
	<div>
		<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.nameKanaLabel}</span>
		<input
			type="text" name="nameKana" bind:value={formNameKana}
			class="w-full px-3 py-2 border rounded-lg text-sm"
			placeholder={L.nameKanaPlaceholder}
		/>
		<p class="text-xs text-[var(--color-text-disabled)] mt-1">{L.nameKanaHint}</p>
	</div>
	<div>
		<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.nameKanjiLabel}</span>
		<input
			type="text" name="nameKanji" bind:value={formNameKanji}
			class="w-full px-3 py-2 border rounded-lg text-sm"
			placeholder={L.nameKanjiPlaceholder}
		/>
		<p class="text-xs text-[var(--color-text-disabled)] mt-1">{L.nameKanjiHint}</p>
	</div>

	<!-- Trigger hint -->
	<div>
		<span class="block text-xs font-bold text-[var(--color-text-muted)] mb-1">{L.triggerHintLabel}</span>
		<input
			type="text" name="triggerHint" bind:value={formTriggerHint} maxlength="30"
			class="w-full px-3 py-2 border rounded-lg text-sm"
			placeholder={L.triggerHintPlaceholder}
		/>
		<p class="text-xs text-[var(--color-text-disabled)] mt-1">{L.triggerHintHint}</p>
	</div>

	<button type="submit" class="w-full py-2 bg-[var(--color-action-success)] text-[var(--color-text-inverse)] rounded-lg font-bold text-sm hover:opacity-90 transition-colors">
		{L.submitBtn(formIcon, formName || L.defaultActivityName)}
	</button>
</form>
