<script lang="ts">
let { data } = $props();
</script>

<svelte:head>
	<title>招待 - がんばりクエスト</title>
</svelte:head>

<div class="invite-page">
	<div class="invite-card">
		<div class="invite-header">
			<div class="invite-icon">🏰</div>
			<h1 class="invite-title">がんばりクエスト</h1>
		</div>

		{#if !data.valid}
			<div class="invite-error">
				<div class="error-icon">⚠️</div>
				<p class="error-message">{data.error}</p>
				<p class="error-hint">招待した方に新しいリンクを発行してもらってください。</p>
				<a href="/auth/login" class="invite-button">ログインページへ</a>
			</div>
		{:else}
			<div class="invite-info">
				<p class="invite-description">
					家族グループへの招待が届いています。
				</p>
				<div class="invite-detail">
					<span class="detail-label">参加ロール:</span>
					<span class="detail-value">
						{data.invite.role === 'parent' ? '保護者' : 'こども'}
					</span>
				</div>
			</div>

			<div class="invite-actions">
				<a href="/auth/signup" class="invite-button primary">
					新規アカウントを作成して参加
				</a>
				<a href="/auth/login" class="invite-button secondary">
					既存アカウントでログインして参加
				</a>
			</div>
		{/if}
	</div>
</div>

<style>
	.invite-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--gradient-brand);
		padding: 16px;
	}

	.invite-card {
		width: 100%;
		max-width: 420px;
		background: var(--color-surface-card);
		border-radius: var(--radius-md);
		padding: 40px 32px;
		box-shadow: var(--card-shadow-elevated);
	}

	.invite-header {
		text-align: center;
		margin-bottom: 32px;
	}

	.invite-icon {
		font-size: 3rem;
		margin-bottom: 8px;
	}

	.invite-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-neutral-900);
		margin: 0;
	}

	.invite-error {
		text-align: center;
	}

	.error-icon {
		font-size: 2.5rem;
		margin-bottom: 12px;
	}

	.error-message {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-danger);
		margin: 0 0 8px;
	}

	.error-hint {
		font-size: 0.875rem;
		color: var(--color-neutral-500);
		margin: 0 0 24px;
	}

	.invite-info {
		margin-bottom: 28px;
	}

	.invite-description {
		font-size: 1rem;
		color: var(--color-neutral-700);
		text-align: center;
		margin: 0 0 16px;
		line-height: 1.6;
	}

	.invite-detail {
		display: flex;
		justify-content: center;
		gap: 8px;
		padding: 12px 16px;
		background: var(--color-brand-50);
		border-radius: var(--radius-sm);
	}

	.detail-label {
		font-size: 0.875rem;
		color: var(--color-neutral-500);
	}

	.detail-value {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-brand-700);
	}

	.invite-actions {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.invite-button {
		display: block;
		padding: 14px;
		text-align: center;
		font-size: 1rem;
		font-weight: 600;
		border-radius: var(--radius-sm);
		text-decoration: none;
		transition: opacity 0.15s;
	}

	.invite-button:hover {
		opacity: 0.9;
	}

	.invite-button.primary {
		background: var(--gradient-brand);
		color: var(--color-text-inverse);
	}

	.invite-button.secondary {
		background: var(--color-surface-card);
		color: var(--color-brand-600);
		border: 2px solid var(--color-brand-600);
	}

	.invite-error .invite-button {
		display: inline-block;
		background: var(--color-brand-600);
		color: var(--color-text-inverse);
		padding: 12px 24px;
	}
</style>
