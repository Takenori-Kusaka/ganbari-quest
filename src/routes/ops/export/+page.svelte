<script lang="ts">
import { OPS_EXPORT_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data } = $props();

let year = $state(new Date().getFullYear());
let monthFrom = $state(1);
let monthTo = $state(new Date().getMonth() + 1);
// サーバーデータから年月を同期
$effect(() => {
	year = data.currentYear;
	monthTo = data.currentMonth;
});
let downloading = $state(false);

async function downloadCsv(type: 'sales' | 'expenses' | 'summary') {
	downloading = true;
	try {
		const res = await fetch(
			`/ops/export?type=${type}&year=${year}&from=${monthFrom}&to=${monthTo}`,
			{
				headers: { Accept: 'text/csv' },
			},
		);
		if (!res.ok) throw new Error(`Export failed: ${res.status}`);

		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${type}_${year}_${monthFrom}-${monthTo}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	} finally {
		downloading = false;
	}
}
</script>

<svelte:head>
	<title>{OPS_EXPORT_LABELS.pageTitle}</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_EXPORT_LABELS.exportTitle}</h2>
		<div class="flex gap-4 items-end mb-6 flex-wrap">
			<NativeSelect
				label="年"
				bind:value={year}
				options={Array.from({length: 3}, (_, i) => data.currentYear - i).map((y) => ({ value: y, label: `${y}年` }))}
			/>
			<NativeSelect
				label="開始月"
				bind:value={monthFrom}
				options={Array.from({length: 12}, (_, i) => i + 1).map((m) => ({ value: m, label: `${m}月` }))}
			/>
			<NativeSelect
				label="終了月"
				bind:value={monthTo}
				options={Array.from({length: 12}, (_, i) => i + 1).map((m) => ({ value: m, label: `${m}月` }))}
			/>
		</div>

		<div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4">
			<div class="export-card">
				<h3>{OPS_EXPORT_LABELS.salesTitle}</h3>
				<p>{OPS_EXPORT_LABELS.salesDesc}</p>
				<Button variant="primary" size="sm" onclick={() => downloadCsv('sales')} disabled={downloading}>
					{OPS_EXPORT_LABELS.salesDownload}
				</Button>
			</div>
			<div class="export-card">
				<h3>{OPS_EXPORT_LABELS.expensesTitle}</h3>
				<p>{OPS_EXPORT_LABELS.expensesDesc}</p>
				<Button variant="primary" size="sm" onclick={() => downloadCsv('expenses')} disabled={downloading}>
					{OPS_EXPORT_LABELS.expensesDownload}
				</Button>
			</div>
			<div class="export-card">
				<h3>{OPS_EXPORT_LABELS.summaryTitle}</h3>
				<p>{OPS_EXPORT_LABELS.summaryDesc}</p>
				<Button variant="primary" size="sm" onclick={() => downloadCsv('summary')} disabled={downloading}>
					{OPS_EXPORT_LABELS.summaryDownload}
				</Button>
			</div>
		</div>
	</Card>

	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">{OPS_EXPORT_LABELS.notesTitle}</h2>
		<ul class="pl-6 text-[0.8125rem] text-[var(--color-text-muted)] leading-[1.8]">
			<li>{OPS_EXPORT_LABELS.note1}</li>
			<li>{OPS_EXPORT_LABELS.note2}</li>
			<li>{OPS_EXPORT_LABELS.note3}</li>
			<li>{OPS_EXPORT_LABELS.note4}</li>
		</ul>
	</Card>
</div>

<style>
	.export-card {
		border: 1px solid var(--color-border-default);
		border-radius: 0.5rem;
		padding: 1.25rem;
	}

	.export-card h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		margin: 0 0 0.5rem;
		color: var(--color-text-primary);
	}

	.export-card p {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin: 0 0 1rem;
		line-height: 1.5;
	}

</style>
