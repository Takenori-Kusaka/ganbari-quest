<script lang="ts">
import type { Snippet } from 'svelte';
import { OPS_LAYOUT_LABELS } from '$lib/domain/labels';

let { children }: { children: Snippet } = $props();
</script>

<div class="ops-layout">
	<header class="ops-header">
		<h1>{OPS_LAYOUT_LABELS.headerTitle}</h1>
		<nav>
			<a href="/ops">{OPS_LAYOUT_LABELS.navKpi}</a>
			<a href="/ops/revenue">{OPS_LAYOUT_LABELS.navRevenue}</a>
			<a href="/ops/business">{OPS_LAYOUT_LABELS.navBusiness}</a>
			<a href="/ops/costs">{OPS_LAYOUT_LABELS.navCosts}</a>
			<a href="/ops/license">{OPS_LAYOUT_LABELS.navLicense}</a>
			<a href="/ops/analytics">{OPS_LAYOUT_LABELS.navAnalytics}</a>
			<a href="/ops/cohort">{OPS_LAYOUT_LABELS.navCohort}</a>
			<a href="/ops/pmf-survey">{OPS_LAYOUT_LABELS.navPmfSurvey}</a>
			<a href="/ops/export">{OPS_LAYOUT_LABELS.navExport}</a>
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
