<script lang="ts">
// #2322 (EPIC #2319 ③): activities グループ — decay / point / defaultChild / sibling
// 旧 /admin/settings/+page.svelte 行 771 (decay) / 813 (defaultChild) / 868 (sibling) / 1086 (point) を移行。

import { enhance } from '$app/forms';
import { getErrorMessage } from '$lib/domain/errors';
import { APP_LABELS, PAGE_TITLES, SETTINGS_LABELS } from '$lib/domain/labels';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import { CURRENCY_CODES, CURRENCY_DEFS, formatPointValue } from '$lib/domain/point-display';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();

const siblingErrorMessage = $derived(getErrorMessage(form?.siblingError));

// 共通: 同時操作排他制御
let decaySaving = $state(false);
let decaySuccess = $state(false);
let pointSubmitting = $state(false);
let pointSuccess = $state(false);
const anyFormBusy = $derived(decaySaving || pointSubmitting);

// ステータス減少
let decayIntensity = $state<string>('normal');
$effect(() => {
	decayIntensity = data.decayIntensity ?? 'normal';
});

const DECAY_OPTIONS = [
	{ value: 'none', label: 'なし', desc: '減少しません（練習や導入期間向け）' },
	{ value: 'gentle', label: 'ゆるやか', desc: '通常の半分の速度で減少します' },
	{ value: 'normal', label: 'ふつう', desc: '猶予2日後にゆるやかに減少します' },
	{ value: 'strict', label: 'きびしめ', desc: '上級者向け。1.5倍の速度で減少します' },
] as const;

async function saveDecayIntensity() {
	if (anyFormBusy) return;
	decaySaving = true;
	decaySuccess = false;
	try {
		const res = await fetch('/api/v1/settings/decay', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ intensity: decayIntensity }),
		});
		if (!res.ok) throw new Error('Failed to save');
		decaySuccess = true;
		setTimeout(() => {
			decaySuccess = false;
		}, 3000);
	} finally {
		decaySaving = false;
	}
}

// ポイント表示
let pointMode = $state<PointUnitMode>('point');
let pointCurrency = $state<CurrencyCode>('JPY');
let pointRate = $state('1');
$effect(() => {
	pointMode = data.pointSettings.mode;
	pointCurrency = data.pointSettings.currency;
	pointRate = String(data.pointSettings.rate);
});

const previewPoints = 100;
const previewFormatted = $derived(
	formatPointValue(previewPoints, pointMode, pointCurrency, Number.parseFloat(pointRate) || 1),
);
</script>

