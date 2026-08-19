<script lang="ts">
// #4642: 別の家族グループへ「引っ越し合流」する前の確認カード。
//
// **不可逆操作**: 元の家族グループのデータ (子供 / 活動 / 記録 / 画像) は復元できない。
// 何が消えるかを列挙し、「取り消せません」を明示し、同意チェック無しでは実行させない。

import { INVITE_RELOCATION_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	/** 実行に失敗したときの表示文言 (同意漏れ / 受諾拒否 / 引っ越し不可)。 */
	errorMessage?: string | null;
	/** 送信中フラグ (story 用の強制値。実画面では submit で内部 state が立つ)。 */
	submitting?: boolean;
	/** 「やめておく」の戻り先。 */
	cancelHref: string;
}

let { errorMessage = null, submitting = false, cancelHref }: Props = $props();

let acknowledged = $state(false);
let sending = $state(false);
const busy = $derived(submitting || sending);
</script>

<div class="relocation">
	<h1 class="relocation-title">{INVITE_RELOCATION_LABELS.title}</h1>
	<p class="relocation-lead">{INVITE_RELOCATION_LABELS.lead}</p>

	<h2 class="relocation-heading">{INVITE_RELOCATION_LABELS.discardHeading}</h2>
	<ul class="relocation-list">
		{#each INVITE_RELOCATION_LABELS.discardItems as item (item)}
			<li>{item}</li>
		{/each}
	</ul>

	<Alert
		variant="danger"
		message={INVITE_RELOCATION_LABELS.irreversibleWarning}
		data-testid="relocation-irreversible-warning"
	/>

	<p class="relocation-note">{INVITE_RELOCATION_LABELS.keepNote}</p>
	<p class="relocation-note">{INVITE_RELOCATION_LABELS.backupHint}</p>

	{#if errorMessage}
		<Alert variant="danger" message={errorMessage} data-testid="relocation-error" />
	{/if}

	<form method="POST" action="?/relocate" onsubmit={() => (sending = true)}>
		<label class="relocation-ack">
			<input
				type="checkbox"
				name="acknowledge"
				bind:checked={acknowledged}
				data-testid="relocation-acknowledge"
			/>
			<span>{INVITE_RELOCATION_LABELS.acknowledgeLabel}</span>
		</label>

		<Button
			type="submit"
			variant="danger"
			class="w-full"
			loading={busy}
			disabled={!acknowledged}
			data-testid="relocation-confirm"
		>
			{busy
				? INVITE_RELOCATION_LABELS.confirmButtonLoading
				: INVITE_RELOCATION_LABELS.confirmButton}
		</Button>
	</form>

	<div class="relocation-cancel">
		<Button variant="ghost" size="sm" href={cancelHref} data-testid="relocation-cancel">
			{INVITE_RELOCATION_LABELS.cancelButton}
		</Button>
	</div>
</div>

<style>
	.relocation {
		text-align: left;
	}
	.relocation-title {
		margin: 0 0 0.75rem;
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary);
		text-align: center;
	}
	.relocation-lead {
		margin: 0 0 1.25rem;
		font-size: 0.9375rem;
		line-height: 1.8;
		color: var(--color-text-secondary);
	}
	.relocation-heading {
		margin: 0 0 0.5rem;
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}
	.relocation-list {
		margin: 0 0 1rem;
		padding-left: 1.25rem;
		font-size: 0.875rem;
		line-height: 1.8;
		color: var(--color-text-secondary);
	}
	.relocation-note {
		margin: 0.75rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--color-text-tertiary);
	}
	.relocation-ack {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		margin: 1.25rem 0 1rem;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--color-text-primary);
		cursor: pointer;
	}
	.relocation-cancel {
		margin-top: 1rem;
		text-align: center;
	}
</style>
