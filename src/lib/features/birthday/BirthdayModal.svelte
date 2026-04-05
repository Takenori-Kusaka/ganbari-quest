<script lang="ts">
import { enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { formatChildName } from '$lib/domain/child-display';
import CelebrationEffect from '$lib/ui/components/CelebrationEffect.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface Props {
	open: boolean;
	nickname: string;
	newAge: number;
	totalPoints: number;
	uiMode: string;
}

let { open = $bindable(), nickname, newAge, totalPoints, uiMode }: Props = $props();

let claiming = $state(false);
let claimed = $state(false);
let claimedPoints = $state(0);

function getMessageText(): { main: string; sub: string; button: string } {
	if (uiMode === 'baby' || uiMode === 'kinder') {
		return {
			main: `${formatChildName(nickname, 'vocative')}${newAge}さい\nおめでとう！`,
			sub: 'これからも いっぱい がんばろうね！',
			button: 'やったー！',
		};
	}
	if (uiMode === 'lower') {
		return {
			main: `${formatChildName(nickname, 'vocative')}${newAge}さい\nおめでとう！`,
			sub: 'これからもたくさんチャレンジしよう！',
			button: 'やったー！',
		};
	}
	return {
		main: `${formatChildName(nickname, 'vocative')}${newAge}歳\nおめでとう！`,
		sub: 'これからもチャレンジを続けよう！',
		button: 'ありがとう！',
	};
}

const msg = $derived(getMessageText());
</script>

<Dialog bind:open closable={false} title="">
	<div class="birthday-modal" data-testid="birthday-modal">
		{#if claimed}
			<!-- After claiming -->
			<div class="birthday-modal__celebration">
				<CelebrationEffect type="default" />
			</div>
			<p class="birthday-modal__emoji">🎉🎂🎊</p>
			<p class="birthday-modal__main">{msg.main}</p>
			<div class="birthday-modal__reward">
				<span class="birthday-modal__reward-label">🎁 おたんじょうびボーナス</span>
				<span class="birthday-modal__reward-points animate-point-pop">⭐ {claimedPoints} ポイント！</span>
			</div>
			<p class="birthday-modal__sub">{msg.sub}</p>
			<button
				type="button"
				class="birthday-modal__btn"
				data-testid="birthday-close-btn"
				onclick={() => {
					open = false;
					invalidateAll();
				}}
			>
				🎉 {msg.button}
			</button>
		{:else}
			<!-- Before claiming -->
			<p class="birthday-modal__emoji">🎂🎉🎊</p>
			<p class="birthday-modal__main">おたんじょうび おめでとう！</p>
			<p class="birthday-modal__age-text">
				{formatChildName(nickname, 'vocative')}{newAge}さい になったね！
			</p>
			<div class="birthday-modal__reward">
				<span class="birthday-modal__reward-label">🎁 おたんじょうびボーナス</span>
				<span class="birthday-modal__reward-points">⭐ {totalPoints} ポイント！</span>
			</div>
			<p class="birthday-modal__sub">{msg.sub}</p>
			<form
				method="POST"
				action="?/claimBirthday"
				use:enhance={() => {
					claiming = true;
					return async ({ result }) => {
						claiming = false;
						if (result.type === 'success' && result.data && 'birthdayClaimed' in result.data) {
							const d = result.data as { totalPoints: number };
							claimedPoints = d.totalPoints;
							claimed = true;
							soundService.play('special-reward');
						}
					};
				}}
			>
				<button
					type="submit"
					class="birthday-modal__btn"
					data-testid="birthday-claim-btn"
					disabled={claiming}
				>
					{claiming ? 'もらっています...' : '🎉 うけとる！'}
				</button>
			</form>
		{/if}

		<!-- Confetti decoration — hex colors kept: JS array init before DOM available for getComputedStyle -->
		<div class="birthday-modal__confetti" aria-hidden="true">
			{#each Array(12) as _, i}
				<span
					class="birthday-modal__confetti-piece"
					style:--delay="{i * 0.15}s"
					style:--x="{(i % 4) * 25 - 37}%"
					style:--color={['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'][i % 6]}
				></span>
			{/each}
		</div>
	</div>
</Dialog>

<style>
	.birthday-modal {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
		padding: 16px 0;
		position: relative;
		overflow: hidden;
	}

	.birthday-modal__celebration {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.birthday-modal__emoji {
		font-size: 2.5rem;
		margin: 0;
		animation: emoji-bounce 0.6s ease-out;
	}

	@keyframes emoji-bounce {
		0% { transform: scale(0); }
		60% { transform: scale(1.2); }
		100% { transform: scale(1); }
	}

	.birthday-modal__main {
		font-size: 1.25rem;
		font-weight: 900;
		color: var(--color-text, #1f2937);
		margin: 0;
		white-space: pre-line;
		line-height: 1.4;
	}

	.birthday-modal__age-text {
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--color-feedback-warning-text);
		margin: 0;
	}

	.birthday-modal__reward {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		background: linear-gradient(135deg, var(--color-feedback-warning-bg), var(--color-feedback-warning-bg-strong));
		border: 2px solid var(--color-gold-400);
		border-radius: var(--radius-md, 12px);
		padding: 12px 20px;
		width: 100%;
	}

	.birthday-modal__reward-label {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--color-feedback-warning-text);
	}

	.birthday-modal__reward-points {
		font-size: 1.5rem;
		font-weight: 900;
		color: var(--color-stat-amber);
	}

	.birthday-modal__sub {
		font-size: 0.8125rem;
		color: var(--color-text-muted, #6b7280);
		margin: 0;
	}

	.birthday-modal__btn {
		width: 100%;
		padding: 12px;
		border-radius: var(--radius-md, 12px);
		font-size: 1.0625rem;
		font-weight: 800;
		color: white;
		border: none;
		cursor: pointer;
		background: linear-gradient(135deg, var(--color-warning), var(--color-gold-400));
		box-shadow: 0 2px 8px color-mix(in srgb, var(--color-warning) 30%, transparent);	}
	.birthday-modal__btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Confetti animation */
	.birthday-modal__confetti {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.birthday-modal__confetti-piece {
		position: absolute;
		top: -10px;
		left: 50%;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--color);
		animation: confetti-fall 2.5s ease-in var(--delay) infinite;
		transform: translateX(var(--x));
	}

	@keyframes confetti-fall {
		0% {
			top: -10px;
			opacity: 1;
			transform: translateX(var(--x)) rotate(0deg);
		}
		100% {
			top: 100%;
			opacity: 0;
			transform: translateX(calc(var(--x) + 20px)) rotate(720deg);
		}
	}
</style>
