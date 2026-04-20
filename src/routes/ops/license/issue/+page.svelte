<script lang="ts">
import { enhance } from '$app/forms';
import { getLicensePlanLabel } from '$lib/domain/labels';
import Card from '$lib/ui/primitives/Card.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';

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

		<details class="mb-4 p-3 bg-[var(--color-surface-info)] text-[var(--color-feedback-info-text)] rounded text-sm">
			<summary class="cursor-pointer font-medium">Stripe 100% OFF プロモコードを使う場合（#803）</summary>
			<div class="mt-2 text-[var(--color-text-primary)]">
				<p class="m-0 mb-2">
					公開キャンペーン（SNS 等で URL を配布する）や、Stripe の本人確認を通したい場合は、
					この画面ではなく <strong>Stripe Dashboard の Coupons / Promotion codes</strong> を使ってください。
					100% OFF の Coupon + Promotion code を発行し、「プランを契約する」ボタンから Checkout → プロモコード適用のフローでプランが解放されます。
				</p>
				<ul class="m-0 ml-4 mb-2 list-disc">
					<li>使い分け・運用手順: <code>docs/design/19-プライシング戦略書.md §8</code></li>
					<li>流出対策: Coupon 作成時に Max redemptions / Expires at / First-time order only を必ず設定</li>
					<li>経路 A (本画面) と経路 B (Stripe) の両方とも、発行結果は <a href="/ops" class="underline">/ops の監査ログ</a> または Stripe Dashboard で確認可能</li>
				</ul>
				<a
					href="https://dashboard.stripe.com/coupons"
					target="_blank"
					rel="noopener noreferrer"
					class="underline"
				>Stripe Dashboard → Coupons を開く</a>
			</div>
		</details>

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
			<NativeSelect
				name="plan"
				label="プラン（必須）"
				required
				options={plans.map((plan: string) => ({ value: plan, label: getLicensePlanLabel(plan) }))}
			/>

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

			<NativeSelect
				name="expiresAt"
				label="有効期限"
				options={[
					{ value: 'default', label: 'デフォルト (発行から 90 日)' },
					{ value: 'never', label: '期限なし (lifetime 的扱い)' },
				]}
			/>

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
						プラン: {getLicensePlanLabel(form.plan)} ／ 理由: {form.reason} ／ 有効期限: {form.expiresAt}
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
