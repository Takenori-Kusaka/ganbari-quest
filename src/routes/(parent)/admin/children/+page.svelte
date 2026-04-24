<script lang="ts">
import { enhance } from '$app/forms';
import { getErrorMessage } from '$lib/domain/errors';
import {
	ADMIN_CHILDREN_PAGE_LABELS,
	APP_LABELS,
	getThemeOptions,
	PAGE_TITLES,
} from '$lib/domain/labels';
import { formatPointValue } from '$lib/domain/point-display';
import ChildListCard from '$lib/features/admin/components/ChildListCard.svelte';
import ChildProfileCard from '$lib/features/admin/components/ChildProfileCard.svelte';
import PageHelpButton from '$lib/ui/components/PageHelpButton.svelte';
import BirthdayInput from '$lib/ui/primitives/BirthdayInput.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import Select from '$lib/ui/primitives/Select.svelte';

let { data, form } = $props();
const childLimit = $derived(
	(data as Record<string, unknown>).childLimit as
		| { allowed: boolean; current: number; max: number | null }
		| undefined,
);
// #787: form.error が string | PlanLimitError どちらでも表示できるよう正規化
const errorMessage = $derived(getErrorMessage(form?.error));

const ps = $derived(data.pointSettings);
const fmtBal = (pts: number) => formatPointValue(pts, ps.mode, ps.currency, ps.rate);

let showAddForm = $state(false);
let themeValue = $state('blue');
let addBirthDate = $state<string | undefined>(undefined);
</script>

<svelte:head>
	<title>{PAGE_TITLES.children}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="children-page">
	<div class="flex items-center gap-2 mb-3">
		<h2 class="text-lg font-bold">{ADMIN_CHILDREN_PAGE_LABELS.pageTitle}</h2>
		<PageHelpButton />
	</div>
	{#if childLimit && !childLimit.allowed}
		<div class="children-page__limit-banner">
			<span class="children-page__limit-icon">⚠️</span>
			<div>
				<p class="children-page__limit-title">{ADMIN_CHILDREN_PAGE_LABELS.limitBannerTitle}</p>
				<p class="children-page__limit-desc">
					{ADMIN_CHILDREN_PAGE_LABELS.limitBannerDesc(childLimit.current, childLimit.max ?? 0)}
				</p>
				<a href="/admin/license" class="children-page__limit-link">
					{ADMIN_CHILDREN_PAGE_LABELS.limitUpgradeLink}
				</a>
			</div>
		</div>
	{/if}

	<div class="children-page__toolbar" data-tutorial="children-list">
		{#if !childLimit || childLimit.allowed}
			<Button
				variant="primary"
				size="sm"
				onclick={() => showAddForm = !showAddForm}
				data-tutorial="add-child-btn"
			>
				{showAddForm ? ADMIN_CHILDREN_PAGE_LABELS.cancelButton : ADMIN_CHILDREN_PAGE_LABELS.addButton}
			</Button>
		{:else}
			<Button
				variant="ghost"
				size="sm"
				class="bg-[var(--color-border-strong)] text-[var(--color-text-muted)] cursor-not-allowed"
				disabled
			>
				{ADMIN_CHILDREN_PAGE_LABELS.limitReachedButton}
			</Button>
		{/if}
	</div>

	<!-- Add child form -->
	{#if showAddForm}
		<Card>
			<form
				method="POST"
				action="?/addChild"
				use:enhance={() => {
					return async ({ result, update }) => {
						if (result.type === 'success') {
							showAddForm = false;
							addBirthDate = undefined;
						}
						await update();
					};
				}}
				class="children-page__add-form"
			>
				<h3 class="children-page__add-title">{ADMIN_CHILDREN_PAGE_LABELS.addFormTitle}</h3>
				<div class="children-page__add-grid">
					<FormField
						label={ADMIN_CHILDREN_PAGE_LABELS.nicknameLabel}
						type="text"
						id="add-nickname"
						name="nickname"
						required
						placeholder="例: たろうくん"
					/>
					<BirthdayInput
						name="birthDate"
						id="add-birthDate"
						bind:value={addBirthDate}
						hint={ADMIN_CHILDREN_PAGE_LABELS.birthdayHint}
					/>
					<FormField
						label={addBirthDate ? ADMIN_CHILDREN_PAGE_LABELS.ageLabelAutoCalc : ADMIN_CHILDREN_PAGE_LABELS.ageLabel}
						type="number"
						id="add-age"
						name="age"
						min="0"
						max="18"
						disabled={!!addBirthDate}
						placeholder={addBirthDate ? '' : ADMIN_CHILDREN_PAGE_LABELS.agePlaceholder}
					/>
					<Select
						label={ADMIN_CHILDREN_PAGE_LABELS.themeColorLabel}
						items={getThemeOptions().map((opt) => ({
							value: opt.value,
							label: `${opt.emoji} ${opt.label}`
						}))}
						value={[themeValue]}
						onValueChange={(d) => (themeValue = d.value[0] ?? 'blue')}
					/>
					<input type="hidden" name="theme" value={themeValue} />
				</div>
				<Button type="submit" variant="success" size="sm">{ADMIN_CHILDREN_PAGE_LABELS.addButton}</Button>
			</form>
		</Card>
	{/if}

	<!-- Error display -->
	{#if errorMessage}
		<div class="children-page__error">{errorMessage}</div>
	{/if}

	<!-- Children list -->
	<div class="children-page__list">
		{#each data.children as child, i}
			<ChildListCard
				{child}
				isSelected={data.selectedChild?.id === child.id}
				href="/admin/children?id={child.id}"
				dataTutorial={i === 0 ? 'child-card' : undefined}
				formatBalance={fmtBal}
			/>
		{/each}
	</div>

	<!-- Selected child detail -->
	{#if data.selectedChild}
		<div class="children-page__detail">
			{#key data.selectedChild.id}
				<ChildProfileCard
					child={data.selectedChild}
					categoryDefs={data.categoryDefs}
					pointSettings={ps}
				/>
			{/key}
		</div>
	{/if}
</div>

<style>
	.children-page {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.children-page__limit-banner {
		background: var(--color-surface-warning, #fffbeb);
		border: 1px solid var(--color-border-warning, #fde68a);
		border-radius: 0.75rem;
		padding: 1rem;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.children-page__limit-icon {
		font-size: 1.5rem;
	}
	.children-page__limit-title {
		font-weight: 700;
		color: var(--color-warning-text, #92400e);
	}
	.children-page__limit-desc {
		font-size: 0.875rem;
		color: var(--color-warning-text, #a16207);
		margin-top: 0.25rem;
	}
	.children-page__limit-link {
		display: inline-flex;
		align-items: center;
		margin-top: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-action-primary, #2563eb);
	}
	.children-page__limit-link:hover {
		color: var(--color-action-primary-hover, #1d4ed8);
	}
	.children-page__toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.children-page__add-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.children-page__add-title {
		font-weight: 700;
		color: var(--color-text-secondary, #4b5563);
	}
	.children-page__add-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	@media (max-width: 480px) {
		.children-page__add-grid {
			grid-template-columns: 1fr;
		}
	}
	.children-page__error {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: var(--color-danger, #dc2626);
		padding: 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}
	.children-page__list {
		display: grid;
		gap: 0.75rem;
	}
	.children-page__detail {
		animation: slide-in 0.2s ease-out;
	}
	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateY(-0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
