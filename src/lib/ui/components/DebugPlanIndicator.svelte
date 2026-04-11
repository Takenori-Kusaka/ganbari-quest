<script lang="ts">
// 開発モード専用 — DEBUG_PLAN / DEBUG_TRIAL の現在状態を可視化 (#758)
// summary が null の場合は何も描画しない（prod では常に null が渡る想定）。

let { summary }: { summary: string | null } = $props();
</script>

{#if summary}
	<div class="debug-plan-indicator" role="status" aria-label="Debug plan override" data-testid="debug-plan-indicator">
		<span class="debug-plan-indicator__label">DEBUG</span>
		<span class="debug-plan-indicator__value">{summary}</span>
	</div>
{/if}

<style>
	.debug-plan-indicator {
		position: fixed;
		bottom: 0.75rem;
		right: 0.75rem;
		z-index: 9999;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		background: var(--color-feedback-warning-bg-strong);
		color: var(--color-feedback-warning-text);
		border: 1px solid var(--color-feedback-warning-border);
		border-radius: 0.5rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.6875rem;
		font-weight: 600;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		pointer-events: none;
	}
	.debug-plan-indicator__label {
		padding: 0.0625rem 0.25rem;
		background: var(--color-feedback-warning-text);
		color: var(--color-feedback-warning-bg);
		border-radius: 0.25rem;
		letter-spacing: 0.05em;
	}
</style>
