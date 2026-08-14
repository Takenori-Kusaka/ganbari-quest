<script lang="ts">
import { CATEGORIES, toCategoryCode } from '$lib/domain/categories';
import { APP_LABELS, formatAgeKana, VIEW_PAGE_LABELS } from '$lib/domain/labels';

let { data } = $props();

// #4512: 旧実装は 5 カテゴリの name / icon を setup/packs と二重にハードコードしていた
// (カテゴリを増減しても本画面だけ取り残される並行実装)。SSOT は categories.ts。
function categoryMeta(categoryId: number | string) {
	const code = toCategoryCode(categoryId);
	return code ? CATEGORIES[code] : undefined;
}
</script>

<svelte:head>
	<title>{data.label ? `${data.label} — ` : ''}{APP_LABELS.name}</title>
</svelte:head>

<div class="viewer-page">
	<header class="viewer-header">
		<h1>{VIEW_PAGE_LABELS.appTitle}</h1>
		{#if data.label}
			<p class="viewer-label">{data.label}</p>
		{/if}
		<p class="viewer-notice">{VIEW_PAGE_LABELS.viewOnlyNotice}</p>
	</header>

	{#if data.childrenData.length === 0}
		<div class="viewer-empty">
			<p>{VIEW_PAGE_LABELS.emptyChildren}</p>
		</div>
	{:else}
		<div class="viewer-children">
			{#each data.childrenData as child}
				<div class="child-card">
					<div class="child-header">
						<h2 class="child-name">{child.nickname}</h2>
						<span class="child-age">{formatAgeKana(child.age)}</span>
					</div>

					<div class="child-stats">
						<div class="stat-item">
							<span class="stat-value">{child.totalPoints.toLocaleString()}</span>
							<span class="stat-label">{VIEW_PAGE_LABELS.statPointLabel}</span>
						</div>
						<div class="stat-item">
							<span class="stat-value">Lv.{child.totalLevel}</span>
							<span class="stat-label">{VIEW_PAGE_LABELS.statLevelLabel}</span>
						</div>
					</div>

					{#if child.statuses.length > 0}
						<div class="category-grid">
							{#each child.statuses as status}
								{@const cat = categoryMeta(status.categoryId)}
								{#if cat}
									<div class="category-item">
										<span class="category-icon">{cat.icon}</span>
										<span class="category-name">{cat.name}</span>
										<span class="category-level">Lv.{status.level}</span>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<footer class="viewer-footer">
		<p>{VIEW_PAGE_LABELS.footerText}</p>
	</footer>
</div>

<style>
	.viewer-page {
		max-width: 600px;
		margin: 0 auto;
		padding: 1rem;
		font-family: var(--font-family, sans-serif);
	}

	.viewer-header {
		text-align: center;
		padding: 1.5rem 0 1rem;
	}

	.viewer-header h1 {
		font-size: 1.5rem;
		color: var(--color-text-primary, #1e293b);
		margin: 0;
	}

	.viewer-label {
		color: var(--color-text-secondary, #64748b);
		font-size: 0.875rem;
		margin: 0.25rem 0 0;
	}

	.viewer-notice {
		display: inline-block;
		margin-top: 0.5rem;
		padding: 0.25rem 0.75rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		background: var(--color-surface-muted, #f1f5f9);
		color: var(--color-text-muted, #94a3b8);
	}

	.viewer-empty {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--color-text-muted, #94a3b8);
	}

	.viewer-children {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: 1rem;
	}

	.child-card {
		background: var(--color-surface-card, #fff);
		border: 1px solid var(--color-border-default, #e2e8f0);
		border-radius: 1rem;
		padding: 1.25rem;
	}

	.child-header {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.child-name {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text-primary, #1e293b);
		margin: 0;
	}

	.child-age {
		font-size: 0.875rem;
		color: var(--color-text-muted, #94a3b8);
	}

	.child-stats {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1rem;
	}

	.stat-item {
		display: flex;
		flex-direction: column;
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-action-primary, #667eea);
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--color-text-muted, #94a3b8);
	}

	.category-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 0.5rem;
	}

	.category-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.5rem;
		border-radius: 0.5rem;
		background: var(--color-surface-muted, #f8fafc);
	}

	.category-icon {
		font-size: 1.5rem;
	}

	.category-name {
		font-size: 0.75rem;
		color: var(--color-text-secondary, #64748b);
	}

	.category-level {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text-primary, #1e293b);
	}

	.viewer-footer {
		text-align: center;
		padding: 2rem 0 1rem;
		font-size: 0.75rem;
		color: var(--color-text-muted, #94a3b8);
	}
</style>
