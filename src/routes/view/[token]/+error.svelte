<script lang="ts">
import { page } from '$app/state';
import { APP_LABELS, VIEW_PAGE_LABELS } from '$lib/domain/labels';

/**
 * #4703: 閲覧リンク専用のエラー画面。
 *
 * 無効 / 期限切れ token を root の `+error.svelte` に落とすと汎用の
 * 「ページが みつかりません」しか出ず、リンクを共有された人 (祖父母等) は
 * 自分の操作を疑ってしまう。リンクの状態を説明し、共有元に依頼する導線を出す。
 *
 * 判定キーは load が載せた `reason` のみ (message 本文は表示しない = 内部例外の
 * 非露出、ADR-0062)。それ以外の error は汎用表示のままにする。
 */
const isInvalidToken = $derived(page.error?.reason === 'viewer-token-invalid');
</script>

<svelte:head>
	<title>{page.status}{APP_LABELS.errorPageTitlePart}</title>
</svelte:head>

<div class="viewer-error">
	{#if isInvalidToken}
		<h1 class="viewer-error__title" data-testid="viewer-token-invalid-title">
			{VIEW_PAGE_LABELS.invalidTokenTitle}
		</h1>
		<p class="viewer-error__desc">{VIEW_PAGE_LABELS.invalidTokenDesc}</p>
	{:else}
		<p class="viewer-error__status">{page.status}</p>
		<h1 class="viewer-error__title">{APP_LABELS.name}</h1>
	{/if}
	<p class="viewer-error__footer">{VIEW_PAGE_LABELS.footerText}</p>
</div>

<style>
	.viewer-error {
		max-width: 600px;
		margin: 0 auto;
		padding: 3rem 1rem;
		text-align: center;
	}

	.viewer-error__status {
		font-size: 3rem;
		font-weight: 700;
		color: var(--color-action-primary);
		margin: 0 0 0.5rem;
		line-height: 1;
	}

	.viewer-error__title {
		font-size: 1.25rem;
		margin: 0 0 1rem;
		color: var(--color-text);
	}

	.viewer-error__desc {
		color: var(--color-text-muted);
		line-height: 1.7;
		margin: 0 0 2rem;
	}

	.viewer-error__footer {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
