<script lang="ts">
	import Card from '$lib/ui/primitives/Card.svelte';

	let { form } = $props();
</script>

<svelte:head>
	<title>OPS - ライセンスキー管理</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex justify-end">
		<a
			href="/ops/license/issue"
			class="px-3 py-2 bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] rounded text-sm font-medium no-underline"
		>＋ キャンペーンキーを発行</a>
	</div>

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
</div>
