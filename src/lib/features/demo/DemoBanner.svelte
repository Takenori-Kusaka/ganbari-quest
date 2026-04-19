<script lang="ts">
/**
 * ADR-0039 / #1180: デモ実行モード用の上部固定バナー。
 *
 * - 本番ルート上で `$page.data.isDemo === true` のとき表示
 * - 文言は `labels.ts` の `DEMO_LABELS` SSOT 経由（ADR-0037）
 * - 退出ボタン（cookie を消して `/` へ）と「ほんとうに始める」CTA を常設
 * - #1181 の `?screenshot=1` / `hideDemoOverlays` band-aid は本バナー採用で撤去
 */
import { DEMO_LABELS } from '$lib/domain/labels';

interface Props {
	isDemo: boolean;
}

let { isDemo }: Props = $props();
</script>

{#if isDemo}
	<div
		class="sticky top-0 z-50 flex items-center gap-2 px-3 py-2 text-sm border-b bg-[var(--color-feedback-warning-bg)] border-[var(--color-feedback-warning-border)] text-[var(--color-feedback-warning-text)]"
		role="status"
		data-testid="demo-banner"
	>
		<span class="shrink-0" aria-hidden="true">🧪</span>
		<div class="flex-1 min-w-0">
			<p class="font-bold leading-tight">{DEMO_LABELS.bannerTitle}</p>
			<p class="text-xs leading-snug opacity-90">{DEMO_LABELS.bannerDescription}</p>
		</div>
		<a
			href={DEMO_LABELS.signupHref}
			class="shrink-0 px-3 py-1 rounded-lg bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] text-xs font-bold whitespace-nowrap"
			data-testid="demo-banner-signup"
		>
			{DEMO_LABELS.ctaStart}
		</a>
		<a
			href={DEMO_LABELS.exitHref}
			class="shrink-0 px-2 py-1 text-xs underline whitespace-nowrap"
			data-testid="demo-banner-exit"
		>
			{DEMO_LABELS.ctaExit}
		</a>
	</div>
{/if}
