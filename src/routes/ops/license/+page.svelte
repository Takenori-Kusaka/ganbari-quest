<script lang="ts">
import Card from '$lib/ui/primitives/Card.svelte';

let { data, form } = $props();
const events = $derived(data.events);

function formatKey(key: string): string {
	if (key.length <= 10) return key;
	return `${key.slice(0, 12)}...`;
}

function eventTypeLabel(t: string): string {
	switch (t) {
		case 'issued':
			return '発行';
		case 'validated':
			return '検証成功';
		case 'validation_failed':
			return '検証失敗';
		case 'consumed':
			return '使用';
		case 'consume_failed':
			return '使用失敗';
		case 'revoked':
			return '失効';
		default:
			return t;
	}
}
</script>

<svelte:head>
	<title>OPS - ライセンスキー管理</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-6">
	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-neutral-700)]">
			ライセンスキー検索
		</h2>
		<form method="POST" action="?/search" class="flex gap-2 items-end">
			<label class="flex flex-col gap-1 flex-1">
				<span class="text-xs text-[var(--color-text-muted)]">ライセンスキー</span>
				<input
					type="text"
					name="licenseKey"
					required
					placeholder="GQ-XXXX-XXXX-XXXX-YYYYY"
					class="px-3 py-2 border border-[var(--color-border-default)] rounded font-mono text-sm"
				/>
			</label>
			<button
				type="submit"
				class="px-4 py-2 bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] rounded font-medium"
			>
				検索
			</button>
		</form>
		{#if form?.error}
			<p class="mt-2 text-sm text-[var(--color-feedback-error-text)]">{form.error}</p>
		{/if}
	</Card>

	<Card padding="lg">
		<h2 class="text-base font-semibold m-0 mb-4 text-[var(--color-neutral-700)]">
			最近のライセンスイベント ({events.length} 件)
		</h2>
		{#if events.length === 0}
			<p class="text-sm text-[var(--color-text-muted)]">まだイベントがありません。</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="ops-table w-full">
					<thead>
						<tr>
							<th>時刻</th>
							<th>種別</th>
							<th>キー</th>
							<th>Tenant</th>
							<th>Actor</th>
							<th>IP</th>
						</tr>
					</thead>
					<tbody>
						{#each events as ev (ev.id)}
							<tr>
								<td>{new Date(ev.createdAt).toLocaleString('ja-JP')}</td>
								<td>
									<span class="event-badge event-{ev.eventType}">
										{eventTypeLabel(ev.eventType)}
									</span>
								</td>
								<td>
									<a
										href="/ops/license/{encodeURIComponent(ev.licenseKey)}"
										class="font-mono text-xs text-[var(--color-text-link)] hover:underline"
									>
										{formatKey(ev.licenseKey)}
									</a>
								</td>
								<td class="text-xs">{ev.tenantId ?? '-'}</td>
								<td class="text-xs">{ev.actorId ?? '-'}</td>
								<td class="text-xs">{ev.ip ?? '-'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>
</div>

<style>
	.ops-table {
		border-collapse: collapse;
	}

	.ops-table th,
	.ops-table td {
		padding: 0.5rem 0.75rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border-light);
	}

	.ops-table th {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.event-badge {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
		font-size: 0.7rem;
		font-weight: 600;
		background: var(--color-surface-muted);
		color: var(--color-text-secondary);
	}

	.event-badge.event-issued,
	.event-badge.event-validated,
	.event-badge.event-consumed {
		background: var(--color-feedback-success-bg);
		color: var(--color-feedback-success-text);
	}

	.event-badge.event-revoked {
		background: var(--color-feedback-error-bg);
		color: var(--color-feedback-error-text);
	}

	.event-badge.event-validation_failed,
	.event-badge.event-consume_failed {
		background: var(--color-feedback-warning-bg);
		color: var(--color-feedback-warning-text);
	}
</style>
