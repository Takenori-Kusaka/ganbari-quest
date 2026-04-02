<script lang="ts">
interface EventData {
	id: number;
	name: string;
	description: string | null;
	bannerIcon: string;
	bannerColor: string | null;
	startDate: string;
	endDate: string;
	progress: { status: string } | null;
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
</script>

{#if events.length > 0}
	<div class="event-banners" data-testid="event-banners">
		{#each events as event}
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

	.event-banner__countdown--urgent {
		color: #dc2626;
		animation: pulse-urgent 1.5s ease-in-out infinite;
	}

	@keyframes pulse-urgent {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}
</style>
