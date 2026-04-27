<script lang="ts">
import { enhance } from '$app/forms';
import { FEATURES_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	loading: boolean;
	onsubmit: () => void;
	onresult: (message: string) => void;
	oncancel: () => void;
}

let { loading = $bindable(), onsubmit, onresult, oncancel }: Props = $props();

const L = FEATURES_LABELS.activityClearAllConfirm;
</script>

<div class="clear-confirm">
	<span class="clear-confirm__text">{L.text}</span>
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
					onresult(L.resultMessage(Number(d.deleted), Number(d.hidden)));
				}
				await update({ reset: false });
			};
		}}
		class="clear-confirm__actions"
	>
		<Button type="submit" disabled={loading} variant="danger" size="sm">
			{loading ? L.processingText : L.executeBtn}
		</Button>
		<Button type="button" variant="ghost" size="sm" onclick={oncancel}>
			{L.cancelBtn}
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
