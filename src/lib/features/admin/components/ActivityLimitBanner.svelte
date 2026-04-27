<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';

interface Props {
	current: number;
	max: number | null;
}

let { current, max }: Props = $props();
</script>

<div class="limit-banner">
	<span>⚠️</span>
	<div>
		<p class="limit-banner__title">{FEATURES_LABELS.activityLimitBanner.title(current, max)}</p>
		<a href="/admin/license" class="limit-banner__link">{FEATURES_LABELS.activityLimitBanner.linkLabel}</a>
	</div>
</div>

<style>
	.limit-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border-radius: var(--radius-md);
		background: var(--color-feedback-warning-bg);
		border: 1px solid var(--color-feedback-warning-border);
		font-size: 0.85rem;
	}
	.limit-banner__title {
		font-weight: 700;
		color: var(--color-feedback-warning-text);
	}
	.limit-banner__link {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-action-primary);
	}
</style>
