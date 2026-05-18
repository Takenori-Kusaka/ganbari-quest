<!--
  SiblingCelebration.svelte
  - #2107: Ark UI Dialog primitive (`$lib/ui/primitives/Dialog.svelte`) ベースに refactor。
    backdrop click / ESC / focus trap / aria-modal は primitive 側に委譲。
  - #2106: z-index は DESIGN §10 `--z-celebration` 階層を `zLayer="celebration"` で適用 (旧生数値 200)。
  - 紙吹雪エフェクトのみ component で保持 (Anti-engagement ADR-0012 整合: 1 件のみ、自動再生なし)。
  - 既存呼び出し側 API (`challengeTitle` / `challengeId` / `rewardClaimed` / `siblings` / `onDismiss`) は維持。
-->
<script lang="ts">
import { enhance } from '$app/forms';
import { FEATURES_LABELS } from '$lib/domain/labels';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	challengeTitle: string;
	challengeId: number;
	rewardClaimed: boolean;
	siblings: { name: string; completed: boolean }[];
	onDismiss: () => void;
}

let { challengeTitle, challengeId, rewardClaimed, siblings, onDismiss }: Props = $props();

// Confetti particles
// Confetti hex colors: kept as hex because JS array init runs before DOM is available for getComputedStyle
const confettiColors = ['#8b5cf6', '#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#ec4899'];
const confetti = Array.from({ length: 30 }, (_, i) => ({
	id: i,
	color: confettiColors[i % confettiColors.length],
	left: `${Math.random() * 100}%`,
	delay: `${Math.random() * 2}s`,
	duration: `${2 + Math.random() * 2}s`,
}));

let dialogOpen = $state(true);

function handleDialogChange(details: { open: boolean }) {
	if (!details.open) {
		onDismiss();
	}
	dialogOpen = details.open;
}
</script>

<Dialog
	bind:open={dialogOpen}
	onOpenChange={handleDialogChange}
	zLayer="celebration"
	size="sm"
	closable={false}
	testid="sibling-celebration"
	ariaLabel={FEATURES_LABELS.challenge.celebrationTitle}
	contentClass="celebration__content"
>
	<!-- Confetti (Dialog の backdrop は Ark UI 提供のため、ここでは card 内の演出のみ) -->
	<div class="celebration__confetti" aria-hidden="true">
		{#each confetti as c (c.id)}
			<div
				class="celebration__particle"
				style:left={c.left}
				style:background={c.color}
				style:animation-delay={c.delay}
				style:animation-duration={c.duration}
			></div>
		{/each}
	</div>

	<div class="celebration__inner">
		<div class="celebration__emoji">🎉</div>
		<h2 class="celebration__title">{FEATURES_LABELS.challenge.celebrationTitle}</h2>
		<p class="celebration__challenge">{challengeTitle}</p>

		<div class="celebration__siblings">
			{#each siblings as sib (sib.name)}
				<div class="celebration__sibling">
					<span class="celebration__check">{sib.completed ? '✅' : '⬜'}</span>
					<span>{sib.name}</span>
				</div>
			{/each}
		</div>

		{#if !rewardClaimed}
			<form
				method="POST"
				action="?/claimChallengeReward"
				use:enhance={() => {
					return async ({ update }) => {
						await update();
						dialogOpen = false;
						onDismiss();
					};
				}}
			>
				<input type="hidden" name="challengeId" value={challengeId} />
				<button type="submit" class="celebration__claim-btn">
					{FEATURES_LABELS.challenge.celebrationClaimBtn}
				</button>
			</form>
		{:else}
			<button
				type="button"
				class="celebration__close-btn"
				onclick={() => {
					dialogOpen = false;
					onDismiss();
				}}
			>
				{FEATURES_LABELS.challenge.celebrationCloseBtn}
			</button>
		{/if}
	</div>
</Dialog>

<style>
	/* Dialog content card inner customization */
	:global(.celebration__content) {
		position: relative;
		text-align: center;
		overflow: hidden;
	}

	.celebration__confetti {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.celebration__particle {
		position: absolute;
		top: -10px;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		animation: confetti-fall linear forwards;
	}

	.celebration__inner {
		position: relative;
		z-index: 1;
	}

	.celebration__emoji {
		font-size: 3rem;
		margin-bottom: 8px;
	}

	.celebration__title {
		font-size: 1.5rem;
		font-weight: 800;
		background: linear-gradient(135deg, var(--color-violet-500), var(--color-warning));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		margin-bottom: 4px;
	}

	.celebration__challenge {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin-bottom: 16px;
	}

	.celebration__siblings {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-bottom: 20px;
	}

	.celebration__sibling {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		background: var(--color-premium-bg);
		border-radius: 20px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-violet-600);
	}

	.celebration__check {
		font-size: 0.875rem;
	}

	.celebration__claim-btn {
		width: 100%;
		padding: 14px;
		border: none;
		border-radius: 12px;
		background: var(--gradient-premium);
		color: white;
		font-size: 1rem;
		font-weight: 700;
		cursor: pointer;
		animation: claim-glow 2s ease-in-out infinite;
	}

	.celebration__claim-btn:hover {
		filter: brightness(1.05);
	}

	.celebration__close-btn {
		width: 100%;
		padding: 12px;
		border: 1px solid var(--color-border-default);
		border-radius: 12px;
		background: var(--color-surface-card);
		color: var(--color-text-muted);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}

	@keyframes confetti-fall {
		0% {
			transform: translateY(-10px) rotate(0deg);
			opacity: 1;
		}
		100% {
			transform: translateY(100vh) rotate(720deg);
			opacity: 0;
		}
	}

	@keyframes claim-glow {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.4);
		}
		50% {
			box-shadow: 0 0 20px 4px rgba(139, 92, 246, 0.3);
		}
	}
</style>
