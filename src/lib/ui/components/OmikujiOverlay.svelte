<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface Props {
	open: boolean;
	rank: string;
	basePoints: number;
	multiplier: number;
	totalPoints: number;
	consecutiveDays: number;
	onClose?: () => void;
}

let {
	open = $bindable(),
	rank,
	basePoints,
	multiplier,
	totalPoints,
	consecutiveDays,
	onClose,
}: Props = $props();

let revealed = $state(false);

const rankConfig: Record<
	string,
	{ color: string; glow: string; particles: string[]; accent: string; tier: number }
> = {
	大大吉: {
		color: '#b8860b',
		glow: '0 0 30px rgba(255, 215, 0, 0.6), 0 0 60px rgba(255, 215, 0, 0.3)',
		particles: ['✨', '🌟', '💫', '⭐', '🎊'],
		accent: 'linear-gradient(135deg, #ffd700, #ffaa00, #ffd700)',
		tier: 5,
	},
	大吉: {
		color: '#7b2d8b',
		glow: '0 0 20px rgba(147, 51, 234, 0.4), 0 0 40px rgba(147, 51, 234, 0.2)',
		particles: ['🌈', '✨', '💜'],
		accent: 'linear-gradient(135deg, #9333ea, #c084fc, #9333ea)',
		tier: 4,
	},
	中吉: {
		color: '#1e40af',
		glow: '0 0 15px rgba(59, 130, 246, 0.3)',
		particles: ['⭐', '💙'],
		accent: 'linear-gradient(135deg, #3b82f6, #60a5fa, #3b82f6)',
		tier: 3,
	},
	小吉: {
		color: '#047857',
		glow: '0 0 10px rgba(16, 185, 129, 0.3)',
		particles: ['🍀'],
		accent: 'linear-gradient(135deg, #10b981, #6ee7b7, #10b981)',
		tier: 2,
	},
	吉: {
		color: '#0369a1',
		glow: 'none',
		particles: [],
		accent: 'linear-gradient(135deg, #38bdf8, #7dd3fc, #38bdf8)',
		tier: 1,
	},
	末吉: {
		color: '#4b5563',
		glow: 'none',
		particles: [],
		accent: 'linear-gradient(135deg, #9ca3af, #d1d5db, #9ca3af)',
		tier: 0,
	},
};

const defaultConfig = {
	color: '#0369a1',
	glow: 'none',
	particles: [] as string[],
	accent: 'linear-gradient(135deg, #38bdf8, #7dd3fc, #38bdf8)',
	tier: 1,
};
const config = $derived(rankConfig[rank] ?? defaultConfig);

// 8日目以降は短縮モード（タップでスキップ可能）
const quickMode = $derived(consecutiveDays >= 8 && (rankConfig[rank]?.tier ?? 1) < 4);

$effect(() => {
	if (open) {
		revealed = false;
		soundService.play('omikuji-roll');

		const delay = quickMode ? 800 : 2000;
		const timer = setTimeout(() => {
			revealed = true;
			soundService.play('omikuji-result');
		}, delay);
		return () => clearTimeout(timer);
	}
});

function skipToResult() {
	if (!revealed && quickMode) {
		revealed = true;
		soundService.play('omikuji-result');
	}
}

function handleClose() {
	open = false;
	onClose?.();
}
</script>

