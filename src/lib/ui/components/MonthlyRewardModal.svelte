<script lang="ts">
import { enhance } from '$app/forms';

interface Props {
	eventId: number;
	rewardName: string;
	rewardIcon: string;
	rewardDescription: string;
	claimed: boolean;
	onClaimed?: () => void;
}

let { eventId, rewardName, rewardIcon, rewardDescription, claimed, onClaimed }: Props = $props();

let showOpening = $state(!claimed);
let phase = $state<'gift' | 'reveal'>('gift');

function handleOpen() {
	phase = 'reveal';
}
</script>

{#if showOpening}
	<div class="reward-overlay" role="dialog" aria-modal="true" aria-label="月替わりプレゼント">
		<div class="reward-card">
			{#if phase === 'gift'}
				<!-- Gift box phase -->
				<div class="reward-gift">
					<span class="reward-gift__box" aria-hidden="true">📦</span>
					<p class="reward-gift__text">今月のプレゼントがとどいたよ！</p>
					<button type="button" class="reward-gift__open-btn" onclick={handleOpen}>
						あける！
					</button>
				</div>
			{:else}
				<!-- Reveal phase -->
				<div class="reward-reveal">
					<div class="reward-reveal__confetti" aria-hidden="true">
						{#each Array(8) as _, i}
							<span class="confetti-piece" style="--i:{i}"></span>
						{/each}
					</div>

					<span class="reward-reveal__icon">{rewardIcon}</span>
					<h3 class="reward-reveal__name">「{rewardName}」をゲット！</h3>
					<p class="reward-reveal__desc">{rewardDescription}</p>

					<form method="POST" action="?/claimMonthlyReward" use:enhance={() => {
						return async ({ update }) => {
							await update();
							showOpening = false;
							onClaimed?.();
						};
					}}>
						<input type="hidden" name="eventId" value={eventId} />
						<button type="submit" class="reward-reveal__btn">
							やったね！ 🎉
						</button>
					</form>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.reward-overlay {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.5);
		animation: fadeIn 0.3s ease;
		padding: 1rem;
	}

	.reward-card {
		width: 100%;
		max-width: 320px;
		border-radius: 1.25rem;
		background: white;
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
		overflow: hidden;
		animation: slideUp 0.4s ease;
	}

	/* Gift phase */
	.reward-gift {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem 1.5rem;
		text-align: center;
		background: linear-gradient(135deg, #f3e8ff, #faf5ff);
	}

	.reward-gift__box {
		font-size: 4rem;
		animation: shake 0.5s ease-in-out infinite;
		display: block;
		margin-bottom: 1rem;
	}

	.reward-gift__text {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text-primary, #1f2937);
		margin: 0 0 1rem;
	}

	.reward-gift__open-btn {
		padding: 0.75rem 2rem;
		border: none;
		border-radius: 0.75rem;
		background: linear-gradient(135deg, #8b5cf6, #a78bfa);
		color: white;
		font-size: 1.1rem;
		font-weight: 700;
		cursor: pointer;
		transition: transform 0.15s;
	}

	.reward-gift__open-btn:hover {
		transform: scale(1.05);
	}

	/* Reveal phase */
	.reward-reveal {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem 1.5rem;
		text-align: center;
		overflow: hidden;
	}

	.reward-reveal__icon {
		font-size: 3.5rem;
		display: block;
		margin-bottom: 0.75rem;
		animation: bounceIn 0.5s ease;
	}

	.reward-reveal__name {
		font-size: 1.1rem;
		font-weight: 800;
		color: #7c3aed;
		margin: 0 0 0.5rem;
	}

	.reward-reveal__desc {
		font-size: 0.8rem;
		color: var(--color-text-secondary, #6b7280);
		margin: 0 0 1.25rem;
	}

	.reward-reveal__btn {
		padding: 0.75rem 2rem;
		border: none;
		border-radius: 0.75rem;
		background: linear-gradient(135deg, #8b5cf6, #a78bfa);
		color: white;
		font-size: 1rem;
		font-weight: 700;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.reward-reveal__btn:hover {
		opacity: 0.9;
	}

	/* Confetti */
	.reward-reveal__confetti {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.confetti-piece {
		position: absolute;
		width: 8px;
		height: 8px;
		top: -10px;
		left: calc(var(--i) * 12.5%);
		border-radius: 2px;
		animation: confettiFall 1.5s ease-out calc(var(--i) * 0.08s) both;
	}

	.confetti-piece:nth-child(odd) {
		background: #8b5cf6;
		width: 6px;
		height: 10px;
	}

	.confetti-piece:nth-child(even) {
		background: #f59e0b;
		width: 10px;
		height: 6px;
	}

	.confetti-piece:nth-child(3n) {
		background: #ec4899;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes shake {
		0%,
		100% {
			transform: rotate(0deg);
		}
		25% {
			transform: rotate(-5deg);
		}
		75% {
			transform: rotate(5deg);
		}
	}

	@keyframes bounceIn {
		0% {
			transform: scale(0.3);
			opacity: 0;
		}
		50% {
			transform: scale(1.1);
		}
		70% {
			transform: scale(0.95);
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	@keyframes confettiFall {
		0% {
			transform: translateY(0) rotate(0deg);
			opacity: 1;
		}
		100% {
			transform: translateY(300px) rotate(calc(var(--i) * 60deg + 180deg));
			opacity: 0;
		}
	}
</style>
