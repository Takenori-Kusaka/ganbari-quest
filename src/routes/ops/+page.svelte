<script lang="ts">
	let { data } = $props();
	const kpi = $derived(data.kpi);
	const stats = $derived(kpi.tenantStats);
	const activeRate = $derived((kpi.activeRate * 100).toFixed(1));
</script>

<svelte:head>
	<title>OPS - KPI サマリー</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="kpi-page">
	<div class="timestamp">
		{new Date(kpi.fetchedAt).toLocaleString('ja-JP')} 時点
	</div>

	<!-- KPI カード -->
	<div class="kpi-cards">
		<div class="kpi-card">
			<div class="kpi-label">総テナント数</div>
			<div class="kpi-value">{stats.total}</div>
			<div class="kpi-sub">+{stats.newThisMonth} 今月</div>
		</div>
		<div class="kpi-card">
			<div class="kpi-label">アクティブ</div>
			<div class="kpi-value">{stats.active}</div>
			<div class="kpi-sub">{activeRate}%</div>
		</div>
		<div class="kpi-card">
			<div class="kpi-label">猶予期間</div>
			<div class="kpi-value">{stats.gracePeriod}</div>
		</div>
		<div class="kpi-card">
			<div class="kpi-label">停止中</div>
			<div class="kpi-value">{stats.suspended}</div>
		</div>
		<div class="kpi-card">
			<div class="kpi-label">退会済み</div>
			<div class="kpi-value">{stats.terminated}</div>
		</div>
	</div>

	<!-- プラン内訳 -->
	<section class="section">
		<h2>プラン別内訳（アクティブテナント）</h2>
		<div class="plan-table">
			<table>
				<thead>
					<tr>
						<th>プラン</th>
						<th>テナント数</th>
						<th>MRR 概算</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>月額 (¥500/月)</td>
						<td>{stats.planBreakdown.monthly}</td>
						<td>¥{(stats.planBreakdown.monthly * 500).toLocaleString()}</td>
					</tr>
					<tr>
						<td>年額 (¥5,000/年)</td>
						<td>{stats.planBreakdown.yearly}</td>
						<td>¥{Math.round(stats.planBreakdown.yearly * 5000 / 12).toLocaleString()}</td>
					</tr>
					<tr>
						<td>ライフタイム</td>
						<td>{stats.planBreakdown.lifetime}</td>
						<td>-</td>
					</tr>
					<tr>
						<td>未設定（トライアル等）</td>
						<td>{stats.planBreakdown.noPlan}</td>
						<td>-</td>
					</tr>
					<tr class="total-row">
						<td>合計 MRR</td>
						<td>{stats.active}</td>
						<td>¥{(stats.planBreakdown.monthly * 500 + Math.round(stats.planBreakdown.yearly * 5000 / 12)).toLocaleString()}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<!-- ステータス -->
	<section class="section">
		<h2>システム状態</h2>
		<div class="status-list">
			<div class="status-item">
				<span class="status-label">Stripe 連携:</span>
				<span class={kpi.stripeEnabled ? 'status-ok' : 'status-warn'}>
					{kpi.stripeEnabled ? '有効' : '無効（ローカルモード）'}
				</span>
			</div>
		</div>
	</section>
</div>

<style>
	.kpi-page {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.timestamp {
		font-size: 0.75rem;
		color: #718096;
		text-align: right;
	}

	.kpi-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 1rem;
	}

	.kpi-card {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		padding: 1.25rem;
		text-align: center;
	}

	.kpi-label {
		font-size: 0.75rem;
		color: #718096;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	.kpi-value {
		font-size: 2rem;
		font-weight: 700;
		color: #1a202c;
	}

	.kpi-sub {
		font-size: 0.75rem;
		color: #48bb78;
		margin-top: 0.25rem;
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

	.plan-table table {
		width: 100%;
		border-collapse: collapse;
	}

	.plan-table th,
	.plan-table td {
		padding: 0.5rem 1rem;
		text-align: left;
		border-bottom: 1px solid #edf2f7;
	}

	.plan-table th {
		font-size: 0.75rem;
		color: #718096;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.total-row td {
		font-weight: 700;
		border-top: 2px solid #e2e8f0;
	}

	.status-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.status-item {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.status-label {
		font-weight: 500;
		color: #4a5568;
	}

	.status-ok {
		color: #38a169;
		font-weight: 600;
	}

	.status-warn {
		color: #dd6b20;
		font-weight: 600;
	}
</style>
