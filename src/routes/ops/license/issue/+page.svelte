<script lang="ts">
import { enhance } from '$app/forms';
import { getLicensePlanLabel, OPS_LICENSE_ISSUE_LABELS } from '$lib/domain/labels';
import Card from '$lib/ui/primitives/Card.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();
const plans = $derived(data.plans);

let submitting = $state(false);

function downloadCsv() {
	if (!form?.issued || !form.keys?.length) return;
	const header = 'licenseKey,plan,reason,tenantId,issuedBy,expiresAt';
	const rows = form.keys.map(
		(k: string) =>
			`${k},${form.plan},"${form.reason.replaceAll('"', '""')}",${form.tenantId},${form.issuedBy},${form.expiresAt}`,
	);
	const csv = `${header}\n${rows.join('\n')}\n`;
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `campaign-keys-${new Date().toISOString().slice(0, 10)}.csv`;
	a.click();
	URL.revokeObjectURL(url);
}

async function copyAll() {
	if (!form?.issued || !form.keys?.length) return;
	await navigator.clipboard.writeText(form.keys.join('\n'));
}
</script>

<svelte:head>
	<title>{OPS_LICENSE_ISSUE_LABELS.pageTitle}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-6">
	<div>
		<a
			href="/ops/license"
			class="text-sm text-[var(--color-text-link)] hover:underline"
		>{OPS_LICENSE_ISSUE_LABELS.backLink}</a>
	</div>

	<Card padding="lg">
		<h1 class="text-lg font-bold m-0 mb-1">{OPS_LICENSE_ISSUE_LABELS.cardTitle}</h1>
		<p class="text-sm text-[var(--color-text-muted)] mt-0 mb-4">
			{OPS_LICENSE_ISSUE_LABELS.cardDesc1}
			{OPS_LICENSE_ISSUE_LABELS.cardDesc2}
			{OPS_LICENSE_ISSUE_LABELS.cardDesc3}
		</p>

		<details class="mb-4 p-3 bg-[var(--color-surface-info)] text-[var(--color-feedback-info-text)] rounded text-sm">
			<summary class="cursor-pointer font-medium">{OPS_LICENSE_ISSUE_LABELS.promoCodeSummary}</summary>
			<div class="mt-2 text-[var(--color-text-primary)]">
				<p class="m-0 mb-2">
					{OPS_LICENSE_ISSUE_LABELS.promoCodeDesc1}
					{OPS_LICENSE_ISSUE_LABELS.promoCodeDesc2Prefix}<strong>{OPS_LICENSE_ISSUE_LABELS.promoCodeDesc2Strong}</strong>{OPS_LICENSE_ISSUE_LABELS.promoCodeDesc2Suffix1}
					{OPS_LICENSE_ISSUE_LABELS.promoCodeDesc2Suffix2}
				</p>
				<ul class="m-0 ml-4 mb-2 list-disc">
					<li>{OPS_LICENSE_ISSUE_LABELS.promoCodeList1} <code>{OPS_LICENSE_ISSUE_LABELS.promoCodeList1CodePath}</code></li>
					<li>{OPS_LICENSE_ISSUE_LABELS.promoCodeList2}</li>
					<li>{OPS_LICENSE_ISSUE_LABELS.promoCodeList3Prefix}<a href="/ops" class="underline">{OPS_LICENSE_ISSUE_LABELS.promoCodeList3Link}</a>{OPS_LICENSE_ISSUE_LABELS.promoCodeList3Suffix}</li>
				</ul>
				<a
					href="https://dashboard.stripe.com/coupons"
					target="_blank"
					rel="noopener noreferrer"
					class="underline"
				>{OPS_LICENSE_ISSUE_LABELS.promoCodeDashboardLink}</a>
			</div>
		</details>

		<form
			method="POST"
			action="?/issue"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			class="flex flex-col gap-4"
		>
			<NativeSelect
				name="plan"
				label={OPS_LICENSE_ISSUE_LABELS.planLabel}
				required
				options={plans.map((plan: string) => ({ value: plan, label: getLicensePlanLabel(plan) }))}
			/>

			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium">{OPS_LICENSE_ISSUE_LABELS.quantityLabel}</span>
				<input
					type="number"
					name="quantity"
					min="1"
					max="500"
					value="10"
					required
					class="px-3 py-2 border border-[var(--color-border-default)] rounded text-sm font-mono"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium">{OPS_LICENSE_ISSUE_LABELS.reasonLabel}</span>
				<input
					type="text"
					name="reason"
					placeholder={OPS_LICENSE_ISSUE_LABELS.reasonPlaceholder}
					required
					maxlength="200"
					class="px-3 py-2 border border-[var(--color-border-default)] rounded text-sm"
				/>
				<span class="text-xs text-[var(--color-text-muted)]">{OPS_LICENSE_ISSUE_LABELS.reasonHint}</span>
			</label>

			<NativeSelect
				name="expiresAt"
				label="有効期限"
				options={[
					{ value: 'default', label: OPS_LICENSE_ISSUE_LABELS.expiresAtDefault },
					{ value: 'never', label: OPS_LICENSE_ISSUE_LABELS.expiresAtNever },
				]}
			/>

			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium">{OPS_LICENSE_ISSUE_LABELS.tenantIdLabel}</span>
				<input
					type="text"
					name="tenantId"
					placeholder={OPS_LICENSE_ISSUE_LABELS.tenantIdPlaceholder}
					class="px-3 py-2 border border-[var(--color-border-default)] rounded text-sm font-mono"
				/>
				<span class="text-xs text-[var(--color-text-muted)]">{OPS_LICENSE_ISSUE_LABELS.tenantIdHint}</span>
			</label>

			<div class="flex gap-2 justify-end mt-2">
				<button
					type="submit"
					disabled={submitting}
					class="px-4 py-2 bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] rounded font-medium disabled:opacity-50"
				>
					{submitting ? OPS_LICENSE_ISSUE_LABELS.submitLoading : OPS_LICENSE_ISSUE_LABELS.submitButton}
				</button>
			</div>
		</form>

		{#if form?.error}
			<div class="mt-4 p-3 bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)] rounded text-sm">
				{form.error}
			</div>
		{/if}
	</Card>

	{#if form?.issued}
		<Card padding="lg">
			<div class="flex justify-between items-start gap-4 flex-wrap mb-4">
				<div>
					<h2 class="text-base font-semibold m-0 mb-1">{OPS_LICENSE_ISSUE_LABELS.resultTitle(form.keys.length)}</h2>
					<p class="text-sm text-[var(--color-text-muted)] m-0">
						{OPS_LICENSE_ISSUE_LABELS.resultPlanPrefix}{getLicensePlanLabel(form.plan)}{OPS_LICENSE_ISSUE_LABELS.resultReasonPrefix}{form.reason}{OPS_LICENSE_ISSUE_LABELS.resultExpiresPrefix}{form.expiresAt}
					</p>
				</div>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={copyAll}
						class="px-3 py-2 border border-[var(--color-border-default)] rounded text-sm"
					>{OPS_LICENSE_ISSUE_LABELS.copyAllButton}</button>
					<button
						type="button"
						onclick={downloadCsv}
						class="px-3 py-2 bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] rounded text-sm font-medium"
					>{OPS_LICENSE_ISSUE_LABELS.downloadCsvButton}</button>
				</div>
			</div>

			{#if form.errors}
				<div class="mb-3 p-3 bg-[var(--color-feedback-warning-bg)] text-[var(--color-feedback-warning-text)] rounded text-sm">
					{OPS_LICENSE_ISSUE_LABELS.errorCount(form.errors.length)}
				</div>
			{/if}

			<textarea
				readonly
				rows="12"
				class="w-full px-3 py-2 border border-[var(--color-border-default)] rounded text-xs font-mono"
				value={form.keys.join('\n')}
			></textarea>
		</Card>
	{/if}
</div>
