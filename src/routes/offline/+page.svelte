<script lang="ts">
// #4644: オフライン時の着地ページ。
//
// Service Worker が navigate リクエストの fetch 失敗時にここへ落とす。読み手は年齢帯を
// 問わず子供になり得る (どの画面からの遷移でもここへ来る) ため、文言はひらがな主体の
// 1 種類に固定し年齢帯 variant を持たない (labels.ts の OFFLINE_LABELS が SSOT)。
import { APP_LABELS, OFFLINE_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

function retry(): void {
	// 電波が戻っていれば通常ページが返る。まだなら SW が再びここへ落とすだけで、
	// 子供の操作としては「もういちど ためす」以上の意味を持たせない。
	location.reload();
}
</script>

<svelte:head>
	<title>{OFFLINE_LABELS.pageTitle}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<main class="offline-page" data-testid="offline-page">
	<Card padding="lg">
		<p class="offline-page__icon" aria-hidden="true">{OFFLINE_LABELS.icon}</p>
		<h1 class="offline-page__heading">{OFFLINE_LABELS.heading}</h1>
		<p class="offline-page__body">{OFFLINE_LABELS.body}</p>
		<p class="offline-page__reassurance">{OFFLINE_LABELS.reassurance}</p>
		<div class="offline-page__actions">
			<Button variant="primary" size="lg" onclick={retry} data-testid="offline-retry">
				{OFFLINE_LABELS.retry}
			</Button>
		</div>
	</Card>
</main>

<style>
	.offline-page {
		max-width: 32rem;
		margin: 0 auto;
		padding: 2rem 1rem;
		text-align: center;
	}

	.offline-page__icon {
		font-size: 3.5rem;
		line-height: 1;
		margin: 0 0 0.5rem;
	}

	.offline-page__heading {
		font-size: 1.375rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0 0 0.75rem;
	}

	.offline-page__body {
		font-size: 1rem;
		line-height: 1.8;
		color: var(--color-text-secondary);
		margin: 0 0 0.5rem;
	}

	.offline-page__reassurance {
		font-size: 0.9375rem;
		line-height: 1.8;
		color: var(--color-text-muted);
		margin: 0;
	}

	.offline-page__actions {
		margin-top: 1.5rem;
	}
</style>
