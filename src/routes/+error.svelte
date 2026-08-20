<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { APP_LABELS, ERROR_PAGE_LABELS, getChildErrorPageLabels } from '$lib/domain/labels';
import { UI_MODES } from '$lib/domain/validation/age-tier';
import OpsMfaSetupNotice from '$lib/features/ops/OpsMfaSetupNotice.svelte';

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
/**
 * #4690 F3: 子供画面かどうかを **URL からも** 判定する。
 *
 * 旧実装は `page.data.role` だけを見ていたが、存在しないパス (例 `/preschool/battle`)
 * では子供 layout の load が走らず role が null になり、3〜5 歳の画面に保護者向けの
 * 「お探しのページは存在しないか、移動した可能性があります。」が出ていた。
 * URL 先頭が年齢モードなら、role が解決できなくても子供画面として扱う。
 */
const uiModeFromPath = $derived.by(() => {
	// エラー画面自身が例外で落ちると復旧導線ごと消えるため、URL の欠落に耐える形で読む。
	const first = page.url?.pathname?.split('/')[1] ?? '';
	return (UI_MODES as readonly string[]).includes(first) ? first : null;
});
// "child" ロール、または URL が年齢モード配下なら子供画面。それ以外は親扱い。
const isChild = $derived(role === 'child' || uiModeFromPath !== null);
/** 子供文言は年齢帯で文体が変わる (docs/DESIGN.md §8)。mode 不明時はひらがな側に倒す。 */
const childLabels = $derived(getChildErrorPageLabels(uiModeFromPath ?? 'preschool'));

/**
 * #4282: `/ops` が MFA 未設定で 403 になったときだけ、汎用の 403 ではなく設定導線を出す。
 * #4363 で MFA 要求が off になったため現在この分岐には入らない (`OPS_MFA_REQUIRED` を戻すと復活)。
 * 判定キーは route guard が載せた reason のみ (メッセージ本文は表示しない = 内部例外の
 * 非露出、ADR-0062)。ops 以外の 403 は reason が付かないので従来表示のまま。
 */
const isOpsMfaRequired = $derived(status === 403 && page.error?.reason === 'ops-mfa-required');

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

{#if isOpsMfaRequired}
	<OpsMfaSetupNotice />
{:else}
<div class="error-page" data-role={isChild ? 'child' : 'parent'}>
	<div class="error-container">
		<p class="error-status">{status}</p>
		<h1 class="error-title">
			{#if status === 404}
				{isChild ? childLabels.title404 : ERROR_PAGE_LABELS.title404}
			{:else if status === 429}
				{isChild ? childLabels.title429 : ERROR_PAGE_LABELS.title429}
			{:else if status === 403}
				{isChild ? childLabels.title403 : ERROR_PAGE_LABELS.title403}
			{:else}
				{isChild ? childLabels.titleDefault : ERROR_PAGE_LABELS.titleDefault}
			{/if}
		</h1>

		<p class="error-description">
			{#if status === 404}
				{#if isChild}
					{childLabels.desc404}
				{:else}
					{ERROR_PAGE_LABELS.desc404Parent}
				{/if}
			{:else if status === 429}
				{ERROR_PAGE_LABELS.desc429}
			{:else if status === 403}
				{#if isChild}
					{childLabels.desc403}
				{:else}
					{ERROR_PAGE_LABELS.desc403Parent}
				{/if}
			{:else if isChild}
				{childLabels.descGeneric}
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
					{childLabels.btnBackNow}
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
{/if}

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
