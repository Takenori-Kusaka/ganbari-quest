<script lang="ts">
// #4636: 招待受諾に失敗した人に「理由 + 次アクション + 新しく作る導線」を出すカード。
// `/auth/join` の表示部を切り出したもの (membership 未確定の状態は local backend で
// 再現できない #3732 ため、見た目の検証は Storybook が担う)。

import { AUTH_JOIN_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

interface Props {
	/** 受諾拒否の説明文。招待を持っていない場合は null。 */
	message?: string | null;
	/** 家族グループ作成の送信中フラグ (二重送信防止の視覚フィードバック)。 */
	creating?: boolean;
	/** 作成に失敗したときのエラー表示。 */
	createFailed?: boolean;
	/** 「別のアカウントでログインする」リンク先。 */
	switchAccountHref: string;
}

let { message = null, creating = false, createFailed = false, switchAccountHref }: Props = $props();

// 送信中は button を loading (= disabled + aria-busy) にして二重送信を防ぐ (#4636 AC5 の UI 側)。
// 冪等性はサーバー側 (`provisionOwnTenant` の membership 再確認) が担保し、これはその前段の視覚的抑止。
let submitting = $state(false);
const busy = $derived(creating || submitting);
</script>

<Card variant="elevated" padding="none" class="join-card">
	<h1 class="join-title" data-testid="join-title">
		{message ? AUTH_JOIN_LABELS.blockedTitle : AUTH_JOIN_LABELS.noInviteTitle}
	</h1>

	{#if message}
		<Alert variant="warning" {message} data-testid="join-blocked-reason" />
		<p class="join-hint">{AUTH_JOIN_LABELS.retryHint}</p>
	{:else}
		<p class="join-hint">{AUTH_JOIN_LABELS.noInviteDesc}</p>
	{/if}

	{#if createFailed}
		<Alert
			variant="danger"
			message={AUTH_JOIN_LABELS.createFailed}
			data-testid="join-create-failed"
		/>
	{/if}

	<section class="join-create">
		<h2 class="join-create-title">{AUTH_JOIN_LABELS.createSectionTitle}</h2>
		<p class="join-create-desc">{AUTH_JOIN_LABELS.createSectionDesc}</p>
		<form method="POST" action="?/createFamily" onsubmit={() => (submitting = true)}>
			<Button
				type="submit"
				variant="primary"
				class="w-full"
				loading={busy}
				data-testid="join-create-family"
			>
				{busy ? AUTH_JOIN_LABELS.createButtonLoading : AUTH_JOIN_LABELS.createButton}
			</Button>
		</form>
	</section>

	<div class="join-switch">
		<Button variant="ghost" size="sm" href={switchAccountHref} data-testid="join-switch-account">
			{AUTH_JOIN_LABELS.switchAccountLink}
		</Button>
	</div>
</Card>

<style>
	:global(.join-card) {
		width: 100%;
		max-width: 480px;
		padding: 2.5rem 2rem;
	}
	.join-title {
		margin: 0 0 1rem;
		font-size: 1.35rem;
		font-weight: 700;
		color: var(--color-text-primary);
		text-align: center;
	}
	.join-hint {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
		line-height: 1.7;
		color: var(--color-text-secondary);
	}
	.join-create {
		margin-top: 1.75rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--color-border-light);
	}
	.join-create-title {
		margin: 0 0 0.5rem;
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}
	.join-create-desc {
		margin: 0 0 1rem;
		font-size: 0.875rem;
		line-height: 1.7;
		color: var(--color-text-secondary);
	}
	.join-switch {
		margin-top: 1.25rem;
		text-align: center;
	}
</style>
