<script lang="ts">
import { enhance } from '$app/forms';
import type { DowngradePreview } from '$lib/domain/downgrade-types';
import {
	APP_LABELS,
	CANCELLATION_CATEGORY,
	CANCELLATION_LABELS,
	type CancellationCategory,
	PAGE_TITLES,
} from '$lib/domain/labels';
import DowngradeResourceSelector from '$lib/features/admin/components/DowngradeResourceSelector.svelte';
import {
	archiveDowngradeSelection,
	type DowngradeSelection,
	fetchDowngradePreview,
} from '$lib/features/admin/downgrade-client';
import { shouldOpenDowngradeSelector } from '$lib/features/admin/downgrade-dialog-policy';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data, form } = $props();

let selectedCategory = $state<CancellationCategory | ''>('');
let freeText = $state<string>('');
let submitting = $state(false);

// #4585-1: 解約フローも請求パネルと同じ選択 UI (DowngradeResourceSelector) に合流させる。
// 同じ解約なのに入口によって「選べる / 選べない」が変わる状態を無くす。
let formEl = $state<HTMLFormElement | null>(null);
let selectionResolved = $state(false);
let showSelector = $state(false);
let downgradePreview = $state<DowngradePreview | null>(null);
let selectorLoading = $state(false);
let selectorError = $state<string | null>(null);
let selectionUnavailable = $state(false);

/** 解約すると無料プランに戻る顧客か (= 上限超過分の行き先が決まる顧客か) */
const returnsToFreePlan = $derived(data.planTier !== undefined && data.planTier !== 'free');

function submitForm() {
	formEl?.requestSubmit();
}

/**
 * 送信前に「どれを残すか」を顧客に決めさせる。
 *
 * - 失うものがあれば選択ダイアログを開く (判定 SSOT = shouldOpenDowngradeSelector、#4530)
 * - 失うものが無ければそのまま手続きへ進む (無用なダイアログを増やさない)
 * - 取得できなければ理由を出して止める。再度押せば手続きは続けられる
 *   (解約を行き止まりにしない — #4329 と同じ特商法の解約導線の実効性)
 */
async function resolveSelection() {
	selectorLoading = true;
	selectorError = null;
	selectionUnavailable = false;
	const result = await fetchDowngradePreview();
	selectorLoading = false;

	if (!result.ok) {
		selectionUnavailable = true;
		selectionResolved = true;
		return;
	}
	if (!shouldOpenDowngradeSelector(result.value)) {
		selectionResolved = true;
		submitForm();
		return;
	}
	downgradePreview = result.value;
	showSelector = true;
}

async function confirmSelection(selection: DowngradeSelection) {
	if (downgradePreview?.hasExcess) {
		selectorLoading = true;
		const archived = await archiveDowngradeSelection(selection);
		selectorLoading = false;
		if (!archived.ok) {
			selectorError = archived.error;
			return;
		}
	}
	showSelector = false;
	downgradePreview = null;
	selectionResolved = true;
	submitForm();
}

// form action が再実行されたら state を同期（fail 時のフォーム値復元）
$effect(() => {
	if (form?.category !== undefined) {
		selectedCategory = form.category as CancellationCategory | '';
	}
	if (form?.freeText !== undefined) {
		freeText = form.freeText;
	}
});

const charCount = $derived(freeText.length);
const isOverLimit = $derived(charCount > data.freeTextMaxLength);
const canSubmit = $derived(
	selectedCategory !== '' && !isOverLimit && !submitting && !selectorLoading,
);

function selectCategory(category: CancellationCategory) {
	selectedCategory = category;
}

const submitLabel = $derived.by(() => {
	// #4585-1: 選択がまだなら、次に起きること (残すデータを選ぶ) をボタンで予告する
	if (returnsToFreePlan && !selectionResolved) return CANCELLATION_LABELS.selectionButton;
	return data.isPaidPlan
		? CANCELLATION_LABELS.submitButton
		: CANCELLATION_LABELS.submitButtonNoStripe;
});

const noticeText = $derived(
	data.isPaidPlan ? CANCELLATION_LABELS.paidPlanNotice : CANCELLATION_LABELS.freePlanNotice,
);
</script>

