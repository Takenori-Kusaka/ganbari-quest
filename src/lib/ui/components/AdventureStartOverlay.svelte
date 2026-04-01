<script lang="ts">
import { CATEGORY_DEFS } from '$lib/domain/validation/activity';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface Props {
	open: boolean;
	childName: string;
	onClose?: () => void;
}

let { open = $bindable(), childName, onClose }: Props = $props();

let phase = $state(0);

const categories = CATEGORY_DEFS.slice(0, 5);

$effect(() => {
	if (open) {
		phase = 0;
		soundService.play('omikuji-roll');
		// Phase progression
		const timers: ReturnType<typeof setTimeout>[] = [];
		timers.push(
			setTimeout(() => {
				phase = 1;
			}, 1000),
		);
		timers.push(
			setTimeout(() => {
				phase = 2;
			}, 3000),
		);
		timers.push(
			setTimeout(() => {
				phase = 3;
			}, 5500),
		);
		timers.push(
			setTimeout(() => {
				phase = 4;
				soundService.play('omikuji-result');
			}, 8000),
		);
		return () => timers.forEach(clearTimeout);
	}
});

function handleClose() {
	open = false;
	onClose?.();
}
</script>

<Dialog bind:open closable={false} title="">
	<div class="adventure" data-testid="adventure-start-overlay">
		{#if phase === 0}
			<!-- Fade in from dark -->
			<div class="adventure__fade">
				<span class="adventure__sparkle">✨</span>
			</div>
		{:else if phase === 1}
			<!-- Greeting -->
			<div class="adventure__greeting animate-fade-in">
				<div class="adventure__avatar">🧒</div>
				<p class="adventure__text">やあ！ {childName}！</p>
			</div>
		{:else if phase === 2}
			<!-- Adventure message -->
			<div class="adventure__message animate-fade-in">
				<p class="adventure__big-text">きょうから いっしょに</p>
				<p class="adventure__big-text adventure__big-text--accent">ぼうけんだよ！</p>
				<div class="adventure__sparkles">
					{#each Array(5) as _, i}
						<span class="adventure__star" style="--si:{i}">⭐</span>
					{/each}
				</div>
			</div>
		{:else if phase === 3}
			<!-- Category icons appear one by one -->
			<div class="adventure__categories animate-fade-in">
				<p class="adventure__sub-text">いろんなことを がんばると</p>
				<p class="adventure__sub-text">つよくなれるよ！</p>
				<div class="adventure__cat-grid">
					{#each categories as cat, i (cat.id)}
						<div
							class="adventure__cat-item"
							style="--ci:{i}; --cat-color:{cat.color}"
						>
							<span class="adventure__cat-icon">{cat.icon}</span>
							<span class="adventure__cat-name">{cat.name}</span>
						</div>
					{/each}
				</div>
			</div>
		{:else}
			<!-- Ready to start -->
			<div class="adventure__ready animate-fade-in">
				<div class="adventure__confetti">
					{#each ['🎊', '✨', '🌟', '💫', '⭐'] as p, i}
						{#each Array(3) as _, j}
							<span class="adventure__confetti-piece" style="--ci:{i * 3 + j}">{p}</span>
						{/each}
					{/each}
				</div>
				<img src="/icon-character.png" alt="ぼうけんキャラクター" class="adventure__character" />
				<p class="adventure__ready-text">🌟 さあ、はじめよう！ 🌟</p>
				<p class="adventure__ready-sub">したのカードをタップしてみてね</p>
				<button class="adventure__start-btn tap-target" onclick={handleClose}>
					ぼうけんスタート！
				</button>
			</div>
		{/if}
	</div>
</Dialog>

<style>
	.adventure {
		text-align: center;
		padding: var(--sp-md) 0;
		min-height: 320px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	/* Phase 0: Fade */
	.adventure__fade {
		animation: fade-bright 1s ease-out forwards;
	}
	.adventure__sparkle {
		font-size: 3rem;
		animation: sparkle-pulse 0.8s ease-in-out infinite alternate;
	}

	/* Phase 1: Greeting */
	.adventure__greeting {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-md);
	}
	.adventure__avatar {
		font-size: 4rem;
		animation: avatar-bounce 0.6s ease-out;
	}
	.adventure__text {
		font-size: 1.25rem;
		font-weight: 800;
		color: var(--theme-primary);
	}

	/* Phase 2: Big message */
	.adventure__message {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-xs);
		position: relative;
	}
	.adventure__big-text {
		font-size: 1.25rem;
		font-weight: 900;
		color: var(--color-text);
	}
	.adventure__big-text--accent {
		font-size: 1.5rem;
		color: var(--theme-accent);
		text-shadow: 0 2px 8px rgba(255, 165, 0, 0.3);
	}
	.adventure__sparkles {
		position: absolute;
		inset: -30px;
		pointer-events: none;
	}
	.adventure__star {
		position: absolute;
		font-size: 1.25rem;
		animation: star-orbit 2s ease-in-out infinite;
		animation-delay: calc(var(--si) * 0.4s);
		left: calc(10% + var(--si) * 20%);
		top: calc(10% + var(--si) * 15%);
	}

	/* Phase 3: Categories */
	.adventure__categories {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-md);
	}
	.adventure__sub-text {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text-muted);
	}
	.adventure__cat-grid {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--sp-sm);
		max-width: 280px;
	}
	.adventure__cat-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		animation: cat-pop 0.4s ease-out backwards;
		animation-delay: calc(var(--ci) * 0.3s);
	}
	.adventure__cat-icon {
		font-size: 2rem;
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
	}
	.adventure__cat-name {
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--cat-color);
	}

	/* Phase 4: Ready */
	.adventure__ready {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-md);
		position: relative;
	}
	.adventure__character {
		width: 120px;
		height: 120px;
		object-fit: contain;
		animation: character-bounce 0.8s ease-out;
		filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15));
	}
	.adventure__ready-text {
		font-size: 1.5rem;
		font-weight: 900;
		color: var(--theme-primary);
		text-shadow: 0 2px 8px rgba(255, 165, 0, 0.2);
	}
	.adventure__ready-sub {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}
	.adventure__start-btn {
		width: 100%;
		max-width: 260px;
		padding: 14px;
		border-radius: var(--radius-md);
		background: linear-gradient(135deg, var(--theme-primary), var(--theme-accent));
		color: white;
		font-weight: 800;
		font-size: 1.125rem;
		border: none;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	/* Confetti */
	.adventure__confetti {
		position: absolute;
		inset: -30px;
		pointer-events: none;
		overflow: hidden;
	}
	.adventure__confetti-piece {
		position: absolute;
		font-size: 1.25rem;
		animation: confetti-burst 2s ease-out forwards;
		animation-delay: calc(var(--ci) * 0.08s);
		left: 50%;
		top: 20%;
	}

	/* Animations */
	.animate-fade-in {
		animation: fade-in 0.5s ease-out;
	}

	@keyframes fade-bright {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	@keyframes sparkle-pulse {
		from { transform: scale(0.8); opacity: 0.5; }
		to { transform: scale(1.2); opacity: 1; }
	}
	@keyframes avatar-bounce {
		0% { transform: scale(0) translateY(20px); }
		60% { transform: scale(1.2) translateY(-5px); }
		100% { transform: scale(1) translateY(0); }
	}
	@keyframes fade-in {
		from { opacity: 0; transform: translateY(10px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes star-orbit {
		0%, 100% { transform: scale(0.5); opacity: 0.3; }
		50% { transform: scale(1.2); opacity: 1; }
	}
	@keyframes cat-pop {
		from { transform: scale(0); opacity: 0; }
		to { transform: scale(1); opacity: 1; }
	}
	@keyframes character-bounce {
		0% { transform: scale(0) translateY(30px); opacity: 0; }
		50% { transform: scale(1.15) translateY(-8px); opacity: 1; }
		100% { transform: scale(1) translateY(0); opacity: 1; }
	}
	@keyframes confetti-burst {
		0% { transform: translate(0, 0) scale(0) rotate(0deg); opacity: 0; }
		20% { opacity: 1; transform: scale(1); }
		100% {
			transform: translate(
				calc((var(--ci) - 7) * 25px),
				calc((var(--ci) - 5) * 20px)
			) scale(0.3) rotate(720deg);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.adventure__sparkle,
		.adventure__avatar,
		.adventure__star,
		.adventure__cat-item,
		.adventure__confetti-piece,
		.adventure__character {
			animation: none;
		}
		.animate-fade-in,
		.adventure__fade {
			animation: none;
			opacity: 1;
		}
	}
</style>
