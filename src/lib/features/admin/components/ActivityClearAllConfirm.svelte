<script lang="ts">
import { enhance } from '$app/forms';
import type { ChildId } from '$lib/domain/ids';
import { ADMIN_CHILD_SCOPE_LABELS, FEATURES_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	loading: boolean;
	onsubmit: () => void;
	onresult: (message: string) => void;
	oncancel: () => void;
	/** #4692 F3: 削除対象の child (選択中タブ)。tenant 全体ではなくこの子だけを消す */
	childId: ChildId;
	/** 確認文に出す対象の子の表示名 */
	childName: string;
	/** 確認文に出す対象件数 (非表示分を含む選択中の子の活動数) */
	activityCount: number;
}

let {
	loading = $bindable(),
	onsubmit,
	onresult,
	oncancel,
	childId,
	childName,
	activityCount,
}: Props = $props();

const L = FEATURES_LABELS.activityClearAllConfirm;
</script>

<div class="clear-confirm">
	<span class="clear-confirm__text" data-testid="clear-all-confirm-text">
		{ADMIN_CHILD_SCOPE_LABELS.clearAllScopedConfirm(childName, activityCount)}
	</span>
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
		<input type="hidden" name="childId" value={childId} />
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
		/* #4692: the confirm sentence now names the child and the count, so it is long
		   enough to squash the action buttons on narrow screens. Let the row wrap. */
		flex-wrap: wrap;
	}
	.clear-confirm__text {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-feedback-error-text);
		flex: 1 1 14rem;
	}
	.clear-confirm__actions {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
	}
</style>