<svelte:head>
	<title>{SETTINGS_LABELS.groupActivitiesTitle} | {PAGE_TITLES.settings}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<!-- ステータス減少設定 -->
	<Card padding="lg" data-testid="settings-decay-section">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">
			{SETTINGS_LABELS.decaySectionTitle}
		</h3>
		<p class="text-sm text-[var(--color-text-muted)] mb-4">
			{SETTINGS_LABELS.decaySectionDesc}
		</p>

		{#if decaySuccess}
			<SuccessAlert message={SETTINGS_LABELS.decaySaved} />
		{/if}

		<div class="space-y-3 mb-4">
			{#each DECAY_OPTIONS as opt}
				<label
					class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors {decayIntensity === opt.value
						? 'border-[var(--color-brand-400)] bg-[var(--color-feedback-info-bg)]'
						: 'border-[var(--color-border-default)] hover:bg-[var(--color-surface-muted)]'}"
				>
					<input
						type="radio"
						name="decayIntensity"
						value={opt.value}
						bind:group={decayIntensity}
						class="mt-0.5 accent-[var(--color-brand-500)]"
					/>
					<div>
						<span class="font-semibold text-[var(--color-text)]">{opt.label}</span>
						<p class="text-xs text-[var(--color-text-muted)] mt-0.5">{opt.desc}</p>
					</div>
				</label>
			{/each}
		</div>

		<Button
			type="button"
			variant="primary"
			size="md"
			class="w-full"
			onclick={saveDecayIntensity}
			disabled={decaySaving}
		>
			{decaySaving ? SETTINGS_LABELS.decaySaving : SETTINGS_LABELS.decaySaveAction}
		</Button>
	</Card>

	<!-- ポイント表示設定 -->
	<Card padding="lg" id="point-settings">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">
			{SETTINGS_LABELS.pointSectionTitle}
		</h3>

		{#if pointSuccess}
			<SuccessAlert message={SETTINGS_LABELS.pointSaved} />
		{/if}

		{#if form?.pointError}
			<ErrorAlert message={form.pointError} severity="warning" action="fix_input" />
		{/if}

		<form
			method="POST"
			action="?/updatePointSettings"
			use:enhance={({ cancel }) => {
				if (anyFormBusy) {
					cancel();
					return;
				}
				pointSubmitting = true;
				pointSuccess = false;
				return async ({ result, update }) => {
					pointSubmitting = false;
					if (result.type === 'success') {
						pointSuccess = true;
					}
					await update();
				};
			}}
			class="flex flex-col gap-4"
		>
			<div>
				<span class="block text-sm font-medium text-[var(--color-text)] mb-2">
					{SETTINGS_LABELS.pointDisplayMode}
				</span>
				<div class="flex gap-3">
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							name="point_unit_mode"
							value="point"
							bind:group={pointMode}
							class="w-4 h-4 text-[var(--color-brand-500)]"
						/>
						<span class="text-sm">{SETTINGS_LABELS.pointModePoint}</span>
					</label>
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="radio"
							name="point_unit_mode"
							value="currency"
							bind:group={pointMode}
							class="w-4 h-4 text-[var(--color-brand-500)]"
						/>
						<span class="text-sm">{SETTINGS_LABELS.pointModeCurrency}</span>
					</label>
				</div>
			</div>

			{#if pointMode === 'currency'}
				<NativeSelect
					id="pointCurrency"
					name="point_currency"
					label="通貨"
					bind:value={pointCurrency}
					options={CURRENCY_CODES.map((code) => ({
						value: code,
						label: `${CURRENCY_DEFS[code].flag} ${code} (${CURRENCY_DEFS[code].symbol})`,
					}))}
				/>

				<FormField
					label="レート（1P = ？{CURRENCY_DEFS[pointCurrency].symbol}）"
					type="number"
					id="pointRate"
					name="point_rate"
					bind:value={pointRate}
					min="0.001"
					max="10000"
					step="any"
					required
					hint="例: 1P = 1円なら「1」、1P = 0.01ドルなら「0.01」"
				/>
			{/if}

			<div class="bg-[var(--color-surface-muted)] rounded-lg p-4">
				<p class="text-sm text-[var(--color-text-muted)] mb-1">
					{SETTINGS_LABELS.pointPreviewLabel(previewPoints)}
				</p>
				<p class="text-2xl font-bold text-[var(--color-point)]">{previewFormatted}</p>
			</div>

			<Button
				type="submit"
				variant="primary"
				size="md"
				class="w-full"
				disabled={pointSubmitting}
			>
				{pointSubmitting
					? SETTINGS_LABELS.decaySaving
					: SETTINGS_LABELS.pointSaveAction}
			</Button>
		</form>
	</Card>

	<!-- 既定の子供 -->
	{#if data.children.length >= 2}
		<Card padding="lg">
			<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">
				{SETTINGS_LABELS.defaultChildSectionTitle}
			</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">
				{SETTINGS_LABELS.defaultChildDesc}<br />
				{SETTINGS_LABELS.defaultChildDescNote}<strong
					>{SETTINGS_LABELS.defaultChildDescNoteStrong}</strong
				>{SETTINGS_LABELS.defaultChildDescNoteSuffix}
			</p>

			{#if form?.defaultChildUpdated}
				<div
					class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)] mb-4"
				>
					{SETTINGS_LABELS.defaultChildUpdated}
				</div>
			{/if}
			{#if form?.defaultChildError}
				<div
					class="rounded-lg bg-[var(--color-feedback-error-bg)] p-3 text-sm text-[var(--color-feedback-error-text)] mb-4"
				>
					{form.defaultChildError}
				</div>
			{/if}

			<form method="POST" action="?/updateDefaultChild" use:enhance class="space-y-3">
				<div class="space-y-2">
					<label
						class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors {data.defaultChildId === null
							? 'border-[var(--color-brand-400)] bg-[var(--color-feedback-info-bg)]'
							: 'border-[var(--color-border-default)] hover:bg-[var(--color-surface-muted)]'}"
					>
						<input
							type="radio"
							name="defaultChildId"
							value="none"
							checked={data.defaultChildId === null}
						/>
						<span class="text-sm font-medium text-[var(--color-text)]">
							{SETTINGS_LABELS.defaultChildNone}
						</span>
					</label>
					{#each data.children as child (child.id)}
						<label
							class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors {data.defaultChildId ===
							child.id
								? 'border-[var(--color-brand-400)] bg-[var(--color-feedback-info-bg)]'
								: 'border-[var(--color-border-default)] hover:bg-[var(--color-surface-muted)]'}"
						>
							<input
								type="radio"
								name="defaultChildId"
								value={child.id}
								checked={data.defaultChildId === child.id}
							/>
							<span class="text-sm font-medium text-[var(--color-text)]">
								{child.nickname}
							</span>
						</label>
					{/each}
				</div>
				<Button type="submit" variant="primary" size="md" class="w-full">
					{SETTINGS_LABELS.defaultChildSaveAction}
				</Button>
			</form>
		</Card>
	{/if}

	<!-- きょうだいチャレンジ設定 -->
	<Card padding="lg">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">
			{SETTINGS_LABELS.siblingSectionTitle}
		</h3>

		{#if form?.siblingSuccess}
			<div
				class="rounded-lg bg-[var(--color-feedback-success-bg)] p-3 text-sm text-[var(--color-feedback-success-text)] mb-4"
			>
				{SETTINGS_LABELS.siblingSaved}
			</div>
		{/if}
		{#if siblingErrorMessage}
			<div
				class="rounded-lg bg-[var(--color-feedback-error-bg)] p-3 text-sm text-[var(--color-feedback-error-text)] mb-4"
			>
				{siblingErrorMessage}
			</div>
		{/if}

		<form method="POST" action="?/updateSiblingSettings" use:enhance class="space-y-4">
			<div>
				<label
					for="sibling-mode-both"
					class="block text-sm font-semibold text-[var(--color-text)] mb-2"
				>
					{SETTINGS_LABELS.siblingChallengeMode}
				</label>
				<div class="space-y-2">
					{#each [
						{ value: 'both', label: '協力＆競争（両方）', desc: '協力チャレンジと競争チャレンジの両方を利用' },
						{ value: 'cooperative', label: '協力のみ', desc: 'きょうだいで協力するチャレンジのみ' },
						{ value: 'competitive', label: '競争のみ', desc: 'きょうだい間の競争チャレンジのみ' },
					] as opt}
						<label
							class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors {data.siblingMode === opt.value
								? 'border-[var(--color-brand-400)] bg-[var(--color-feedback-info-bg)]'
								: 'border-[var(--color-border-default)] hover:bg-[var(--color-surface-muted)]'}"
						>
							<input
								type="radio"
								id={opt.value === 'both' ? 'sibling-mode-both' : undefined}
								name="siblingMode"
								value={opt.value}
								checked={data.siblingMode === opt.value}
								class="mt-0.5"
							/>
							<div>
								<span class="text-sm font-medium text-[var(--color-text)]">{opt.label}</span>
								<p class="text-xs text-[var(--color-text-muted)]">{opt.desc}</p>
							</div>
						</label>
					{/each}
				</div>
			</div>
			{#if data.canSiblingRanking}
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						name="siblingRankingEnabled"
						checked={data.siblingRankingEnabled === 'true'}
						class="h-4 w-4 rounded border-[var(--color-border-strong)]"
					/>
					<span class="text-sm text-[var(--color-text)]">
						{SETTINGS_LABELS.siblingRankingLabel}
					</span>
				</label>
			{:else}
				<div
					class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-muted)] p-3"
				>
					<label
						class="flex items-center gap-2 cursor-not-allowed"
						aria-describedby="sibling-ranking-disabled-reason"
					>
						<input
							type="checkbox"
							disabled
							aria-disabled="true"
							checked={false}
							class="h-4 w-4 rounded border-[var(--color-border-strong)]"
						/>
						<span class="text-sm text-[var(--color-text-muted)]">
							{SETTINGS_LABELS.siblingRankingLabel}
							<span class="text-xs font-bold text-[var(--color-point)]">⭐⭐</span>
						</span>
					</label>
					<p
						id="sibling-ranking-disabled-reason"
						class="mt-2 text-xs text-[var(--color-text-muted)]"
					>
						{SETTINGS_LABELS.siblingRankingUpsell}<a
							href="/pricing"
							class="underline text-[var(--color-text-link)]"
							>{SETTINGS_LABELS.siblingRankingUpsellLink}</a
						>{SETTINGS_LABELS.siblingRankingUpsellSuffix}
					</p>
				</div>
			{/if}
			<Button type="submit" variant="primary" size="md" class="w-full">
				{SETTINGS_LABELS.siblingSaveAction}
			</Button>
		</form>
	</Card>
</div>
