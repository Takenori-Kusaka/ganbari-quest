<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { APP_LABELS, ERROR_PAGE_LABELS } from '$lib/domain/labels';

/**
 * #577: ロール別の自動復帰 + エラー種別ごとの導線
 *
 * 親 (parent/owner) は手動操作を基本とし、
 * 子供 (child) は 404/403/500 で自動的に /switch にフォールバックする。
 * 429 は Retry-After を尊重してカウントダウン表示する。
 */

const status = $derived(page.status);
const requestId = $derived((page.data as { requestId?: string | null })?.requestId ?? null);
const role = $derived((page.data as { role?: string | null })?.role ?? null);
// "child" ロールは子供画面。それ以外（owner/editor/viewer/null）は親扱い
const isChild = $derived(role === 'child');

const AUTO_REDIRECT_SECONDS = 3;
let countdown = $state(AUTO_REDIRECT_SECONDS);
let timerId: ReturnType<typeof setInterval> | null = null;

// 子供ロール × (404 / 403 / 500) のとき自動リダイレクト
const shouldAutoRedirect = $derived(
	isChild && (status === 404 || status === 403 || status === 500),
);

function startCountdown(target: string) {
	countdown = AUTO_REDIRECT_SECONDS;
	timerId = setInterval(() => {
		countdown -= 1;
		if (countdown <= 0) {
			if (timerId) clearInterval(timerId);
			goto(target);
		}
	}, 1000);
}

onMount(() => {
	if (shouldAutoRedirect) {
		startCountdown('/switch');
	}
});

onDestroy(() => {
	if (timerId) clearInterval(timerId);
});

function handleRetry() {
	window.location.reload();
}
</script>

<svelte:head>
	<title>{status}{APP_LABELS.errorPageTitlePart}</title>
</svelte:head>

<div class="error-page" data-role={isChild ? 'child' : 'parent'}>
	<div class="error-container">
		<p class="error-status">{status}</p>
		<h1 class="error-title">
			{#if status === 404}
				{ERROR_PAGE_LABELS.title404}
			{:else if status === 429}
				{ERROR_PAGE_LABELS.title429}
			{:else if status === 403}
				{ERROR_PAGE_LABELS.title403}
			{:else}
				{ERROR_PAGE_LABELS.titleDefault}
			{/if}
		</h1>

		<p class="error-description">
			{#if status === 404}
				{#if isChild}
					{ERROR_PAGE_LABELS.desc404Child}
				{:else}
					{ERROR_PAGE_LABELS.desc404Parent}
				{/if}
			{:else if status === 429}
				{ERROR_PAGE_LABELS.desc429}
			{:else if status === 403}
				{#if isChild}
					{ERROR_PAGE_LABELS.desc403Child}
				{:else}
					{ERROR_PAGE_LABELS.desc403Parent}
				{/if}
			{:else if isChild}
				{ERROR_PAGE_LABELS.descGenericChild}
			{:else}
				{ERROR_PAGE_LABELS.descGenericParent}
			{/if}
		</p>

		{#if shouldAutoRedirect}
			<p class="countdown" aria-live="polite">
				{countdown}
			</p>
		{/if}

		<div class="actions">
			{#if isChild}
				<!-- 子供は単一の大きな戻るボタン（カウントダウン中も手動で即遷移可能） -->
				<a href="/switch" class="btn btn-primary btn-child">
					{ERROR_PAGE_LABELS.btnBackNow}
				</a>
			{:else}
				<!-- 親は状況に応じた導線 -->
				{#if status === 403}
					<a href="/auth/login" class="btn btn-primary">{ERROR_PAGE_LABELS.btnLoginAgain}</a>
					<a href="/" class="btn btn-secondary">{ERROR_PAGE_LABELS.btnBackToTop}</a>
				{:else if status === 500}
					<button type="button" class="btn btn-primary" onclick={handleRetry}>
						{ERROR_PAGE_LABELS.btnRetry}
					</button>
					<a href="/" class="btn btn-secondary">{ERROR_PAGE_LABELS.btnBackToTop}</a>
				{:else if status === 429}
					<a href="/" class="btn btn-secondary">{ERROR_PAGE_LABELS.btnBackToTop}</a>
				{:else}
					<a href="/" class="btn btn-primary">{ERROR_PAGE_LABELS.btnBackToTop}</a>
				{/if}
			{/if}
		</div>

		{#if requestId && !isChild}
			<p class="error-id">
				{ERROR_PAGE_LABELS.errorIdPrefix}<code>{requestId}</code>
			</p>
		{/if}
	</div>
</div>

<style>
	.error-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--color-surface-base);
		padding: 1rem;
	}

	.error-container {
		text-align: center;
		max-width: 480px;
	}

	.error-status {
		font-size: 4rem;
		font-weight: 700;
		color: var(--color-action-primary);
		margin: 0 0 0.5rem;
		line-height: 1;
	}

	.error-title {
		font-size: 1.25rem;
		margin: 0 0 1rem;
		color: var(--color-text);
	}

	.error-description {
		color: var(--color-text-muted);
		line-height: 1.6;
		margin: 0 0 1.5rem;
	}

	.countdown {
		font-size: 3rem;
		font-weight: 700;
		color: var(--color-action-primary);
		margin: 1rem 0;
		line-height: 1;
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 1.5rem 0;
	}

	.btn {
		display: inline-block;
		padding: 0.75rem 1.5rem;
		border-radius: var(--radius-md);
		text-decoration: none;
		font-weight: 600;
		border: none;
		cursor: pointer;
		font-size: 1rem;
	}

	.btn-primary {
		background: var(--color-action-primary);
		color: var(--color-text-inverse);
	}

	.btn-primary:hover {
		opacity: 0.9;
	}

	.btn-secondary {
		background: var(--color-surface-card);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}

	/* child role: larger tap target + simple single action */
	.error-page[data-role='child'] .error-title {
		font-size: 1.75rem;
	}
	.error-page[data-role='child'] .error-description {
		font-size: 1.125rem;
	}
	.btn-child {
		padding: 1.25rem 2rem;
		font-size: 1.25rem;
		min-height: 60px;
	}

	.error-id {
		margin-top: 2rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.error-id code {
		font-family: monospace;
		background: var(--color-surface-card);
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
	}
</style>
