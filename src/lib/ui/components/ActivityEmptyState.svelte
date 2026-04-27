<script lang="ts">
import { getModeLabels, ICON_STATUS } from '$lib/domain/icons';
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';

interface Props {
	uiMode: string;
}

let { uiMode }: Props = $props();
const labels = $derived(getModeLabels(uiMode));
</script>

<div class="empty-state" data-testid="activity-empty-state">
	<span class="empty-icon">🗺️</span>
	<p class="empty-title">{UI_COMPONENTS_LABELS.activityEmptyTitle}</p>
	<p class="empty-desc">{UI_COMPONENTS_LABELS.activityEmptyDesc}</p>
	<p class="empty-wait">{UI_COMPONENTS_LABELS.activityEmptyWait}</p>

	<div class="empty-actions">
		<p class="empty-actions-title">{UI_COMPONENTS_LABELS.activityEmptyCanDo}</p>
		<div class="empty-links">
			<a href="/{uiMode}/status" class="empty-link">
				<span>{ICON_STATUS}</span>
				<span>{UI_COMPONENTS_LABELS.activityEmptyStatusLink(labels.status)}</span>
			</a>
		</div>
	</div>
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 32px 16px;
		text-align: center;
	}

	.empty-icon {
		font-size: 3rem;
		margin-bottom: 12px;
	}

	.empty-title {
		font-size: 1.125rem;
		font-weight: 800;
		color: var(--color-text, #374151);
		margin: 0 0 8px;
	}

	.empty-desc {
		font-size: 0.875rem;
		color: var(--color-text-muted, #6b7280);
		margin: 0 0 4px;
	}

	.empty-wait {
		font-size: 0.875rem;
		color: var(--color-text-muted, #6b7280);
		margin: 0 0 20px;
	}

	.empty-actions {
		width: 100%;
		max-width: 280px;
	}

	.empty-actions-title {
		font-size: 0.75rem;
		color: var(--color-text-muted, #9ca3af);
		margin: 0 0 12px;
	}

	.empty-links {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.empty-link {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		background: var(--color-surface, white);
		border: 1px solid var(--color-border, #e5e7eb);
		border-radius: 12px;
		text-decoration: none;
		color: var(--color-text, #374151);
		font-weight: 600;
		font-size: 0.875rem;
		transition: background 0.15s;
	}

	.empty-link:hover {
		background: var(--color-border, #f3f4f6);
	}
</style>
