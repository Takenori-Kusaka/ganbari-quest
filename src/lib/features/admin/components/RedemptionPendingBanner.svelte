<script lang="ts">
import { ADMIN_HOME_LABELS } from '$lib/domain/labels';

// #3144 / #3148: ごほうび交換の承認待ち導線バナー。
// - variant='pending': pending > 0 の発見性バナー (件数を表示)。
// - variant='error': 件数取得失敗時の導線 (true-0 と failure-0 を区別し silent 非表示を避ける)。
// 表示判定 (件数 > 0 / failed) は呼び出し側 (admin/+page.svelte) が担い、本コンポーネントは
// 渡された variant に応じた markup を描画する presentational component。
interface Props {
	variant: 'pending' | 'error';
	/** variant='pending' のときの承認待ち件数 */
	count?: number;
}

let { variant, count = 0 }: Props = $props();
</script>

<!-- #3185: バナーは「失敗/件数を告知する live region」かつ「対処画面へ遷移する link」の二役。
     role="alert"/"status" は link role を上書きし SR が「リンク (対処可能)」と認識できなくなるため
     使わず、aria-live で出現時にテキストを読み上げさせつつ link 役割を保持する。
     error (件数取得失敗) は assertive、pending (新規発見性) は polite。 -->
{#if variant === 'pending'}
	<a class="redemption-pending-banner" href="/admin/rewards/requests" data-testid="redemption-pending-banner" aria-live="polite">
		<span class="redemption-pending-banner__icon" aria-hidden="true">🎁</span>
		<span class="redemption-pending-banner__text">{ADMIN_HOME_LABELS.pendingRedemptionBanner(count)}</span>
		<span class="redemption-pending-banner__cta" aria-hidden="true">▶</span>
	</a>
{:else}
	<a class="redemption-pending-banner redemption-pending-banner--error" href="/admin/rewards/requests" data-testid="redemption-pending-banner-error" aria-live="assertive">
		<span class="redemption-pending-banner__icon" aria-hidden="true">⚠️</span>
		<span class="redemption-pending-banner__text">{ADMIN_HOME_LABELS.pendingRedemptionLoadFailed}</span>
		<span class="redemption-pending-banner__cta" aria-hidden="true">▶</span>
	</a>
{/if}

<style>
	.redemption-pending-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 16px;
		padding: 0.875rem 1rem;
		border: 1px solid var(--color-border-warning);
		border-radius: 0.75rem;
		background: var(--color-surface-warning);
		color: var(--color-text-warm);
		text-decoration: none;
		font-weight: 600;
	}
	.redemption-pending-banner:hover {
		background: var(--color-feedback-warning-bg-strong);
	}
	/* #3148: error variant for count-load failure (error semantic tokens, not warning) */
	.redemption-pending-banner--error {
		border-color: var(--color-feedback-error-border);
		background: var(--color-surface-error);
		color: var(--color-feedback-error-text);
	}
	.redemption-pending-banner--error:hover {
		background: var(--color-feedback-error-bg-strong);
	}
	.redemption-pending-banner__icon {
		font-size: 1.25rem;
	}
	.redemption-pending-banner__text {
		flex: 1;
		min-width: 0;
	}
	.redemption-pending-banner__cta {
		color: var(--color-text-warm-muted);
	}
</style>
