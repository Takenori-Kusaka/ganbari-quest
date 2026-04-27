<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';
import {
	getNotificationPermission,
	isPushSupported,
	subscribeToPush,
} from '$lib/features/admin/push-subscription';

let dismissed = $state(false);
let subscribed = $state(false);
let supported = $state(false);
let permission = $state<NotificationPermission>('default');

const L = FEATURES_LABELS.notificationBanner;

$effect(() => {
	supported = isPushSupported();
	if (supported) {
		permission = getNotificationPermission();
	}
});

const visible = $derived(supported && permission === 'default' && !dismissed && !subscribed);

async function handleSubscribe() {
	const sub = await subscribeToPush();
	if (sub) {
		subscribed = true;
	}
}
</script>

{#if visible}
	<div class="notification-banner" data-testid="notification-permission-banner">
		<div class="notification-banner__icon">🔔</div>
		<div class="notification-banner__content">
			<p class="notification-banner__title">{L.title}</p>
			<p class="notification-banner__desc">
				{L.desc}
			</p>
		</div>
		<div class="notification-banner__actions">
			<button type="button" class="notification-banner__cta" onclick={handleSubscribe}>
				{L.ctaBtn}
			</button>
			<button
				type="button"
				class="notification-banner__dismiss"
				onclick={() => (dismissed = true)}
			>
				{L.dismissBtn}
			</button>
		</div>
	</div>
{/if}

<style>
	.notification-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		background: var(--color-surface-card, white);
		border: 1px solid var(--color-border-default, #e5e7eb);
		border-radius: var(--radius-lg, 12px);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.notification-banner__icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.notification-banner__content {
		flex: 1;
		min-width: 0;
	}

	.notification-banner__title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-primary, #1f2937);
		margin: 0;
	}

	.notification-banner__desc {
		font-size: 0.75rem;
		color: var(--color-text-secondary, #6b7280);
		margin: 2px 0 0;
	}

	.notification-banner__actions {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex-shrink: 0;
	}

	.notification-banner__cta {
		padding: 6px 12px;
		border: none;
		border-radius: 8px;
		background: var(--color-action-primary, #3b82f6);
		color: white;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.notification-banner__cta:hover {
		opacity: 0.9;
	}

	.notification-banner__dismiss {
		padding: 4px 8px;
		border: none;
		background: transparent;
		color: var(--color-text-secondary, #6b7280);
		font-size: 0.6875rem;
		cursor: pointer;
		text-align: center;
	}

	.notification-banner__dismiss:hover {
		text-decoration: underline;
	}
</style>
