<script lang="ts">
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	hasFilter: boolean;
	canAdd: boolean;
	onAdd: () => void;
}

let { hasFilter, canAdd, onAdd }: Props = $props();
</script>

<div class="empty-state">
	<p class="empty-state__icon">📋</p>
	<p class="empty-state__text">
		{hasFilter ? 'この条件に一致する活動はありません' : '活動がまだ登録されていません'}
	</p>
	{#if canAdd}
		<Button variant="primary" size="sm" onclick={onAdd}>
			+ 活動を追加する
		</Button>
	{/if}
</div>

<style>
	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
	}
	.empty-state__icon {
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}
	.empty-state__text {
		font-size: 0.875rem;
		color: var(--color-text-tertiary);
		margin-bottom: 0.75rem;
	}
</style>
