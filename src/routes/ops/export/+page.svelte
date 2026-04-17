<script lang="ts">
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

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
	<title>OPS - エクスポート</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">確定申告用CSVエクスポート</h2>
		<div class="flex gap-4 items-center mb-6 flex-wrap">
			<label class="flex gap-2 items-center text-sm text-[var(--color-text-secondary)]">
				年:
				<select bind:value={year} class="py-1.5 px-3 border border-[var(--color-border-strong)] rounded-md text-sm">
					{#each Array.from({length: 3}, (_, i) => data.currentYear - i) as y}
						<option value={y}>{y}年</option>
					{/each}
				</select>
			</label>
			<label class="flex gap-2 items-center text-sm text-[var(--color-text-secondary)]">
				開始月:
				<select bind:value={monthFrom} class="py-1.5 px-3 border border-[var(--color-border-strong)] rounded-md text-sm">
					{#each Array.from({length: 12}, (_, i) => i + 1) as m}
						<option value={m}>{m}月</option>
					{/each}
				</select>
			</label>
			<label class="flex gap-2 items-center text-sm text-[var(--color-text-secondary)]">
				終了月:
				<select bind:value={monthTo} class="py-1.5 px-3 border border-[var(--color-border-strong)] rounded-md text-sm">
					{#each Array.from({length: 12}, (_, i) => i + 1) as m}
						<option value={m}>{m}月</option>
					{/each}
				</select>
			</label>
		</div>

		<div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4">
			<div class="export-card">
				<h3>売上台帳</h3>
				<p>Stripe 請求書ベースの収入記録。青色申告決算書 第1面「収入金額」に対応。</p>
				<Button variant="primary" size="sm" onclick={() => downloadCsv('sales')} disabled={downloading}>
					CSV ダウンロード
				</Button>
			</div>
			<div class="export-card">
				<h3>経費台帳</h3>
				<p>AWS 費用 + Stripe 手数料。勘定科目付き。青色申告決算書「必要経費」に対応。</p>
				<Button variant="primary" size="sm" onclick={() => downloadCsv('expenses')} disabled={downloading}>
					CSV ダウンロード
				</Button>
			</div>
			<div class="export-card">
				<h3>収支サマリー</h3>
				<p>売上・経費・差引利益の一覧。確定申告前の概要確認用。</p>
				<Button variant="primary" size="sm" onclick={() => downloadCsv('summary')} disabled={downloading}>
					テキスト ダウンロード
				</Button>
			</div>
		</div>
	</Card>

	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-text-primary)]">注意事項</h2>
		<ul class="pl-6 text-[0.8125rem] text-[var(--color-text-muted)] leading-[1.8]">
			<li>AWS 費用は Cost Explorer API から取得（USD→JPY はレート ¥150/$ で概算）</li>
			<li>Stripe 手数料は 3.6% + ¥40/件 の概算値です</li>
			<li>消費税区分はインボイス登録状況に応じて調整が必要です</li>
			<li>本データは概算値です。正式な申告は税理士に相談してください</li>
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
