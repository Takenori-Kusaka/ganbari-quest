<script lang="ts">
import { enhance } from '$app/forms';

interface Milestone {
	target: number;
	track: 'free' | 'premium';
	reward: {
		type: string;
		value?: number;
		name?: string;
		icon?: string;
		description?: string;
	};
	achieved: boolean;
	claimed: boolean;
	current: number;
}

interface Props {
	eventName: string;
	eventId: number;
	bannerIcon: string;
	milestones: Milestone[];
	currentCount: number;
	maxTarget: number;
	remainingDays: number;
	isPremium: boolean;
}

let {
	eventName,
	eventId,
	bannerIcon,
	milestones,
	currentCount,
	maxTarget,
	remainingDays,
	isPremium,
}: Props = $props();

const progressPct = $derived(Math.min(100, Math.round((currentCount / maxTarget) * 100)));

// Group milestones by target for display
const groupedMilestones = $derived(() => {
	const groups: Map<number, Milestone[]> = new Map();
	for (const m of milestones) {
		const existing = groups.get(m.target) ?? [];
		existing.push(m);
		groups.set(m.target, existing);
	}
	return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
});
</script>

<div class="season-pass" data-testid="season-pass-card">
	<div class="season-pass__header">
		<span class="season-pass__icon">{bannerIcon}</span>
		<div class="season-pass__title-area">
			<h3 class="season-pass__title">{eventName}</h3>
			<span class="season-pass__days">のこり {remainingDays}にち</span>
		</div>
	</div>

	<!-- Progress bar -->
	<div class="season-pass__progress">
		<div
			class="season-pass__bar"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={maxTarget}
			aria-valuenow={currentCount}
			aria-valuetext={`${currentCount}/${maxTarget}`}
		>
			<div class="season-pass__bar-fill" style:width="{progressPct}%"></div>
		</div>
		<span class="season-pass__count">{currentCount}/{maxTarget}</span>
	</div>

	<!-- Milestones -->
	<div class="season-pass__milestones">
		{#each groupedMilestones() as [target, mGroup]}
			<div class="season-pass__milestone-row">
				<span class="season-pass__milestone-target">
					{target}かい
				</span>
				<div class="season-pass__milestone-rewards">
					{#each mGroup as m}
						{@const isLocked = m.track === 'premium' && !isPremium}
						<div
							class="season-pass__reward"
							class:season-pass__reward--achieved={m.achieved}
							class:season-pass__reward--claimed={m.claimed}
							class:season-pass__reward--locked={isLocked}
							class:season-pass__reward--premium={m.track === 'premium'}
						>
							{#if isLocked}
								<span class="season-pass__reward-icon">🔒</span>
								<span class="season-pass__reward-name">⭐限定</span>
							{:else if m.claimed}
								<span class="season-pass__reward-icon">✅</span>
								<span class="season-pass__reward-name">{m.reward.name ?? ''}</span>
							{:else if m.achieved}
								<form method="POST" action="?/claimSeasonPassReward" use:enhance>
									<input type="hidden" name="eventId" value={eventId} />
									<input type="hidden" name="target" value={m.target} />
									<input type="hidden" name="track" value={m.track} />
									<button type="submit" class="season-pass__claim-btn">
										{m.reward.icon ?? '🎁'} うけとる
									</button>
								</form>
							{:else}
								<span class="season-pass__reward-icon">{m.reward.icon ?? '❓'}</span>
								<span class="season-pass__reward-name">{m.reward.name ?? ''}</span>
							{/if}
							{#if m.track === 'premium' && !isLocked}
								<span class="season-pass__premium-badge">⭐</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.season-pass {
		background: white;
		border-radius: var(--radius-lg, 16px);
		padding: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		border: 1px solid var(--color-neutral-200, #e5e7eb);
	}

	.season-pass__header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}

	.season-pass__icon {
		font-size: 1.5rem;
	}

	.season-pass__title-area {
		flex: 1;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.season-pass__title {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-text-primary, #1f2937);
		margin: 0;
	}

	.season-pass__days {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-tertiary, #9ca3af);
	}

	.season-pass__progress {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}

	.season-pass__bar {
		flex: 1;
		height: 10px;
		background: var(--color-neutral-100, #f3f4f6);
		border-radius: 5px;
		overflow: hidden;
	}

	.season-pass__bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #8b5cf6, #a78bfa);
		border-radius: 5px;
		transition: width 0.5s ease;
	}

	.season-pass__count {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-text-secondary, #4b5563);
		white-space: nowrap;
	}

	.season-pass__milestones {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.season-pass__milestone-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.season-pass__milestone-target {
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--color-text-tertiary, #9ca3af);
		width: 36px;
		flex-shrink: 0;
		text-align: right;
	}

	.season-pass__milestone-rewards {
		display: flex;
		gap: 4px;
		flex: 1;
	}

	.season-pass__reward {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 3px 8px;
		border-radius: 6px;
		background: var(--color-neutral-50, #f9fafb);
		border: 1px solid var(--color-neutral-200, #e5e7eb);
		font-size: 0.7rem;
		position: relative;
		flex: 1;
	}

	.season-pass__reward--achieved {
		background: #ecfdf5;
		border-color: #86efac;
	}

	.season-pass__reward--claimed {
		background: #f0fdf4;
		border-color: #86efac;
		opacity: 0.7;
	}

	.season-pass__reward--locked {
		background: var(--color-neutral-100, #f3f4f6);
		opacity: 0.5;
	}

	.season-pass__reward--premium {
		border-color: #e9d5ff;
		background: #faf5ff;
	}

	.season-pass__reward-icon {
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	.season-pass__reward-name {
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--color-text-secondary, #4b5563);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.season-pass__claim-btn {
		padding: 2px 6px;
		border-radius: 4px;
		background: #8b5cf6;
		color: white;
		font-size: 0.625rem;
		font-weight: 700;
		border: none;
		cursor: pointer;
		white-space: nowrap;
		animation: pulse-claim 2s ease-in-out infinite;
	}

	.season-pass__claim-btn:hover {
		background: #7c3aed;
	}

	.season-pass__premium-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		font-size: 0.5rem;
		line-height: 1;
	}

	@keyframes pulse-claim {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.05);
		}
	}
</style>
