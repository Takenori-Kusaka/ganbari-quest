<script lang="ts">
import { enhance } from '$app/forms';
import Logo from '$lib/ui/components/Logo.svelte';
import { playSound } from '$lib/ui/sound/play-sound';

let { data } = $props();

const themeColors: Record<string, { bg: string; border: string }> = {
	pink: { bg: '#fff0f5', border: '#ff69b4' },
	blue: { bg: '#e3f2fd', border: '#4fc3f7' },
	green: { bg: '#e8f5e9', border: '#66bb6a' },
	orange: { bg: '#fff3e0', border: '#ffa726' },
	purple: { bg: '#f3e5f5', border: '#ab47bc' },
};

const defaultTheme = { bg: '#f5f5f5', border: '#9e9e9e' };
</script>

<svelte:head>
	<title>だれがつかう？ - がんばりクエスト</title>
</svelte:head>

<div class="portal-page">
	{#if data.reason === 'admin_forbidden'}
		<div class="toast-banner" role="alert">おやのアカウントでログインしてね</div>
	{/if}

	<header class="portal-header">
		<Logo variant="full" size={280} />
	</header>

	<main class="portal-main">
		<h1 class="portal-title">だれがつかう？</h1>

		{#if data.children.length === 0}
			<div class="portal-empty">
				<span class="portal-empty-icon">👤</span>
				<p class="portal-empty-title">こどもがまだいないよ</p>
				<p class="portal-empty-desc">おやがかんりがめんからついかしてね</p>
			</div>
		{:else}
			<div class="child-list">
				{#each data.children as child (child.id)}
					{@const colors = themeColors[child.theme] ?? defaultTheme}
					<form method="POST" action="?/select" use:enhance>
						<input type="hidden" name="childId" value={child.id} />
						<button
							type="submit"
							use:playSound={'tap'}
							class="child-button"
							data-testid="child-select-{child.id}"
							style="--child-bg: {colors.bg}; --child-border: {colors.border};"
						>
							{#if child.avatarUrl}
								<img
									src={child.avatarUrl}
									alt={child.nickname}
									class="child-avatar"
									loading="lazy"
								/>
							{:else}
								<span class="child-avatar-placeholder">👤</span>
							{/if}
							<div class="child-info">
								<p class="child-name">{child.nickname}</p>
								<p class="child-age">{child.age}さい</p>
							</div>
							<span class="child-arrow" aria-hidden="true">▶</span>
						</button>
					</form>
				{/each}
			</div>
		{/if}
	</main>

	{#if data.showAdminLink}
		<footer class="portal-footer">
			<a href={data.adminLink}>🔒 おやのかんりがめん</a>
		</footer>
	{/if}
</div>

<style>
	.portal-page {
		min-height: 100dvh;
		background: linear-gradient(135deg, #e8f4fd 0%, #f0f7ff 50%, #fef9e7 100%);
		display: flex;
		flex-direction: column;
	}

	.portal-header {
		padding: 40px 24px 24px;
		display: flex;
		justify-content: center;
	}

	.portal-main {
		flex: 1;
		padding: 0 16px 24px;
		max-width: 480px;
		margin: 0 auto;
		width: 100%;
	}

	.portal-title {
		font-size: 1.5rem;
		font-weight: 700;
		text-align: center;
		color: #1e293b;
		margin-bottom: 24px;
	}

	.portal-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 48px 0;
		color: #94a3b8;
	}

	.portal-empty-icon {
		font-size: 2.5rem;
		margin-bottom: 8px;
	}

	.portal-empty-title {
		font-weight: 700;
		margin: 0;
	}

	.portal-empty-desc {
		font-size: 0.875rem;
		margin: 4px 0 0;
	}

	.child-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.child-button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		background: white;
		border: 2px solid var(--child-border);
		border-radius: 16px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
	}

	.child-button:hover {
		background: var(--child-bg);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
		transform: translateY(-2px);
	}

	.child-button:active {
		transform: translateY(0);
	}

	.child-avatar {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid var(--child-border);
		flex-shrink: 0;
	}

	.child-avatar-placeholder {
		font-size: 2.5rem;
		flex-shrink: 0;
	}

	.child-info {
		flex: 1;
		min-width: 0;
	}

	.child-name {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1e293b;
		margin: 0;
	}

	.child-age {
		font-size: 0.875rem;
		color: #94a3b8;
		margin: 2px 0 0;
	}

	.child-arrow {
		font-size: 1.5rem;
		color: #cbd5e1;
		flex-shrink: 0;
	}

	.portal-footer {
		padding: 16px;
		text-align: center;
	}

	.portal-footer a {
		color: #64748b;
		font-size: 0.875rem;
		text-decoration: none;
	}

	.portal-footer a:hover {
		color: #3878b8;
	}

	.toast-banner {
		background: #fef3cd;
		color: #856404;
		padding: 12px 16px;
		text-align: center;
		font-size: 0.875rem;
		font-weight: 600;
		border-bottom: 1px solid #ffc107;
	}
</style>
