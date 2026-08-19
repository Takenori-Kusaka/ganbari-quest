<script lang="ts">
import { ARCHIVED_RESOURCE_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

// #4708: 無料プランの上限で archive (一時非表示) 中のリソースを親に告知する banner。
// admin 全画面の本文上部 (TrialBanner と同階層、flow)。FAQ / pricing の約束
// 「削除されず、管理画面で確認でき、有料プランで元に戻る」のうち「確認できる」の入口。
// ADR-0012: 静的 1 件・CTA 以外はタップ不可・「失う / 消える」を使わない。
// 表示条件 (無料プランに戻った + archive 件数 > 0) は admin +layout.server.ts が決める。
interface Props {
	summary: {
		archivedChildCount: number;
		archivedActivityCount: number;
		archivedChecklistTemplateCount: number;
		totalCount: number;
		hasArchivedResources: boolean;
	};
	basePath?: string;
}

let { summary, basePath = '/admin' }: Props = $props();

const breakdown = $derived(
	ARCHIVED_RESOURCE_LABELS.breakdown({
		children: summary.archivedChildCount,
		activities: summary.archivedActivityCount,
		checklists: summary.archivedChecklistTemplateCount,
	}),
);
</script>

{#if summary.hasArchivedResources}
	<div class="archived-banner" role="status" data-testid="archived-resource-banner">
		<div class="archived-banner__icon" aria-hidden="true">📦</div>
		<div class="archived-banner__content">
			<p class="archived-banner__title" data-testid="archived-resource-banner-title">
				{ARCHIVED_RESOURCE_LABELS.bannerTitle(breakdown)}
			</p>
			<p class="archived-banner__desc">{ARCHIVED_RESOURCE_LABELS.bannerDesc}</p>
		</div>
		<div class="archived-banner__actions">
			{#if summary.archivedChildCount > 0}
				<a
					href="{basePath}/children#archived"
					class="archived-banner__link"
					data-testid="archived-resource-banner-list-link"
				>
					{ARCHIVED_RESOURCE_LABELS.bannerListLink}
				</a>
			{/if}
			<Button
				variant="primary"
				size="sm"
				href="{basePath}/subscription"
				data-testid="archived-resource-banner-cta"
			>
				{ARCHIVED_RESOURCE_LABELS.bannerCta}
			</Button>
		</div>
	</div>
{/if}

<style>
	.archived-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border-radius: 12px;
		border: 1px solid var(--color-feedback-info-border);
		background: var(--color-surface-info);
		flex-wrap: wrap;
	}

	.archived-banner__icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.archived-banner__content {
		flex: 1 1 240px;
		min-width: 0;
	}

	.archived-banner__title {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.archived-banner__desc {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 4px 0 0;
	}

	.archived-banner__actions {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}

	.archived-banner__link {
		font-size: 0.75rem;
		color: var(--color-text-link);
		text-decoration: underline;
	}
</style>
