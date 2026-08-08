<script lang="ts">
// EPIC #4118 手 3 — 契約状態監査の表示。
//
// `/ops` に inline で書かず component に切り出している。理由は 2 つ:
//   - 不正行がある状態は demo fixture では作れず、実画面 SS が撮れない。
//     Storybook なら 3 状態 (正常 / 問題あり / 上限超過) を目で確認できる (#4087)
//   - `/ops` の template が既に長く、section 単位で読めるようにする

import { OPS_LABELS } from '$lib/domain/labels';
import type { ContractStateAuditResult } from '$lib/server/services/contract-state-audit-service';
import Badge from '$lib/ui/primitives/Badge.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { audit }: { audit: ContractStateAuditResult } = $props();

/** 表示を省略した分も含めた「要確認」の総数。 */
const problemTotal = $derived(audit.problemRows.length + audit.truncated);

/** 4 列の有無を「あり / なし」で並べる (値そのものは出さない = PII を持ち出さない)。 */
function columnsSummary(row: ContractStateAuditResult['problemRows'][number]): string {
	const yes = OPS_LABELS.contractStateHas;
	const no = OPS_LABELS.contractStateNone;
	return [
		row.hasPlan ? yes : no,
		row.hasSubscription ? yes : no,
		row.hasPlanExpiresAt ? yes : no,
	].join(' / ');
}
</script>

<Card padding="lg">
	<h2 class="text-base font-semibold m-0 mb-2 text-[var(--color-text-primary)]">
		{OPS_LABELS.contractStateTitle}
		{#if problemTotal > 0}
			<Badge variant="warning" size="sm">{OPS_LABELS.contractStateFound(problemTotal)}</Badge>
		{:else}
			<Badge variant="success" size="sm">{OPS_LABELS.bypassNormal}</Badge>
		{/if}
	</h2>
	<p class="text-sm text-[var(--color-text-muted)] mb-4">{OPS_LABELS.contractStateDesc}</p>

	{#if audit.problemRows.length === 0}
		<p class="text-sm text-[var(--color-text-muted)]">
			{OPS_LABELS.contractStateHealthy(audit.total)}
		</p>
	{:else}
		<table class="ops-table" data-testid="ops-contract-state-table">
			<thead>
				<tr>
					<th>{OPS_LABELS.contractStateColTenant}</th>
					<th>{OPS_LABELS.contractStateColClassification}</th>
					<th>{OPS_LABELS.contractStateColStatus}</th>
					<th>{OPS_LABELS.contractStateColColumns}</th>
				</tr>
			</thead>
			<tbody>
				{#each audit.problemRows as row (row.tenantId)}
					<tr>
						<td>{row.tenantId}</td>
						<td>{row.classification}</td>
						<td>{row.status}</td>
						<td>{columnsSummary(row)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if audit.truncated > 0}
			<p class="text-sm text-[var(--color-text-muted)] mt-2" role="status">
				{OPS_LABELS.contractStateTruncated(audit.truncated)}
			</p>
		{/if}
	{/if}

	<!--
		#4269 ①: 継続月キーの滞留在庫。**0 件でも必ず出す** — 行が消えると
		「調べて 0 件だった」のか「そもそも見ていない」のかが区別できなくなる。
	-->
	<div class="month-key-row" data-testid="ops-loyalty-month-key">
		<div class="month-key-head">
			<span>{OPS_LABELS.loyaltyMonthKeyLabel}</span>
			<Badge variant={audit.loyaltyMonthKeys.legacy > 0 ? 'warning' : 'success'} size="sm">
				{OPS_LABELS.loyaltyMonthKeyCount(
					audit.loyaltyMonthKeys.legacy,
					audit.loyaltyMonthKeys.total,
				)}
			</Badge>
		</div>
		<p class="month-key-desc">{OPS_LABELS.loyaltyMonthKeyDesc}</p>
	</div>
</Card>

<style>
.ops-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.875rem;
}
.ops-table th,
.ops-table td {
	text-align: left;
	padding: 0.375rem 0.5rem;
	border-bottom: 1px solid var(--color-border-light);
}
.ops-table th {
	color: var(--color-text-muted);
	font-weight: 600;
}
.month-key-row {
	margin-top: 1rem;
	padding-top: 0.75rem;
	border-top: 1px solid var(--color-border-light);
}
.month-key-head {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex-wrap: wrap;
	font-size: 0.875rem;
	font-weight: 600;
	color: var(--color-text-primary);
}
.month-key-desc {
	margin-top: 0.25rem;
	font-size: 0.8125rem;
	color: var(--color-text-muted);
}
</style>
