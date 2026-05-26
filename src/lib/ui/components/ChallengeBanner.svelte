<script lang="ts">
import { enhance } from '$app/forms';
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';

// #2458-B: ChallengeBanner を per-child instance + 兄弟連動情報 (`siblings[]`) ベースに refactor。
// 旧 SiblingChallengeWithProgress (family-wide + per-child progress[] 配列) からの
// 移行。自身の instance を主軸に表示し、`siblings[]` (同 group key の他 child instance) を
// 進捗バー一覧で並べる。
interface ChildChallengeInstance {
	id: number;
	childId: number;
	title: string;
	description: string | null;
	challengeType: string;
	periodType: string;
	startDate: string;
	endDate: string;
	status: string;
	currentValue: number;
	targetValue: number;
	completed: number;
	rewardClaimed: number;
}

interface ChallengeData extends ChildChallengeInstance {
	allCompleted: boolean;
	/** 同 group key の兄弟 instance (自身を含む) */
	siblings: ChildChallengeInstance[];
}

interface Props {
	challenges: ChallengeData[];
	childId: number;
	siblings?: { id: number; nickname: string }[];
}

let { challenges, childId, siblings: siblingNames = [] }: Props = $props();

function remainingDays(endDate: string): number {
	const end = new Date(`${endDate}T23:59:59`);
	const now = new Date();
	return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
}

function getSiblingName(id: number): string {
	return siblingNames.find((s) => s.id === id)?.nickname ?? `#${id}`;
}

const typeIcon = (t: string) => (t === 'cooperative' ? '🤝' : '⚔️');
</script>

