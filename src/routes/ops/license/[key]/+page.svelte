<script lang="ts">
import { enhance } from '$app/forms';
import Card from '$lib/ui/primitives/Card.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

let { data, form } = $props();
const record = $derived(data.record);
const licenseKey = $derived(data.licenseKey);

let confirmOpen = $state(false);
let selectedReason = $state<'ops-manual' | 'leaked' | 'refund' | 'expired'>('ops-manual');
let note = $state('');
let submitting = $state(false);

const isActive = $derived(record?.status === 'active');
const canRevoke = $derived(isActive);

function statusLabel(s: string): string {
	switch (s) {
		case 'active':
			return '有効';
		case 'consumed':
			return '使用済';
		case 'revoked':
			return '失効';
		default:
			return s;
	}
}

function reasonLabel(r: string): string {
	switch (r) {
		case 'ops-manual':
			return 'サポート手動失効';
		case 'leaked':
			return 'シークレット漏洩';
		case 'refund':
			return 'Stripe 返金';
		case 'expired':
			return '期限切れ';
		default:
			return r;
	}
}
</script>

<svelte:head>
	<title>OPS - {licenseKey}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-6">
	<div>
		<a
			href="/ops/license"
			class="text-sm text-[var(--color-text-link)] hover:underline"
		>← ライセンス一覧に戻る</a>
	</div>

	<Card padding="lg">
		<div class="flex justify-between items-start gap-4 flex-wrap">
			<div>
				<div class="text-xs text-[var(--color-text-muted)] mb-1">ライセンスキー</div>
				<h1 class="font-mono text-lg font-bold m-0 break-all">{licenseKey}</h1>
			</div>
			{#if record}
				<span class="status-badge status-{record.status}">
					{statusLabel(record.status)}
				</span>
			{:else}
				<span class="status-badge status-missing">レコードなし</span>
			{/if}
		</div>

		{#if record}
			<dl class="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
				<dt class="text-[var(--color-text-muted)]">Tenant ID</dt>
				<dd class="font-mono">{record.tenantId}</dd>

				<dt class="text-[var(--color-text-muted)]">プラン</dt>
				<dd>{record.plan}</dd>

				<dt class="text-[var(--color-text-muted)]">種別</dt>
				<dd>{record.kind ?? 'purchase'}</dd>

				<dt class="text-[var(--color-text-muted)]">発行日時</dt>
				<dd>{new Date(record.createdAt).toLocaleString('ja-JP')}</dd>

				{#if record.expiresAt}
					<dt class="text-[var(--color-text-muted)]">有効期限</dt>
					<dd>{new Date(record.expiresAt).toLocaleString('ja-JP')}</dd>
				{/if}

				{#if record.issuedBy}
					<dt class="text-[var(--color-text-muted)]">発行者</dt>
					<dd class="font-mono text-xs">{record.issuedBy}</dd>
				{/if}

				{#if record.consumedBy}
					<dt class="text-[var(--color-text-muted)]">使用テナント</dt>
					<dd class="font-mono text-xs">{record.consumedBy}</dd>
				{/if}
				{#if record.consumedAt}
					<dt class="text-[var(--color-text-muted)]">使用日時</dt>
					<dd>{new Date(record.consumedAt).toLocaleString('ja-JP')}</dd>
				{/if}

				{#if record.revokedAt}
					<dt class="text-[var(--color-text-muted)]">失効日時</dt>
					<dd>{new Date(record.revokedAt).toLocaleString('ja-JP')}</dd>
				{/if}
				{#if record.revokedReason}
					<dt class="text-[var(--color-text-muted)]">失効理由</dt>
					<dd>{reasonLabel(record.revokedReason)}</dd>
				{/if}
				{#if record.revokedBy}
					<dt class="text-[var(--color-text-muted)]">失効実行者</dt>
					<dd class="font-mono text-xs">{record.revokedBy}</dd>
				{/if}
			</dl>
		{:else}
			<p class="mt-4 text-sm text-[var(--color-text-muted)]">
				このキーの永続レコードが見つかりません（SQLite ローカルモードでは永続化されません）。
				</p>
		{/if}

		{#if canRevoke}
			<div class="mt-6 pt-4 border-t border-[var(--color-border-light)]">
				<button
					type="button"
					onclick={() => {
						confirmOpen = true;
					}}
					class="px-4 py-2 bg-[var(--color-action-danger)] text-[var(--color-text-inverse)] rounded font-medium"
				>
					このキーを失効させる
				</button>
			</div>
		{/if}

		{#if form?.revoked}
			<div class="mt-4 p-3 bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)] rounded text-sm">
				キーを失効させました (理由: {reasonLabel(form.reason ?? '')})
			</div>
		{/if}
		{#if form?.error}
			<div class="mt-4 p-3 bg-[var(--color-feedback-error-bg)] text-[var(--color-feedback-error-text)] rounded text-sm">
				{form.error}
			</div>
		{/if}
	</Card>
</div>

{#if confirmOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="overlay"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) confirmOpen = false;
		}}
	>
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="revoke-title">
			<h3 id="revoke-title" class="text-base font-semibold m-0 mb-3">ライセンスキーを失効させる</h3>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">
				この操作は取り消せません。失効後、このキーはすぐに validate で拒否されます。
			</p>

			<form
				method="POST"
				action="?/revoke"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
						confirmOpen = false;
					};
				}}
			>
				<div class="mb-3">
					<NativeSelect
						name="reason"
						label="失効理由（必須）"
						bind:value={selectedReason}
						required
						options={[
							{ value: 'ops-manual', label: reasonLabel('ops-manual') },
							{ value: 'leaked', label: reasonLabel('leaked') },
							{ value: 'refund', label: reasonLabel('refund') },
							{ value: 'expired', label: reasonLabel('expired') },
						]}
					/>
				</div>

				<label class="flex flex-col gap-1 mb-4">
					<span class="text-xs text-[var(--color-text-muted)]">メモ（任意）</span>
					<textarea
						name="note"
						bind:value={note}
						rows="3"
						placeholder="CS チケット番号や状況メモ"
						class="px-3 py-2 border border-[var(--color-border-default)] rounded text-sm resize-y"
					></textarea>
				</label>

				<div class="flex gap-2 justify-end">
					<button
						type="button"
						onclick={() => {
							confirmOpen = false;
						}}
						class="px-4 py-2 border border-[var(--color-border-default)] rounded font-medium"
						disabled={submitting}
					>
						キャンセル
					</button>
					<button
						type="submit"
						class="px-4 py-2 bg-[var(--color-action-danger)] text-[var(--color-text-inverse)] rounded font-medium disabled:opacity-50"
						disabled={submitting}
					>
						{submitting ? '処理中...' : '失効を確定'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

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

	.status-badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--color-surface-muted);
		color: var(--color-text-secondary);
	}
	.status-badge.status-active {
		background: var(--color-feedback-success-bg);
		color: var(--color-feedback-success-text);
	}
	.status-badge.status-consumed {
		background: var(--color-feedback-info-bg);
		color: var(--color-feedback-info-text);
	}
	.status-badge.status-revoked {
		background: var(--color-feedback-error-bg);
		color: var(--color-feedback-error-text);
	}
	.status-badge.status-missing {
		background: var(--color-surface-muted);
		color: var(--color-text-muted);
	}

	.overlay {
		position: fixed;
		inset: 0;
		background: var(--color-surface-overlay);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}
	.modal {
		background: var(--color-surface-card);
		padding: 1.5rem;
		border-radius: 0.5rem;
		max-width: 32rem;
		width: 100%;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
	}
</style>