<svelte:head>
	<title>{CANCELLATION_LABELS.pageHeading}{APP_LABELS.pageTitleSuffix}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="cancel-flow space-y-6">
	<header class="space-y-2">
		<h1 class="text-lg font-bold text-[var(--color-text-primary)]">
			{CANCELLATION_LABELS.pageHeading}
		</h1>
		<p class="text-sm text-[var(--color-text-secondary)]">
			{CANCELLATION_LABELS.pageDesc}
		</p>
	</header>

	<Alert variant="info">
		{noticeText}
	</Alert>

	{#if returnsToFreePlan}
		<!-- #4585-1: 選ばずに進めた場合に何が残るかを、手続きの前に述べる (PO 必須指示) -->
		<Alert variant="warning">
			<div data-testid="cancellation-archive-fallback-notice" class="space-y-1">
				<p class="font-semibold">{CANCELLATION_LABELS.archiveFallbackHeading}</p>
				<p>
					{CANCELLATION_LABELS.archiveFallbackRule(
						data.freeLimits?.maxChildren ?? 0,
						data.freeLimits?.maxActivities ?? 0,
						data.freeLimits?.maxChecklistTemplates ?? 0,
					)}
				</p>
				<p>{CANCELLATION_LABELS.archiveFallbackRestore}</p>
			</div>
		</Alert>
	{/if}

	{#if selectionUnavailable}
		<Alert variant="danger">
			<p data-testid="cancellation-selection-unavailable" role="alert">
				{CANCELLATION_LABELS.selectionUnavailable}
			</p>
		</Alert>
	{/if}

	<form
		method="POST"
		bind:this={formEl}
		data-testid="cancellation-form"
		use:enhance={({ cancel }) => {
			// 選択が済んでいない解約は、まず「どれを残すか」を決めてもらう。
			// 済ませずに送ると期末の自動アーカイブ (先に登録した順に残す) に倒れる。
			if (returnsToFreePlan && !selectionResolved) {
				cancel();
				void resolveSelection();
				return;
			}
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		<Card variant="default" padding="lg">
			<div class="space-y-5">
				<div class="space-y-1">
					<h2 class="text-base font-semibold text-[var(--color-text-secondary)] flex items-center gap-2">
						<span>{CANCELLATION_LABELS.reasonSectionTitle}</span>
						<span class="cancel-required">{CANCELLATION_LABELS.reasonRequired}</span>
					</h2>
				</div>

				<fieldset class="cancel-categories" data-testid="cancellation-categories">
					<legend class="sr-only">{CANCELLATION_LABELS.reasonSectionTitle}</legend>

					<label
						class="cancel-category-option"
						class:cancel-category-option--selected={selectedCategory === CANCELLATION_CATEGORY.GRADUATION}
					>
						<input
							type="radio"
							name="category"
							value={CANCELLATION_CATEGORY.GRADUATION}
							checked={selectedCategory === CANCELLATION_CATEGORY.GRADUATION}
							onchange={() => selectCategory(CANCELLATION_CATEGORY.GRADUATION)}
							data-testid="cancellation-category-graduation"
						/>
						<div class="cancel-category-text">
							<span class="cancel-category-label">
								{CANCELLATION_LABELS.categoryGraduationLabel}
							</span>
							<span class="cancel-category-hint">
								{CANCELLATION_LABELS.categoryGraduationHint}
							</span>
						</div>
					</label>

					<label
						class="cancel-category-option"
						class:cancel-category-option--selected={selectedCategory === CANCELLATION_CATEGORY.CHURN}
					>
						<input
							type="radio"
							name="category"
							value={CANCELLATION_CATEGORY.CHURN}
							checked={selectedCategory === CANCELLATION_CATEGORY.CHURN}
							onchange={() => selectCategory(CANCELLATION_CATEGORY.CHURN)}
							data-testid="cancellation-category-churn"
						/>
						<div class="cancel-category-text">
							<span class="cancel-category-label">
								{CANCELLATION_LABELS.categoryChurnLabel}
							</span>
							<span class="cancel-category-hint">
								{CANCELLATION_LABELS.categoryChurnHint}
							</span>
						</div>
					</label>

					<label
						class="cancel-category-option"
						class:cancel-category-option--selected={selectedCategory === CANCELLATION_CATEGORY.PAUSE}
					>
						<input
							type="radio"
							name="category"
							value={CANCELLATION_CATEGORY.PAUSE}
							checked={selectedCategory === CANCELLATION_CATEGORY.PAUSE}
							onchange={() => selectCategory(CANCELLATION_CATEGORY.PAUSE)}
							data-testid="cancellation-category-pause"
						/>
						<div class="cancel-category-text">
							<span class="cancel-category-label">
								{CANCELLATION_LABELS.categoryPauseLabel}
							</span>
							<span class="cancel-category-hint">
								{CANCELLATION_LABELS.categoryPauseHint}
							</span>
						</div>
					</label>
				</fieldset>

				<div class="space-y-2">
					<label
						for="cancellation-free-text"
						class="block text-sm font-medium text-[var(--color-text-primary)]"
					>
						{CANCELLATION_LABELS.freeTextLabel}
					</label>
					<textarea
						id="cancellation-free-text"
						name="freeText"
						bind:value={freeText}
						placeholder={CANCELLATION_LABELS.freeTextPlaceholder}
						maxlength={data.freeTextMaxLength}
						rows={5}
						data-testid="cancellation-free-text"
						class="cancel-textarea"
					></textarea>
					<p class="cancel-counter" class:cancel-counter--over={isOverLimit}>
						{CANCELLATION_LABELS.freeTextHint(charCount, data.freeTextMaxLength)}
					</p>
				</div>

				{#if form?.error}
					<Alert variant="danger">
						{form.error}
					</Alert>
				{/if}

				<div class="cancel-actions">
					<Button
						type="button"
						variant="secondary"
						size="md"
						href="/admin/subscription"
						disabled={submitting}
					>
						{CANCELLATION_LABELS.cancelButton}
					</Button>
					<Button
						type="submit"
						variant="primary"
						size="md"
						disabled={!canSubmit}
						data-testid="cancellation-submit"
					>
						{#if submitting}
							{CANCELLATION_LABELS.submitLoading}
						{:else if selectorLoading}
							{CANCELLATION_LABELS.selectionLoading}
						{:else}
							{submitLabel}
						{/if}
					</Button>
				</div>
			</div>
		</Card>
	</form>
</div>

<!-- #4585-1: 請求パネル (SaasLicensePanel) と同一の選択 UI。解約フローもここに合流する -->
<DowngradeResourceSelector
	bind:open={showSelector}
	preview={downgradePreview}
	loading={selectorLoading}
	error={selectorError}
	onConfirm={confirmSelection}
	onCancel={() => {
		showSelector = false;
		downgradePreview = null;
		selectorError = null;
	}}
/>

<style>
	.cancel-flow {
		max-width: 720px;
	}

	.cancel-required {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--color-feedback-error-bg);
		color: var(--color-feedback-error-text);
	}

	.cancel-categories {
		display: grid;
		gap: 0.75rem;
		border: none;
		padding: 0;
		margin: 0;
	}

	.cancel-category-option {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem;
		border: 2px solid var(--color-border-default);
		border-radius: var(--radius-lg, 12px);
		cursor: pointer;
		background: var(--color-surface-card);
		transition: border-color 0.15s, background-color 0.15s;
	}

	.cancel-category-option:hover {
		border-color: var(--color-border-focus);
	}

	.cancel-category-option--selected {
		border-color: var(--color-border-focus);
		background: var(--color-surface-accent);
	}

	.cancel-category-option input[type='radio'] {
		margin-top: 0.25rem;
		flex-shrink: 0;
	}

	.cancel-category-text {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
		min-width: 0;
	}

	.cancel-category-label {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.cancel-category-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.cancel-textarea {
		width: 100%;
		min-height: 120px;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border-default);
		border-radius: var(--radius-lg, 12px);
		background: var(--color-surface-card);
		color: var(--color-text-primary);
		font-size: 0.9rem;
		font-family: inherit;
		resize: vertical;
	}

	.cancel-textarea:focus {
		outline: none;
		border-color: var(--color-border-focus);
	}

	.cancel-counter {
		text-align: right;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.cancel-counter--over {
		color: var(--color-feedback-error-text);
		font-weight: 600;
	}

	.cancel-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 640px) {
		.cancel-actions {
			flex-direction: column-reverse;
		}

		.cancel-actions :global(a),
		.cancel-actions :global(button) {
			width: 100%;
		}
	}
</style>
