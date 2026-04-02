<script lang="ts">
interface Props {
	retentionDays: number | null;
	hasArchivedData: boolean;
}

let { retentionDays, hasArchivedData }: Props = $props();
</script>

{#if hasArchivedData && retentionDays !== null}
	<div class="archive-banner">
		<div class="archive-icon">📦</div>
		<div class="archive-content">
			<p class="archive-title">{retentionDays}日以前の記録がアーカイブされています</p>
			<p class="archive-desc">アップグレードすると全期間の記録が閲覧できます</p>
		</div>
		<a href="/admin/license" class="archive-cta">
			⭐ アップグレード
		</a>
	</div>
{/if}

<style>
	.archive-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border: 1px solid var(--color-amber-200, #fde68a);
		border-radius: 12px;
		background: var(--color-amber-50, #fffbeb);
	}

	.archive-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.archive-content {
		flex: 1;
	}

	.archive-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-neutral-700, #374151);
		margin: 0;
	}

	.archive-desc {
		font-size: 0.75rem;
		color: var(--color-neutral-500, #6b7280);
		margin: 4px 0 0;
	}

	.archive-cta {
		flex-shrink: 0;
		padding: 6px 12px;
		background: var(--color-violet-500, #8b5cf6);
		color: white;
		font-size: 0.75rem;
		font-weight: 600;
		border-radius: 8px;
		text-decoration: none;
		transition: background 0.15s;
	}

	.archive-cta:hover {
		background: var(--color-violet-600, #7c3aed);
	}
</style>