{#if challenges.length > 0}
	<div class="challenge-banners" data-testid="challenge-banners">
		{#each challenges as challenge}
			<div class="challenge-banner" class:challenge-banner--complete={challenge.allCompleted}>
				<span class="challenge-banner__icon">{typeIcon(challenge.challengeType)}</span>
				<div class="challenge-banner__content">
					<span class="challenge-banner__name">
						{challenge.title}
						{#if challenge.allCompleted}
							<span class="challenge-banner__badge challenge-banner__badge--complete">{UI_COMPONENTS_LABELS.challengeBannerClear}</span>
						{/if}
					</span>
					{#if challenge.description}
						<span class="challenge-banner__desc">{challenge.description}</span>
					{/if}

					<!-- Progress bars for each sibling instance (#2458-B: per-child instance group) -->
					{#if challenge.siblings.length > 0}
						<div class="challenge-banner__progress-list">
							{#each challenge.siblings as sib (sib.id)}
								<div class="challenge-banner__sibling-row">
									<span
										class="challenge-banner__sibling-name"
										class:challenge-banner__sibling-name--me={sib.childId === childId}
									>
										{sib.childId === childId ? UI_COMPONENTS_LABELS.challengeBannerMe : getSiblingName(sib.childId)}
									</span>
									<div class="challenge-banner__progress-bar">
										<div
											class="challenge-banner__progress-fill"
											class:challenge-banner__progress-fill--complete={sib.completed === 1}
											style:width="{Math.min(100, Math.round((sib.currentValue / sib.targetValue) * 100))}%"
										></div>
									</div>
									<span class="challenge-banner__progress-text">
										{sib.currentValue}/{sib.targetValue}
										{#if sib.completed === 1}✅{/if}
									</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<div class="challenge-banner__meta">
					{#if challenge.completed === 1 && challenge.rewardClaimed === 0}
						<form method="POST" action="?/claimChallengeReward" use:enhance>
							<input type="hidden" name="challengeId" value={challenge.id} />
							<button type="submit" class="challenge-banner__claim-btn">
								{UI_COMPONENTS_LABELS.challengeBannerReceive}
							</button>
						</form>
					{:else if challenge.rewardClaimed === 1}
						<span class="challenge-banner__claimed">{UI_COMPONENTS_LABELS.challengeBannerReceived}</span>
					{:else}
						{#if remainingDays(challenge.endDate) <= 3}
							<span class="challenge-banner__countdown challenge-banner__countdown--urgent">
								{UI_COMPONENTS_LABELS.challengeBannerCountdownUrgent(remainingDays(challenge.endDate))}
							</span>
						{:else}
							<span class="challenge-banner__countdown">
								{UI_COMPONENTS_LABELS.challengeBannerCountdown(remainingDays(challenge.endDate))}
							</span>
						{/if}
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.challenge-banners {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 8px;
	}

	.challenge-banner {
		display: flex;
		gap: 8px;
		padding: 10px 12px;
		border-radius: var(--radius-md, 12px);
		background: linear-gradient(135deg, #ede9fe, #ddd6fe);
		border: 1px solid #a78bfa33;
	}

	.challenge-banner--complete {
		background: linear-gradient(135deg, #dcfce7, #bbf7d0);
		border-color: #4ade8033;
	}

	.challenge-banner__icon {
		font-size: 1.25rem;
		flex-shrink: 0;
		padding-top: 2px;
	}

	.challenge-banner__content {
		flex: 1;
		min-width: 0;
	}

	.challenge-banner__name {
		font-size: 0.75rem;
		font-weight: 700;
		color: #5b21b6;
		display: block;
	}

	.challenge-banner--complete .challenge-banner__name {
		color: #166534;
	}

	.challenge-banner__badge {
		display: inline-block;
		padding: 0 4px;
		border-radius: 4px;
		font-size: 0.5625rem;
		font-weight: 700;
		vertical-align: middle;
		margin-left: 4px;
	}

	.challenge-banner__badge--complete {
		background: #22c55e;
		color: white;
	}

	.challenge-banner__desc {
		font-size: 0.625rem;
		color: #7c3aed;
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.challenge-banner--complete .challenge-banner__desc {
		color: #15803d;
	}

	.challenge-banner__progress-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 4px;
	}

	.challenge-banner__sibling-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.challenge-banner__sibling-name {
		font-size: 0.5625rem;
		font-weight: 500;
		color: #6b7280;
		width: 3rem;
		flex-shrink: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.challenge-banner__sibling-name--me {
		font-weight: 700;
		color: #7c3aed;
	}

	.challenge-banner__progress-bar {
		flex: 1;
		height: 6px;
		background: rgba(0, 0, 0, 0.08);
		border-radius: 3px;
		overflow: hidden;
	}

	.challenge-banner__progress-fill {
		height: 100%;
		background: #8b5cf6;
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	.challenge-banner__progress-fill--complete {
		background: #22c55e;
	}

	.challenge-banner__progress-text {
		font-size: 0.5rem;
		font-weight: 700;
		color: #6b7280;
		white-space: nowrap;
		width: 2.5rem;
		text-align: right;
		flex-shrink: 0;
	}

	.challenge-banner__meta {
		flex-shrink: 0;
		display: flex;
		align-items: flex-start;
		padding-top: 2px;
	}

	.challenge-banner__countdown {
		font-size: 0.625rem;
		font-weight: 600;
		color: #5b21b6;
		white-space: nowrap;
	}

	.challenge-banner__countdown--urgent {
		color: #dc2626;
		animation: challenge-pulse-urgent 1.5s ease-in-out infinite;
	}

	.challenge-banner__claim-btn {
		padding: 2px 8px;
		border-radius: 6px;
		background: #8b5cf6;
		color: white;
		font-size: 0.625rem;
		font-weight: 700;
		border: none;
		cursor: pointer;
		white-space: nowrap;
		animation: challenge-pulse-claim 2s ease-in-out infinite;
	}

	.challenge-banner__claim-btn:hover {
		background: #7c3aed;
	}

	.challenge-banner__claimed {
		font-size: 0.5625rem;
		font-weight: 600;
		color: #16a34a;
		white-space: nowrap;
	}

	@keyframes challenge-pulse-claim {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.05);
		}
	}

	@keyframes challenge-pulse-urgent {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.6;
		}
	}
</style>
