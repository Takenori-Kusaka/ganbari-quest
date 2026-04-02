<script lang="ts">
interface EventData {
	id: number;
	name: string;
	description: string | null;
	bannerIcon: string;
	bannerColor: string | null;
	startDate: string;
	endDate: string;
	missionConfig: string | null;
	progress: { status: string; progressJson: string | null } | null;
}

interface Props {
	events: EventData[];
}

let { events }: Props = $props();

function remainingDays(endDate: string): number {
	const end = new Date(`${endDate}T23:59:59`);
	const now = new Date();
	return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
}

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
				style={event.bannerColor ? `background: ${event.bannerColor}` : ''}
			>
				<span class="event-banner__icon">{event.bannerIcon}</span>
				<div class="event-banner__content">
					<span class="event-banner__name">{event.name}</span>
					{#if event.description}
						<span class="event-banner__desc">{event.description}</span>
					{/if}
				</div>
				<div class="event-banner__meta">
					{#if mission}
						<div class="event-banner__mission">
							<div class="event-banner__progress-bar">
								<div
									class="event-banner__progress-fill"
									class:event-banner__progress-fill--complete={mission.current >= mission.target}
									style="width: {Math.round((mission.current / mission.target) * 100)}%"
								></div>
							</div>
							<span class="event-banner__progress-text">
								{mission.current}/{mission.target}
							</span>
						</div>
					{/if}
					{#if remainingDays(event.endDate) <= 3}
						<span class="event-banner__countdown event-banner__countdown--urgent">
							あと{remainingDays(event.endDate)}にち！
						</span>
					{:else}
						<span class="event-banner__countdown">あと{remainingDays(event.endDate)}にち</span>
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
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		border: 1px solid #fbbf2433;
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
		color: #92400e;
		display: block;
	}

	.event-banner__desc {
		font-size: 0.625rem;
		color: #a16207;
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.event-banner__meta {
		flex-shrink: 0;
	}

	.event-banner__countdown {
		font-size: 0.625rem;
		font-weight: 600;
		color: #92400e;
		white-space: nowrap;
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
		background: #f59e0b;
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	.event-banner__progress-fill--complete {
		background: #22c55e;
	}

	.event-banner__progress-text {
		font-size: 0.5625rem;
		font-weight: 700;
		color: #92400e;
		white-space: nowrap;
	}

	.event-banner__countdown--urgent {
		color: #dc2626;
		animation: pulse-urgent 1.5s ease-in-out infinite;
	}

	@keyframes pulse-urgent {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}
</style>