<Dialog bind:open closable={false} title="">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="omikuji" data-testid="omikuji-overlay" onclick={skipToResult} onkeydown={skipToResult}>
		{#if !revealed}
			<!-- Shaking phase: omikuji box -->
			<div class="omikuji__scene">
				<div class="omikuji__torii">⛩️</div>
				<p class="omikuji__title">きょうのうんせい</p>
				<div class="omikuji__box-wrap">
					<div class="omikuji__box">
						<div class="omikuji__box-body">
							<div class="omikuji__stick"></div>
						</div>
						<div class="omikuji__box-label">おみくじ</div>
					</div>
				</div>
				<div class="omikuji__sakura">
					{#each Array(6) as _, i}
						<span class="omikuji__petal" style="--i:{i}">🌸</span>
					{/each}
				</div>
			</div>
		{:else}
			<!-- Result phase: omikuji slip -->
			<div class="omikuji__result" style="--rank-glow: {config.glow}">
				{#if config.tier >= 4}
					<div class="omikuji__confetti">
						{#each config.particles as p, i}
							{#each Array(3) as _, j}
								<span class="omikuji__confetti-piece" style="--ci:{i * 3 + j}">{p}</span>
							{/each}
						{/each}
					</div>
				{/if}

				<div class="omikuji__slip" style="--rank-accent: {config.accent}; --rank-color: {config.color}">
					<div class="omikuji__slip-border">
						<div class="omikuji__slip-inner">
							<div class="omikuji__slip-deco-top">🎋</div>
							<div class="omikuji__rank-wrap">
								<span class="omikuji__rank">{rank}</span>
							</div>
							{#if config.particles.length > 0}
								<div class="omikuji__rank-particles">
									{#each config.particles.slice(0, 3) as p}
										<span>{p}</span>
									{/each}
								</div>
							{/if}
							<div class="omikuji__slip-deco-bottom">🎋</div>
						</div>
					</div>
				</div>

				<div class="omikuji__points animate-point-pop">
					<p class="omikuji__points-value">+{totalPoints}</p>
					<p class="omikuji__points-label">ポイント</p>
				</div>

				{#if consecutiveDays >= 2}
					<p class="omikuji__streak">
						{consecutiveDays}にちれんぞく！
						{#if multiplier > 1}
							<span class="omikuji__streak-bonus">×{multiplier}ばい</span>
						{/if}
					</p>
				{/if}

				{#if consecutiveDays === 2}
					<p class="omikuji__hint">あと1にちで ×1.5ばい！</p>
				{:else if consecutiveDays === 6}
					<p class="omikuji__hint">あと1にちで ×2.0ばい！</p>
				{:else if consecutiveDays === 13}
					<p class="omikuji__hint">あと1にちで ×2.5ばい！</p>
				{:else if consecutiveDays === 29}
					<p class="omikuji__hint">あと1にちで ×3.0ばい！</p>
				{/if}

				<button class="omikuji__close tap-target" onclick={handleClose}>
					タップしてすすむ
				</button>
			</div>
		{/if}
	</div>
</Dialog>

<style>
	/* ============================
	   Base
	   ============================ */
	.omikuji {
		text-align: center;
		padding: var(--sp-sm) 0;
		min-height: 340px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	/* ============================
	   Shaking Phase
	   ============================ */
	.omikuji__scene {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}

	.omikuji__torii {
		font-size: 2.5rem;
		opacity: 0.3;
		animation: torii-fade 2s ease-in-out infinite alternate;
	}

	.omikuji__title {
		font-size: 1.125rem;
		font-weight: 800;
		color: #8b0000;
		letter-spacing: 0.15em;
	}

	.omikuji__box-wrap {
		perspective: 400px;
	}

	.omikuji__box {
		display: flex;
		flex-direction: column;
		align-items: center;
		animation: box-shake 0.4s ease-in-out infinite;
	}

	.omikuji__box-body {
		width: 80px;
		height: 100px;
		background: linear-gradient(180deg, #8b0000 0%, #660000 100%);
		border-radius: 8px 8px 0 0;
		position: relative;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.omikuji__stick {
		width: 6px;
		height: 60px;
		background: linear-gradient(180deg, #f5deb3, #deb887);
		border-radius: 3px 3px 0 0;
		position: relative;
		top: -20px;
		animation: stick-bounce 0.4s ease-in-out infinite alternate;
	}

	.omikuji__box-label {
		font-size: 0.75rem;
		font-weight: 700;
		color: #ffd700;
		background: #8b0000;
		padding: 2px 16px;
		border-radius: 0 0 6px 6px;
		letter-spacing: 0.1em;
	}

	/* Sakura petals */
	.omikuji__sakura {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.omikuji__petal {
		position: absolute;
		font-size: 1rem;
		opacity: 0.5;
		animation: petal-fall 3s ease-in-out infinite;
		animation-delay: calc(var(--i) * 0.5s);
		left: calc(var(--i) * 16% + 2%);
		top: -20px;
	}

	/* ============================
	   Result Phase
	   ============================ */
	.omikuji__result {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-md);
		position: relative;
	}

	/* Omikuji slip (paper) */
	.omikuji__slip {
		width: 140px;
		animation: slip-appear 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
		filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
	}

	.omikuji__slip-border {
		border: 3px solid var(--rank-color, #8b0000);
		border-radius: 6px;
		padding: 3px;
		background: var(--rank-accent, linear-gradient(135deg, #ffd700, #ffaa00));
		box-shadow: var(--rank-glow, none);
	}

	.omikuji__slip-inner {
		background:
			repeating-linear-gradient(
				0deg,
				transparent,
				transparent 2px,
				rgba(139, 69, 19, 0.03) 2px,
				rgba(139, 69, 19, 0.03) 4px
			),
			linear-gradient(180deg, #faf5e4, #f5edd6, #faf5e4);
		border-radius: 3px;
		padding: 16px 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.omikuji__slip-deco-top,
	.omikuji__slip-deco-bottom {
		font-size: 1rem;
		opacity: 0.4;
	}

	.omikuji__rank-wrap {
		padding: 4px 0;
	}

	.omikuji__rank {
		font-size: 2rem;
		font-weight: 900;
		color: var(--rank-color, #8b0000);
		writing-mode: vertical-rl;
		letter-spacing: 0.2em;
		text-shadow: 1px 1px 0 rgba(255, 255, 255, 0.5);
	}

	.omikuji__rank-particles {
		display: flex;
		gap: 4px;
		font-size: 0.875rem;
	}

	/* Points */
	.omikuji__points {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.omikuji__points-value {
		font-size: 1.75rem;
		font-weight: 900;
		color: var(--color-point);
	}

	.omikuji__points-label {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-text-muted);
	}

	/* Streak */
	.omikuji__streak {
		font-size: 0.875rem;
		font-weight: 700;
	}

	.omikuji__streak-bonus {
		color: var(--theme-accent);
	}

	.omikuji__hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	/* Close button */
	.omikuji__close {
		width: 100%;
		padding: 14px;
		border-radius: var(--radius-md);
		background: var(--theme-primary);
		color: white;
		font-weight: 700;
		font-size: 1.125rem;
		border: none;
		cursor: pointer;
		margin-top: var(--sp-sm);
	}

	/* ============================
	   Confetti (top-tier ranks)
	   ============================ */
	.omikuji__confetti {
		position: absolute;
		inset: -20px;
		pointer-events: none;
		overflow: hidden;
	}

	.omikuji__confetti-piece {
		position: absolute;
		font-size: 1.25rem;
		animation: confetti-burst 2s ease-out forwards;
		animation-delay: calc(var(--ci) * 0.1s);
		left: 50%;
		top: 30%;
	}

	/* ============================
	   Animations
	   ============================ */
	@keyframes torii-fade {
		from { opacity: 0.15; transform: scale(0.95); }
		to { opacity: 0.35; transform: scale(1); }
	}

	@keyframes box-shake {
		0%, 100% { transform: rotate(-3deg); }
		50% { transform: rotate(3deg); }
	}

	@keyframes stick-bounce {
		from { transform: translateY(0); }
		to { transform: translateY(-15px); }
	}

	@keyframes petal-fall {
		0% { transform: translateY(-20px) rotate(0deg); opacity: 0; }
		20% { opacity: 0.6; }
		100% { transform: translateY(280px) rotate(360deg); opacity: 0; }
	}

	@keyframes slip-appear {
		0% { transform: translateY(40px) scale(0.5); opacity: 0; }
		100% { transform: translateY(0) scale(1); opacity: 1; }
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

	/* ============================
	   Reduced Motion
	   ============================ */
	@media (prefers-reduced-motion: reduce) {
		.omikuji__box,
		.omikuji__stick,
		.omikuji__torii,
		.omikuji__petal,
		.omikuji__confetti-piece {
			animation: none;
		}
		.omikuji__slip {
			animation: none;
			opacity: 1;
		}
	}
</style>
