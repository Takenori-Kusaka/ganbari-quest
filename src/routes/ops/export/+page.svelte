<script lang="ts">
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

<div class="export-page">
	<section class="section">
		<h2>確定申告用CSVエクスポート</h2>
		<div class="period-selector">
			<label>
				年:
				<select bind:value={year}>
					{#each Array.from({length: 3}, (_, i) => data.currentYear - i) as y}
						<option value={y}>{y}年</option>
					{/each}
				</select>
			</label>
			<label>
				開始月:
				<select bind:value={monthFrom}>
					{#each Array.from({length: 12}, (_, i) => i + 1) as m}
						<option value={m}>{m}月</option>
					{/each}
				</select>
			</label>
			<label>
				終了月:
				<select bind:value={monthTo}>
					{#each Array.from({length: 12}, (_, i) => i + 1) as m}
						<option value={m}>{m}月</option>
					{/each}
				</select>
			</label>
		</div>

		<div class="export-cards">
			<div class="export-card">
				<h3>売上台帳</h3>
				<p>Stripe 請求書ベースの収入記録。青色申告決算書 第1面「収入金額」に対応。</p>
				<button onclick={() => downloadCsv('sales')} disabled={downloading}>
					CSV ダウンロード
				</button>
			</div>
			<div class="export-card">
				<h3>経費台帳</h3>
				<p>AWS 費用 + Stripe 手数料。勘定科目付き。青色申告決算書「必要経費」に対応。</p>
				<button onclick={() => downloadCsv('expenses')} disabled={downloading}>
					CSV ダウンロード
				</button>
			</div>
			<div class="export-card">
				<h3>収支サマリー</h3>
				<p>売上・経費・差引利益の一覧。確定申告前の概要確認用。</p>
				<button onclick={() => downloadCsv('summary')} disabled={downloading}>
					テキスト ダウンロード
				</button>
			</div>
		</div>
	</section>

	<section class="section note">
		<h2>注意事項</h2>
		<ul>
			<li>AWS 費用は Cost Explorer API から取得（USD→JPY はレート ¥150/$ で概算）</li>
			<li>Stripe 手数料は 3.6% + ¥40/件 の概算値です</li>
			<li>消費税区分はインボイス登録状況に応じて調整が必要です</li>
			<li>本データは概算値です。正式な申告は税理士に相談してください</li>
		</ul>
	</section>
</div>

<style>
	.export-page {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.section {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		padding: 1.5rem;
	}

	.section h2 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		color: #2d3748;
	}

	.period-selector {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.period-selector label {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.875rem;
		color: #4a5568;
	}

	.period-selector select {
		padding: 0.375rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		font-size: 0.875rem;
	}

	.export-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 1rem;
	}

	.export-card {
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		padding: 1.25rem;
	}

	.export-card h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		margin: 0 0 0.5rem;
		color: #2d3748;
	}

	.export-card p {
		font-size: 0.8125rem;
		color: #718096;
		margin: 0 0 1rem;
		line-height: 1.5;
	}

	.export-card button {
		padding: 0.5rem 1rem;
		background: #4299e1;
		color: #fff;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	.export-card button:hover:not(:disabled) {
		background: #3182ce;
	}

	.export-card button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.note ul {
		padding-left: 1.5rem;
		font-size: 0.8125rem;
		color: #718096;
		line-height: 1.8;
	}
</style>
