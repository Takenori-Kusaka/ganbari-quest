<script lang="ts">
import { enhance } from '$app/forms';

interface EventData {
	id: number;
	name: string;
	description: string | null;
	bannerIcon: string;
	bannerColor: string | null;
	startDate: string;
	endDate: string;
	rewardConfig: string | null;
	missionConfig: string | null;
	progress: { status: string; progressJson: string | null } | null;
}

interface Props {
	events: EventData[];
}

let { events }: Props = $props();

function getMissionProgress(event: EventData): { current: number; target: number } | null {
	if (!event.missionConfig) return null;
	try {
		const config = JSON.parse(event.missionConfig);
		if (config.type !== 'total_records' || !config.target) return null;
		const target = config.target as number;
		if (!event.progress?.progressJson) return { current: 0, target };
		const progress = JSON.parse(event.progress.progressJson);
		return { current: Math.min(progress.count ?? 0, target), target };
	} catch {
		return null;
	}
}
</script>

{#if events.length > 0}
	<div class="event-banners" data-testid="event-banners">
		{#each events as event}
			{@const mission = getMissionProgress(event)}
			<div
				class="event-banner"
				style:background={event.bannerColor || undefined}
			>
				<span class="event-banner__icon">{event.bannerIcon}</span>
				<div class="event-banner__content">
					<span class="event-banner__name">{event.name}</span>
					{#if event.description}
						<span class="event-banner__desc">{event.description}</span>
					{/if}
				</div>
				<div class="event-banner__meta">
					{#if event.progress?.status === 'reward_claimed'}
						<span class="event-banner__claimed">✅ うけとりずみ</span>
					{:else if event.progress?.status === 'completed' && event.rewardConfig}
						<form method="POST" action="?/claimEventReward" use:enhance>
							<input type="hidden" name="eventId" value={event.id} />
							<button type="submit" class="event-banner__claim-btn">
								🎁 うけとる
							</button>
						</form>
					{:else}
						{#if mission}
							<div class="event-banner__mission">
								<div class="event-banner__progress-bar">
									<div
										class="event-banner__progress-fill"
										class:event-banner__progress-fill--complete={mission.current >= mission.target}
										style:width="{Math.round((mission.current / mission.target) * 100)}%"
									></div>
								</div>
								<span class="event-banner__progress-text">
									{mission.current}/{mission.target}
								</span>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.event-banners {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 8px;
	}

	.event-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: var(--radius-md, 12px);
		background: var(--color-surface-warm, linear-gradient(135deg, #fef3c7, #fde68a));
		border: 1px solid var(--color-border-warm, rgba(251, 191, 36, 0.2));
	}

	.event-banner__icon {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.event-banner__content {
		flex: 1;
		min-width: 0;
	}

	.event-banner__name {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-text-warm, #92400e);
		display: block;
	}

	.event-banner__desc {
		font-size: 0.625rem;
		color: var(--color-text-warm-muted, #a16207);
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.event-banner__meta {
		flex-shrink: 0;
	}

	.event-banner__mission {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 2px;
	}

	.event-banner__progress-bar {
		width: 48px;
		height: 6px;
		background: rgba(0, 0, 0, 0.1);
		border-radius: 3px;
		overflow: hidden;
	}

	.event-banner__progress-fill {
		height: 100%;
		background: var(--color-warning, #f59e0b);
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	.event-banner__progress-fill--complete {
		background: var(--color-success, #22c55e);
	}

	.event-banner__progress-text {
		font-size: 0.5625rem;
		font-weight: 700;
		color: var(--color-text-warm, #92400e);
		white-space: nowrap;
	}

	.event-banner__claim-btn {
		padding: 2px 8px;
		border-radius: 6px;
		background: var(--color-warning, #f59e0b);
		color: white;
		font-size: 0.625rem;
		font-weight: 700;
		border: none;
		cursor: pointer;
		white-space: nowrap;
		animation: pulse-claim 2s ease-in-out infinite;
	}

	.event-banner__claim-btn:hover {
		background: var(--color-warning-hover, #d97706);
	}

	.event-banner__claimed {
		font-size: 0.5625rem;
		font-weight: 600;
		color: var(--color-success, #16a34a);
		white-space: nowrap;
	}

	@keyframes pulse-claim {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.05); }
	}
</style>
