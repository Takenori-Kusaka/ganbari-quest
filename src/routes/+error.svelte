<script lang="ts">
import { page } from '$app/state';
</script>

<div class="error-page">
	<div class="error-container">
		<p class="error-status">{page.status}</p>
		<h1 class="error-title">{page.error?.message ?? 'エラーが発生しました'}</h1>
		<p class="error-description">
			{#if page.status === 404}
				お探しのページは存在しないか、移動した可能性があります。
			{:else if page.status === 429}
				しばらくしてから再度お試しください。
			{:else if page.status === 403}
				このページにアクセスする権限がありません。
			{:else}
				予期しないエラーが発生しました。時間をおいて再度お試しください。
			{/if}
		</p>
		<a href="/" class="home-link">トップページへ戻る</a>
	</div>
</div>

<style>
	.error-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--color-brand-50);
		padding: 1rem;
	}

	.error-container {
		text-align: center;
		max-width: 480px;
	}

	.error-status {
		font-size: 4rem;
		font-weight: 700;
		color: var(--color-brand-600);
		margin: 0 0 0.5rem;
		line-height: 1;
	}

	.error-title {
		font-size: 1.25rem;
		margin: 0 0 1rem;
		color: var(--color-text);
	}

	.error-description {
		color: var(--color-text-muted);
		line-height: 1.6;
		margin: 0 0 2rem;
	}

	.home-link {
		color: var(--color-brand-600);
		text-decoration: none;
		font-weight: 500;
	}

	.home-link:hover {
		text-decoration: underline;
	}
</style>
