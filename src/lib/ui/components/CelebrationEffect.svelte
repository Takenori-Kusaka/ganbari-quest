<script lang="ts">
/**
 * CelebrationEffect — 記録完了時のビジュアル演出コンポーネント
 * ショップで購入した「たっせいえんしゅつ」に応じて演出が変わる
 */

export type CelebrationType =
	| 'default'
	| 'confetti'
	| 'fireworks'
	| 'stars'
	| 'cracker'
	| 'rainbow'
	| 'legend';

let { type = 'default' }: { type: CelebrationType } = $props();
</script>

{#if type === 'default'}
	<span class="text-5xl animate-bounce-in">✅</span>

{:else if type === 'confetti'}
	<div class="celeb celeb--confetti" aria-hidden="true">
		{#each Array(20) as _, i}
			<div
				class="confetti-piece"
				style="--x:{Math.random() * 100}%;--delay:{Math.random() * 0.5}s;--color:{['#ff6b6b','#4ecdc4','#ffe66d','#a8e6cf','#dda0dd','#ff9800','#2196f3'][i % 7]}"
			></div>
		{/each}
	</div>
	<span class="text-5xl animate-bounce-in">🎊</span>

{:else if type === 'fireworks'}
	<div class="celeb celeb--fireworks" aria-hidden="true">
		<div class="firework firework--1"></div>
		<div class="firework firework--2"></div>
		<div class="firework firework--3"></div>
	</div>
	<span class="text-5xl animate-bounce-in">🎆</span>

{:else if type === 'stars'}
	<div class="celeb celeb--stars" aria-hidden="true">
		{#each Array(12) as _, i}
			<div
				class="star-particle"
				style="--x:{Math.random() * 100}%;--delay:{Math.random() * 0.8}s;--size:{0.5 + Math.random() * 0.8}rem"
			></div>
		{/each}
	</div>
	<span class="text-5xl animate-bounce-in">🌠</span>

{:else if type === 'cracker'}
	<div class="celeb celeb--cracker" aria-hidden="true">
		{#each Array(16) as _, i}
			<div
				class="cracker-piece"
				style="--angle:{(i / 16) * 360}deg;--delay:{Math.random() * 0.3}s;--color:{['#ff6b6b','#4ecdc4','#ffe66d','#ff9800','#e040fb','#00bcd4','#8bc34a','#ff5722'][i % 8]}"
			></div>
		{/each}
	</div>
	<span class="text-5xl animate-bounce-in">🎉</span>

{:else if type === 'rainbow'}
	<div class="celeb celeb--rainbow" aria-hidden="true">
		<div class="rainbow-ring rainbow-ring--1"></div>
		<div class="rainbow-ring rainbow-ring--2"></div>
		<div class="rainbow-ring rainbow-ring--3"></div>
	</div>
	<span class="text-5xl animate-bounce-in">🌈</span>

{:else if type === 'legend'}
	<div class="celeb celeb--legend" aria-hidden="true">
		<div class="legend-aura"></div>
		{#each Array(10) as _, i}
			<div
				class="legend-particle"
				style="--angle:{(i / 10) * 360}deg;--delay:{Math.random() * 1}s"
			></div>
		{/each}
	</div>
	<span class="text-5xl animate-bounce-in">👑</span>
{/if}

<style>
	.celeb {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	/* ===== Confetti ===== */
	.confetti-piece {
		position: absolute;
		top: -10%;
		left: var(--x);
		width: 8px;
		height: 8px;
		background: var(--color);
		border-radius: 2px;
		animation: confetti-fall 1.5s ease-in var(--delay) forwards;
	}

	@keyframes confetti-fall {
		0% {
			transform: translateY(0) rotate(0deg);
			opacity: 1;
		}
		100% {
			transform: translateY(300px) rotate(720deg);
			opacity: 0;
		}
	}

	/* ===== Fireworks ===== */
	.firework {
		position: absolute;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		animation: firework-burst 1s ease-out forwards;
	}

	.firework--1 {
		top: 30%;
		left: 20%;
		box-shadow:
			0 0 0 0 #ff6b6b,
			20px -30px 0 0 #ff6b6b,
			-20px -30px 0 0 #ff6b6b,
			30px 0 0 0 #ff6b6b,
			-30px 0 0 0 #ff6b6b,
			20px 30px 0 0 #ff6b6b,
			-20px 30px 0 0 #ff6b6b,
			0 -40px 0 0 #ff6b6b;
		animation-delay: 0s;
	}

	.firework--2 {
		top: 20%;
		left: 70%;
		box-shadow:
			0 0 0 0 #4ecdc4,
			20px -30px 0 0 #4ecdc4,
			-20px -30px 0 0 #4ecdc4,
			30px 0 0 0 #4ecdc4,
			-30px 0 0 0 #4ecdc4,
			20px 30px 0 0 #4ecdc4,
			-20px 30px 0 0 #4ecdc4,
			0 -40px 0 0 #4ecdc4;
		animation-delay: 0.3s;
	}

	.firework--3 {
		top: 50%;
		left: 45%;
		box-shadow:
			0 0 0 0 #ffe66d,
			20px -30px 0 0 #ffe66d,
			-20px -30px 0 0 #ffe66d,
			30px 0 0 0 #ffe66d,
			-30px 0 0 0 #ffe66d,
			20px 30px 0 0 #ffe66d,
			-20px 30px 0 0 #ffe66d,
			0 -40px 0 0 #ffe66d;
		animation-delay: 0.6s;
	}

	@keyframes firework-burst {
		0% {
			opacity: 0;
			transform: scale(0);
		}
		30% {
			opacity: 1;
			transform: scale(1);
		}
		100% {
			opacity: 0;
			transform: scale(1.5);
		}
	}

	/* ===== Stars ===== */
	.star-particle {
		position: absolute;
		top: var(--x);
		left: var(--x);
		width: var(--size);
		height: var(--size);
		background: #ffd54f;
		clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
		animation: star-twinkle 1.5s ease-out var(--delay) forwards;
	}

	@keyframes star-twinkle {
		0% {
			transform: scale(0) rotate(0deg);
			opacity: 1;
		}
		50% {
			transform: scale(1.2) rotate(180deg);
			opacity: 1;
		}
		100% {
			transform: scale(0.5) rotate(360deg) translateY(60px);
			opacity: 0;
		}
	}

	/* ===== Cracker ===== */
	.cracker-piece {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 6px;
		height: 6px;
		background: var(--color);
		border-radius: 50%;
		animation: cracker-explode 0.8s ease-out var(--delay) forwards;
		--rad: 80px;
	}

	@keyframes cracker-explode {
		0% {
			transform: translate(-50%, -50%) rotate(var(--angle)) translateY(0);
			opacity: 1;
		}
		100% {
			transform: translate(-50%, -50%) rotate(var(--angle)) translateY(var(--rad));
			opacity: 0;
		}
	}

	/* ===== Rainbow ===== */
	.rainbow-ring {
		position: absolute;
		top: 50%;
		left: 50%;
		border-radius: 50%;
		border: 3px solid transparent;
		transform: translate(-50%, -50%) scale(0);
		animation: rainbow-expand 1.2s ease-out forwards;
	}

	.rainbow-ring--1 {
		width: 80px;
		height: 80px;
		border-color: #ff6b6b #ff9800 #ffe66d #4ecdc4;
		animation-delay: 0s;
	}

	.rainbow-ring--2 {
		width: 140px;
		height: 140px;
		border-color: #4ecdc4 #2196f3 #9c27b0 #ff6b6b;
		animation-delay: 0.2s;
	}

	.rainbow-ring--3 {
		width: 200px;
		height: 200px;
		border-color: #dda0dd #ff6b6b #ff9800 #ffe66d;
		animation-delay: 0.4s;
	}

	@keyframes rainbow-expand {
		0% {
			transform: translate(-50%, -50%) scale(0);
			opacity: 1;
		}
		70% {
			opacity: 0.8;
		}
		100% {
			transform: translate(-50%, -50%) scale(1);
			opacity: 0;
		}
	}

	/* ===== Legend ===== */
	.legend-aura {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 120px;
		height: 120px;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(255, 215, 0, 0.4) 0%, rgba(255, 215, 0, 0) 70%);
		transform: translate(-50%, -50%);
		animation: legend-pulse 1.5s ease-in-out infinite;
	}

	.legend-particle {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 4px;
		height: 4px;
		background: #ffd700;
		border-radius: 50%;
		box-shadow: 0 0 6px #ffd700;
		animation: legend-orbit 2s linear var(--delay) infinite;
	}

	@keyframes legend-pulse {
		0%,
		100% {
			transform: translate(-50%, -50%) scale(1);
			opacity: 0.4;
		}
		50% {
			transform: translate(-50%, -50%) scale(1.3);
			opacity: 0.7;
		}
	}

	@keyframes legend-orbit {
		0% {
			transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-50px) scale(1);
			opacity: 1;
		}
		50% {
			opacity: 0.6;
		}
		100% {
			transform: translate(-50%, -50%) rotate(calc(var(--angle) + 360deg)) translateY(-50px) scale(0.5);
			opacity: 0;
		}
	}
</style>
