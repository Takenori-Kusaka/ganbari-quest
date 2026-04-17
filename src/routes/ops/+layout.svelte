<script lang="ts">
import type { Snippet } from 'svelte';

let { children }: { children: Snippet } = $props();
</script>

<div class="ops-layout">
	<header class="ops-header">
		<h1>がんばりクエスト 運営ダッシュボード</h1>
		<nav>
			<a href="/ops">KPI</a>
			<a href="/ops/revenue">収益</a>
			<a href="/ops/business">採算性</a>
			<a href="/ops/costs">費用</a>
			<a href="/ops/license">ライセンス</a>
			<a href="/ops/analytics">分析</a>
			<a href="/ops/export">エクスポート</a>
		</nav>
	</header>
	<main class="ops-main">
		{@render children()}
	</main>
</div>

<style>
	.ops-layout {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		max-width: 1200px;
		margin: 0 auto;
		padding: 1rem;
		color: #1a1a2e;
	}

	.ops-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 0;
		border-bottom: 2px solid #e2e8f0;
		margin-bottom: 2rem;
	}

	.ops-header h1 {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0;
	}

	.ops-header nav {
		display: flex;
		gap: 1rem;
	}

	.ops-header nav a {
		color: #4a5568;
		text-decoration: none;
		font-size: 0.875rem;
		padding: 0.25rem 0.75rem;
		border-radius: 0.375rem;
		transition: background 0.15s;
	}

	.ops-header nav a:hover {
		background: #edf2f7;
	}

	.ops-main {
		min-height: 60vh;
	}
</style>
