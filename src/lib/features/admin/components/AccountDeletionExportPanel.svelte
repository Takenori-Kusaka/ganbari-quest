<script lang="ts">
// #4472: 退会前のデータ持ち出し導線。
// 無料プランは通常のエクスポート (`/api/v1/export`) を使えないため、退会画面のこの導線が
// 唯一のデータ持ち出し手段になる。プランで出し分けず、退会を実行する前に押せる位置に置く。

import type { PlanTier } from '$lib/domain/constants/plan-tier';
import { resolveExportScope } from '$lib/domain/deletion-export-scope';
import { SETTINGS_LABELS } from '$lib/domain/labels';
import {
	type DeletionExportDownloadResult,
	downloadDeletionExport,
} from '$lib/features/admin/deletion-export-download';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	planTier: PlanTier;
	/** test / Storybook からの差し替え用 */
	download?: () => Promise<DeletionExportDownloadResult>;
}

let { planTier, download = downloadDeletionExport }: Props = $props();

let busy = $state(false);
let errorMessage = $state('');
let savedFilename = $state('');

const scopeDesc = $derived(
	{
		minimal: SETTINGS_LABELS.accountDeleteExportScopeMinimal,
		full: SETTINGS_LABELS.accountDeleteExportScopeFull,
		family: SETTINGS_LABELS.accountDeleteExportScopeFamily,
	}[resolveExportScope(planTier)],
);

async function handleDownload() {
	if (busy) return;
	busy = true;
	errorMessage = '';
	savedFilename = '';
	try {
		const result = await download();
		if (result.ok) savedFilename = result.filename;
		else errorMessage = result.message;
	} finally {
		busy = false;
	}
}
</script>

<div
	class="mb-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4"
	data-testid="account-deletion-export"
>
	<h4 class="mb-1 text-base font-bold text-[var(--color-text-primary)]">
		{SETTINGS_LABELS.accountDeleteExportTitle}
	</h4>
	<p
		class="mb-3 text-sm text-[var(--color-text-secondary)]"
		data-testid="account-deletion-export-scope"
	>
		{scopeDesc}
	</p>

	{#if errorMessage}
		<ErrorAlert message={errorMessage} severity="error" action="retry" />
	{/if}
	{#if savedFilename}
		<SuccessAlert message={SETTINGS_LABELS.accountDeleteExportSuccess(savedFilename)} />
	{/if}

	<Button
		type="button"
		variant="secondary"
		size="md"
		loading={busy}
		onclick={handleDownload}
		data-testid="account-deletion-export-button"
	>
		{busy
			? SETTINGS_LABELS.accountDeleteExportSubmitting
			: SETTINGS_LABELS.accountDeleteExportAction}
	</Button>
</div>
