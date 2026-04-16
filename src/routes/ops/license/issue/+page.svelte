<script lang="ts">
import { enhance } from '$app/forms';
import { getPlanLabel } from '$lib/domain/labels';
import Card from '$lib/ui/primitives/Card.svelte';

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
	<title>OPS - キャンペーンキー発行</title>
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
		<h1 class="text-lg font-bold m-0 mb-1">キャンペーンキー一括発行</h1>
		<p class="text-sm text-[var(--color-text-muted)] mt-0 mb-4">
			Stripe を経由せず、プレゼント・サポート補償・キャンペーン配布用のライセンスキーを発行します。
			発行結果は CSV ダウンロードで受け取り、運営ツール (メール/LINE 等) で配布してください。
			発行操作はすべて監査ログに記録されます。
		</p>

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
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium">プラン（必須）</span>
				<select
					name="plan"
					required
					class="px-3 py-2 border border-[var(--color-border-default)] rounded text-sm"
				>
					{#each plans as plan (plan)}
						<option value={plan}>{getPlanLabel(plan)}</option>
					{/each}
				</select>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium">数量（必須・1〜500）</span>
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
				<span class="text-sm font-medium">キャンペーン名 / 理由（必須）</span>
				<input
					type="text"
					name="reason"
					placeholder="例: 2026春_幼稚園キャンペーン / CS-1234 補填"
					required
					maxlength="200"
					class="px-3 py-2 border border-[var(--color-border-default)] rounded text-sm"
				/>
				<span class="text-xs text-[var(--color-text-muted)]">監査ログとレコードの tenantId に記録されます。</span>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium">有効期限</span>
				<select
					name="expiresAt"
					class="px-3 py-2 border border-[var(--color-border-default)] rounded text-sm"
				>
					<option value="default">デフォルト (発行から 90 日)</option>
					<option value="never">期限なし (lifetime 的扱い)</option>
				</select>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium">発行プール ID（任意）</span>
				<input
					type="text"
					name="tenantId"
					placeholder="省略時は campaign:<理由> を自動採番"
					class="px-3 py-2 border border-[var(--color-border-default)] rounded text-sm font-mono"
				/>
				<span class="text-xs text-[var(--color-text-muted)]">record.tenantId に入る値。同一キャンペーンで揃えると後から検索しやすい。</span>
			</label>

			<div class="flex gap-2 justify-end mt-2">
				<button
					type="submit"
					disabled={submitting}
					class="px-4 py-2 bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] rounded font-medium disabled:opacity-50"
				>
					{submitting ? '発行中...' : 'キーを発行する'}
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
					<h2 class="text-base font-semibold m-0 mb-1">発行結果 ({form.keys.length} 件)</h2>
					<p class="text-sm text-[var(--color-text-muted)] m-0">
						プラン: {getPlanLabel(form.plan)} ／ 理由: {form.reason} ／ 有効期限: {form.expiresAt}
					</p>
				</div>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={copyAll}
						class="px-3 py-2 border border-[var(--color-border-default)] rounded text-sm"
					>全てコピー</button>
					<button
						type="button"
						onclick={downloadCsv}
						class="px-3 py-2 bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] rounded text-sm font-medium"
					>CSV ダウンロード</button>
				</div>
			</div>

			{#if form.errors}
				<div class="mb-3 p-3 bg-[var(--color-feedback-warning-bg)] text-[var(--color-feedback-warning-text)] rounded text-sm">
					{form.errors.length} 件は発行に失敗しました（ログを確認してください）。
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
