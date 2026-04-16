<script lang="ts">
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();
const a = $derived(data.analytics);
</script>

<svelte:head>
	<title>OPS - 分析基盤</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-8">
	<div class="text-xs text-[var(--color-text-muted)] text-right">
		{new Date(a.fetchedAt).toLocaleString('ja-JP')} 時点
	</div>

	<!-- LTV KPI カード -->
	<section>
		<h2 class="ops-section-title">LTV 推計</h2>
		<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
			<Card padding="none" class="p-5 text-center">
				<div class="ops-kpi-label">推定 LTV</div>
				<div class="ops-kpi-value">¥{a.ltv.estimatedLtv.toLocaleString()}</div>
				<div class="text-xs text-[var(--color-text-muted)] mt-1">= ARPU x 平均継続月</div>
			</Card>
			<Card padding="none" class="p-5 text-center">
				<div class="ops-kpi-label">月次 ARPU</div>
				<div class="ops-kpi-value">¥{a.ltv.monthlyArpu.toLocaleString()}</div>
				<div class="text-xs text-[var(--color-text-muted)] mt-1">有料会員 {a.ltv.activeSubscribers} 名</div>
			</Card>
			<Card padding="none" class="p-5 text-center">
				<div class="ops-kpi-label">平均継続月数</div>
				<div class="ops-kpi-value">{a.ltv.avgLifetimeMonths}</div>
				<div class="text-xs text-[var(--color-text-muted)] mt-1">ヶ月</div>
			</Card>
			<Card padding="none" class="p-5 text-center">
				<div class="ops-kpi-label">チャーンレート</div>
				<div class="ops-kpi-value">{a.ltv.churnRate}%</div>
				<div class="text-xs text-[var(--color-text-muted)] mt-1">解約 {a.ltv.churned} 件</div>
			</Card>
		</div>
	</section>

	<!-- プラン別内訳 + MRR -->
	{#if a.planBreakdown.length > 0}
		<section>
			<Card padding="lg">
				<h2 class="ops-section-title m-0 mb-4">プラン別 MRR 内訳</h2>
				<table class="ops-table">
					<thead>
						<tr>
							<th>プラン</th>
							<th class="ops-num">テナント数</th>
							<th class="ops-num">MRR</th>
							<th class="ops-num">割合</th>
						</tr>
					</thead>
					<tbody>
						{#each a.planBreakdown as pb}
							<tr>
								<td>{pb.plan}</td>
								<td class="ops-num">{pb.count}</td>
								<td class="ops-num">¥{pb.mrr.toLocaleString()}</td>
								<td class="ops-num">{pb.percentage}%</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</Card>
		</section>
	{/if}

	<!-- 月次獲得推移 -->
	{#if a.monthlyAcquisitions.length > 0}
		<section>
			<Card padding="lg">
				<h2 class="ops-section-title m-0 mb-4">月次ユーザー獲得数（過去 12 ヶ月）</h2>
				<table class="ops-table">
					<thead>
						<tr>
							<th>月</th>
							<th class="ops-num">新規登録</th>
						</tr>
					</thead>
					<tbody>
						{#each a.monthlyAcquisitions as ma}
							<tr>
								<td>{ma.month}</td>
								<td class="ops-num">{ma.total}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</Card>
		</section>
	{/if}

	<!-- コホート分析 -->
	{#if a.cohorts.length > 0}
		<section>
			<Card padding="lg">
				<h2 class="ops-section-title m-0 mb-4">コホート残存分析（入会月別）</h2>
				<div class="overflow-x-auto">
					<table class="ops-table">
						<thead>
							<tr>
								<th>入会月</th>
								<th class="ops-num">登録数</th>
								{#each { length: Math.max(...a.cohorts.map((c) => c.retention.length)) } as _, i}
									<th class="ops-num">M{i}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each a.cohorts as cohort}
								<tr>
									<td>{cohort.month}</td>
									<td class="ops-num">{cohort.totalSignups}</td>
									{#each cohort.retention as count, i}
										{@const rate = cohort.totalSignups > 0 ? Math.round((count / cohort.totalSignups) * 100) : 0}
										<td class="ops-num">
											<span class="font-semibold">{count}</span>
											<span class="text-xs text-[var(--color-text-muted)] ml-1">({rate}%)</span>
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="text-xs text-[var(--color-text-muted)] mt-2">
					M0 = 入会月、M1 = 1ヶ月後の残存数（残存率%）。現時点のステータスベースの簡易推計。
				</p>
			</Card>
		</section>
	{/if}

	<!-- Stripe 状態 -->
	<Card padding="lg">
		<h2 class="ops-section-title m-0 mb-4">データソース</h2>
		<div class="flex flex-col gap-2 text-sm">
			<div class="flex gap-2 items-center">
				<span class="font-medium text-[var(--color-neutral-600)]">Stripe 連携:</span>
				<span class={a.stripeEnabled ? 'font-semibold text-[var(--color-success)]' : 'font-semibold text-[var(--color-warning)]'}>
					{a.stripeEnabled ? '有効' : '無効（ローカルモード）'}
				</span>
			</div>
			<div class="flex gap-2 items-center">
				<span class="font-medium text-[var(--color-neutral-600)]">データパイプライン:</span>
				<span class="text-[var(--color-text-muted)]">
					DB 直接集計（リアルタイム、追加コストなし）
				</span>
			</div>
			<p class="text-xs text-[var(--color-text-muted)] mt-1">
				コスト試算: DB 直接クエリのため追加 AWS コストは $0。DynamoDB Streams + Athena への移行は
				ユーザー数 1,000+ で検討（推定 $5-10/月）。
			</p>
		</div>
	</Card>
</div>

<style>
	.ops-section-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-neutral-700);
		margin-bottom: 0.75rem;
	}

	.ops-kpi-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	.ops-kpi-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-neutral-900);
	}

	.ops-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.ops-table th,
	.ops-table td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid var(--color-neutral-100);
	}

	.ops-table th {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.ops-num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
