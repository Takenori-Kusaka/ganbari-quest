<script lang="ts">
import { enhance } from '$app/forms';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	loading: boolean;
	onsubmit: () => void;
	onresult: (message: string) => void;
	oncancel: () => void;
}

let { loading = $bindable(), onsubmit, onresult, oncancel }: Props = $props();
</script>

<div class="clear-confirm">
	<span class="clear-confirm__text">本当に全削除しますか？</span>
	<form
		method="POST"
		action="?/clearAll"
		use:enhance={() => {
			loading = true;
			onsubmit();
			return async ({ result, update }) => {
				loading = false;
				if (result.type === 'success' && result.data && 'clearResult' in result.data) {
					const d = result.data as Record<string, unknown>;
					onresult(`🗑 ${d.deleted}件削除、${d.hidden}件非表示にしました`);
				}
				await update({ reset: false });
			};
		}}
		class="clear-confirm__actions"
	>
		<Button type="submit" disabled={loading} variant="danger" size="sm">
			{loading ? '処理中...' : '実行'}
		</Button>
		<Button type="button" variant="ghost" size="sm" onclick={oncancel}>
			やめる
		</Button>
	</form>
</div>

<style>
	.clear-confirm {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-md);
		background: var(--color-feedback-error-bg);
		border: 1px solid var(--color-feedback-error-border);
	}
	.clear-confirm__text {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-feedback-error-text);
	}
	.clear-confirm__actions {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
	}
</style>
