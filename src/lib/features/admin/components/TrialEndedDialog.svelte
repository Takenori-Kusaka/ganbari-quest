<script lang="ts">
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	open: boolean;
	onDismiss: () => void;
}

let { open = $bindable(), onDismiss }: Props = $props();
</script>

<Dialog
	{open}
	onOpenChange={(d) => {
		if (!d.open) onDismiss();
	}}
	title="無料体験が終了しました"
	testid="trial-ended-dialog"
	size="sm"
>
	<div class="trial-ended-body">
		<div class="trial-ended-icon" aria-hidden="true">📦</div>

		<p class="trial-ended-message">
			無料体験期間が終了しました。<br />
			フリープランの範囲内で引き続きご利用いただけます。
		</p>

		<ul class="trial-ended-notes">
			<li>オリジナル活動やチェックリストの超過分は一時的に非表示になります</li>
			<li>データは削除されません — アップグレードで復活します</li>
		</ul>

		<div class="trial-ended-actions">
			<a href="/admin/license" class="trial-ended-upgrade-cta" data-testid="trial-ended-upgrade-cta">
				⭐ プランを見る
			</a>
			<Button variant="ghost" onclick={onDismiss} data-testid="trial-ended-dismiss">
				あとで
			</Button>
		</div>
	</div>
</Dialog>

<style>
	.trial-ended-body {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
	}

	.trial-ended-icon {
		font-size: 2.5rem;
	}

	.trial-ended-message {
		font-size: 0.875rem;
		color: var(--color-text-primary);
		line-height: 1.6;
		margin: 0;
	}

	.trial-ended-notes {
		list-style: none;
		padding: 0;
		margin: 0;
		width: 100%;
		text-align: left;
	}

	.trial-ended-notes li {
		position: relative;
		padding-left: 1.25em;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
		margin-bottom: 4px;
	}

	.trial-ended-notes li::before {
		content: '•';
		position: absolute;
		left: 0.25em;
		color: var(--color-text-tertiary);
	}

	.trial-ended-actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
		margin-top: 4px;
	}

	.trial-ended-upgrade-cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 12px 24px;
		background: var(--color-action-trial-upgrade);
		color: var(--color-text-inverse);
		font-size: 1rem;
		font-weight: 700;
		border: none;
		border-radius: var(--radius-md, 8px);
		text-decoration: none;
		cursor: pointer;
		transition: background 0.15s;
		min-height: 48px;
	}

	.trial-ended-upgrade-cta:hover {
		background: var(--color-action-trial-upgrade-hover);
	}
</style>
