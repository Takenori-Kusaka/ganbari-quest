<script lang="ts">
import type { Snippet } from 'svelte';

interface Props {
	children: Snippet;
}

let { children }: Props = $props();
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="legal-page">
	<header class="legal-header">
		<div class="legal-header-inner">
			<a href="/" class="legal-logo">がんばりクエスト</a>
			<nav class="legal-nav">
				<a href="/legal/terms">利用規約</a>
				<a href="/legal/privacy">プライバシーポリシー</a>
				<a href="/legal/commerce">特定商取引法</a>
			</nav>
		</div>
	</header>

	<main class="legal-content">
		{@render children()}
	</main>

	<footer class="legal-footer">
		<p>&copy; {new Date().getFullYear()} がんばりクエスト</p>
		<div class="legal-footer-links">
			<a href="/">トップページ</a>
			<a href="/auth/login">ログイン</a>
		</div>
	</footer>
</div>

<style>
	.legal-page {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: #f8fafc;
	}

	.legal-header {
		background: white;
		border-bottom: 1px solid #e2e8f0;
		padding: 12px 16px;
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.legal-header-inner {
		max-width: 800px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px;
	}

	.legal-logo {
		font-size: 1rem;
		font-weight: 700;
		color: #1e293b;
		text-decoration: none;
	}

	.legal-nav {
		display: flex;
		gap: 16px;
	}

	.legal-nav a {
		font-size: 0.8rem;
		color: #64748b;
		text-decoration: none;
	}

	.legal-nav a:hover {
		color: #334155;
		text-decoration: underline;
	}

	.legal-content {
		flex: 1;
		max-width: 800px;
		width: 100%;
		margin: 0 auto;
		padding: 32px 16px;
	}

	.legal-footer {
		background: white;
		border-top: 1px solid #e2e8f0;
		padding: 16px;
		text-align: center;
	}

	.legal-footer p {
		font-size: 0.75rem;
		color: #94a3b8;
		margin: 0 0 8px;
	}

	.legal-footer-links {
		display: flex;
		gap: 16px;
		justify-content: center;
	}

	.legal-footer-links a {
		font-size: 0.75rem;
		color: #64748b;
		text-decoration: none;
	}

	.legal-footer-links a:hover {
		text-decoration: underline;
	}
</style>
