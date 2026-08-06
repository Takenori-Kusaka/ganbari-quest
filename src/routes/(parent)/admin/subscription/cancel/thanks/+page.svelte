<script lang="ts">
import { APP_LABELS, CANCELLATION_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data, form } = $props();
</script>

<svelte:head>
	<title>{CANCELLATION_LABELS.successHeading}{APP_LABELS.pageTitleSuffix}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="cancel-thanks space-y-6">
	<Card variant="default" padding="lg">
		{#snippet children()}
		<div class="space-y-4">
			<h1 class="text-lg font-bold text-[var(--color-text-primary)]">
				{CANCELLATION_LABELS.successHeading}
			</h1>
			<p class="text-sm text-[var(--color-text-secondary)]">
				{CANCELLATION_LABELS.successDesc}
			</p>

			{#if data.portalUnavailable}
				<!--
					#4329: 解約手続きが**残っている**状態。旧実装はこの状態を成功 (thanks) として
					見せ、CTA は「Stripe 請求管理ページで解約を完了する」と名乗りながら自アプリの
					プラン画面へ戻していた。顧客は解約したつもりのまま課金が続く。
					失敗した事実 → その場でやり直す手段 → 届かないときの代替手段、の順で出す。
				-->
				<Alert variant="warning" role="alert" data-testid="cancellation-portal-unavailable">
					{#snippet children()}
					<p class="font-bold">{CANCELLATION_LABELS.portalUnavailableHeading}</p>
					<p>{CANCELLATION_LABELS.portalUnavailableDesc}</p>
					{/snippet}
				</Alert>

				{#if form?.portalRetryFailed}
					<Alert
						variant="danger"
						message={CANCELLATION_LABELS.portalRetryFailed}
						data-testid="cancellation-portal-retry-failed"
					/>
				{/if}

				<form method="POST" action="?/openPortal">
					<Button
						type="submit"
						variant="primary"
						size="md"
						data-testid="cancellation-proceed-stripe"
					>
						{CANCELLATION_LABELS.portalRetryButton}
					</Button>
				</form>

				<p class="text-sm text-[var(--color-text-secondary)]">
					{CANCELLATION_LABELS.portalSupportHint}
				</p>
				<Button
					variant="secondary"
					size="md"
					href="/admin/settings/support"
					data-testid="cancellation-support-link"
				>
					{CANCELLATION_LABELS.portalSupportLink}
				</Button>
			{:else}
				<!--
					#4329: 「アカウント削除はこちら」と名乗りながら遷移先はプラン画面だった。
					削除操作を持つのは設定 > アカウントなので、名乗りどおりの遷移先に直す。
				-->
				<Button
					variant="secondary"
					size="md"
					href="/admin/settings/account"
					data-testid="cancellation-account-delete-link"
				>
					{CANCELLATION_LABELS.successFreeProceed}
				</Button>
			{/if}
		</div>
		{/snippet}
	</Card>
</div>

<style>
	.cancel-thanks {
		max-width: 720px;
	}
</style>
