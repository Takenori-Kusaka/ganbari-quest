<script lang="ts">
import PageHelpButton from '$lib/ui/components/PageHelpButton.svelte';

interface Props {
	onClearAll: () => void;
	clearConfirmOpen: boolean;
}

let { onClearAll, clearConfirmOpen }: Props = $props();
</script>

<div class="activities-header">
	<div class="flex items-center gap-2">
		<h2 class="activities-title">📋 活動管理</h2>
		<PageHelpButton />
	</div>
	<div class="activities-toolbar">
		<a
			href="/api/v1/activities/export"
			class="toolbar-btn"
			download="activities-export.json"
			aria-label="エクスポート"
		>
			📤
		</a>
		<a href="/admin/activities/introduce" class="toolbar-btn" aria-label="活動の紹介">
			📖
		</a>
		{#if !clearConfirmOpen}
			<button
				type="button"
				class="toolbar-btn toolbar-btn--danger"
				onclick={onClearAll}
				aria-label="全クリア"
			>
				🗑
			</button>
		{/if}
	</div>
</div>

<style>
	.activities-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.activities-title {
		font-size: 1.125rem;
		font-weight: 700;
	}
	.activities-toolbar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		font-size: 1rem;
		cursor: pointer;
		transition: background 0.15s;
	}
	.toolbar-btn:hover {
		background: var(--color-surface-muted);
	}
	.toolbar-btn--danger:hover {
		background: var(--color-feedback-error-bg);
	}
</style>
