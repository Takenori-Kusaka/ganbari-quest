<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface Props {
	open: boolean;
	rank: string;
	totalPoints: number;
	multiplier: number;
	consecutiveDays: number;
	onClose?: () => void;
}

let {
	open = $bindable(),
	rank,
	totalPoints,
	multiplier,
	consecutiveDays,
	onClose,
}: Props = $props();

type Phase = 'shake' | 'result' | 'stamp';
let phase = $state<Phase>('shake');

const rankConfig: Record<
	string,
	{ color: string; glow: string; particles: string[]; accent: string; tier: number }
> = {
	大大吉: {
		color: '#b8860b',
		glow: '0 0 30px rgba(255, 215, 0, 0.6)',
		particles: ['✨', '🌟', '💫', '⭐', '🎊'],
		accent: 'linear-gradient(135deg, #ffd700, #ffaa00, #ffd700)',
		tier: 5,
	},
	大吉: {
		color: '#7b2d8b',
		glow: '0 0 20px rgba(147, 51, 234, 0.4)',
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

// 8日目以降 × 低ランクは短縮モード
const quickMode = $derived(consecutiveDays >= 8 && (rankConfig[rank]?.tier ?? 1) < 4);

// Seal stamp colors (same as StampCard)
const sealColors: Record<string, { stroke: string; fill: string; text: string }> = {
	大大吉: { stroke: '#d4a017', fill: 'rgba(212, 160, 23, 0.15)', text: '#b8860b' },
	大吉: { stroke: '#7c3aed', fill: 'rgba(124, 58, 237, 0.12)', text: '#6d28d9' },
	中吉: { stroke: '#3b82f6', fill: 'rgba(59, 130, 246, 0.10)', text: '#2563eb' },
	小吉: { stroke: '#10b981', fill: 'rgba(16, 185, 129, 0.10)', text: '#059669' },
	吉: { stroke: '#38bdf8', fill: 'rgba(56, 189, 248, 0.10)', text: '#0284c7' },
	末吉: { stroke: '#9ca3af', fill: 'rgba(156, 163, 175, 0.08)', text: '#6b7280' },
};
const sealStyle = $derived(
	sealColors[rank] ?? { stroke: '#9ca3af', fill: 'rgba(156, 163, 175, 0.08)', text: '#6b7280' },
);

$effect(() => {
	if (open) {
		phase = 'shake';
		soundService.play('omikuji-roll');

		const shakeDelay = quickMode ? 800 : 1500;
		const stampDelay = quickMode ? 1300 : 2800;

		const t1 = setTimeout(() => {
			phase = 'result';
			soundService.play('omikuji-result');
		}, shakeDelay);

		const t2 = setTimeout(() => {
			phase = 'stamp';
			soundService.play('special-reward');
		}, stampDelay);

		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
		};
	}
});

function skipToStamp() {
	if (phase === 'shake' && quickMode) {
		phase = 'stamp';
		soundService.play('special-reward');
	}
}

function handleClose() {
	open = false;
	onClose?.();
}
</script>

<Dialog bind:open closable={false} title="">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="omikuji-stamp"
		data-testid="omikuji-stamp-overlay"
		onclick={skipToStamp}
		onkeydown={skipToStamp}
	>
		{#if phase === 'shake'}
			<!-- Phase 1: おみくじ箱を振る -->
			<div class="os__scene">
				<div class="os__torii">⛩️</div>
				<p class="os__title">きょうのうんせい</p>
				<div class="os__box-wrap">
					<div class="os__box">
						<div class="os__box-body">
							<div class="os__stick"></div>
						</div>
						<div class="os__box-label">おみくじ</div>
					</div>
				</div>
				<div class="os__sakura">
					{#each Array(6) as _, i}
						<span class="os__petal" style:--i={i}>🌸</span>
					{/each}
				</div>
			</div>
		{:else if phase === 'result'}
			<!-- Phase 2: おみくじ結果表示 -->
			<div class="os__result" style:--rank-glow={config.glow}>
				{#if config.tier >= 4}
					<div class="os__confetti">
						{#each config.particles as p, i}
							{#each Array(3) as _, j}
								<span class="os__confetti-piece" style:--ci={i * 3 + j}>{p}</span>
							{/each}
						{/each}
					</div>
				{/if}

				<div
					class="os__slip"
					style:--rank-accent={config.accent}
					style:--rank-color={config.color}
				>
					<div class="os__slip-border">
						<div class="os__slip-inner">
							<div class="os__slip-deco">🎋</div>
							<div class="os__rank-wrap">
								<span class="os__rank">{rank}</span>
							</div>
							{#if config.particles.length > 0}
								<div class="os__rank-particles">
									{#each config.particles.slice(0, 3) as p}
										<span>{p}</span>
									{/each}
								</div>
							{/if}
							<div class="os__slip-deco">🎋</div>
						</div>
					</div>
				</div>

				<div class="os__points">
					<p class="os__points-value">+{totalPoints}</p>
					<p class="os__points-label">ポイント</p>
				</div>
			</div>
		{:else}
			<!-- Phase 3: スタンプ押印 + 完了 -->
			<div class="os__stamp-phase">
				<p class="os__stamp-title">スタンプカードに おしたよ！</p>

				<!-- Seal stamp animation -->
				<div class="os__seal-wrap">
					<div
						class="os__seal"
						style:border-color={sealStyle.stroke}
						style:background={sealStyle.fill}
						style:box-shadow={config.glow}
					>
						<span class="os__seal-text" style:color={sealStyle.text}>{rank}</span>
					</div>
					<div class="os__ink-ring" style:background="radial-gradient(circle, {sealStyle.stroke}33 0%, transparent 70%)"></div>
				</div>

				<div class="os__stamp-points">
					<p class="os__points-value os__points-value--small">+{totalPoints}pt</p>
					{#if consecutiveDays >= 2}
						<p class="os__streak">
							{consecutiveDays}にちれんぞく！
							{#if multiplier > 1}
								<span class="os__streak-bonus">×{multiplier}ばい</span>
							{/if}
						</p>
					{/if}
				</div>

				{#if consecutiveDays === 2}
					<p class="os__hint">あと1にちで ×1.5ばい！</p>
				{:else if consecutiveDays === 6}
					<p class="os__hint">あと1にちで ×2.0ばい！</p>
				{:else if consecutiveDays === 13}
					<p class="os__hint">あと1にちで ×2.5ばい！</p>
				{:else if consecutiveDays === 29}
					<p class="os__hint">あと1にちで ×3.0ばい！</p>
				{/if}

				<button class="os__close tap-target" onclick={handleClose}> やったね！ </button>
			</div>
		{/if}
	</div>
</Dialog>

<style>
	/* ============================
	   Base
	   ============================ */
	.omikuji-stamp {
		text-align: center;
		padding: var(--sp-sm, 8px) 0;
		min-height: 300px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	/* ============================
	   Phase 1: Shaking
	   ============================ */
	.os__scene {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}

	.os__torii {
		font-size: 2.5rem;
		opacity: 0.3;
		animation: torii-fade 2s ease-in-out infinite alternate;
	}

	.os__title {
		font-size: 1.125rem;
		font-weight: 800;
		color: #8b0000;
		letter-spacing: 0.15em;
	}

	.os__box-wrap {
		perspective: 400px;
	}

	.os__box {
		display: flex;
		flex-direction: column;
		align-items: center;
		animation: box-shake 0.4s ease-in-out infinite;
	}

	.os__box-body {
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

	.os__stick {
		width: 6px;
		height: 60px;
		background: linear-gradient(180deg, #f5deb3, #deb887);
		border-radius: 3px 3px 0 0;
		position: relative;
		top: -20px;
		animation: stick-bounce 0.4s ease-in-out infinite alternate;
	}

	.os__box-label {
		font-size: 0.75rem;
		font-weight: 700;
		color: #ffd700;
		background: #8b0000;
		padding: 2px 16px;
		border-radius: 0 0 6px 6px;
		letter-spacing: 0.1em;
	}

	.os__sakura {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.os__petal {
		position: absolute;
		font-size: 1rem;
		opacity: 0.5;
		animation: petal-fall 3s ease-in-out infinite;
		animation-delay: calc(var(--i) * 0.5s);
		left: calc(var(--i) * 16% + 2%);
		top: -20px;
	}

	/* ============================
	   Phase 2: Result
	   ============================ */
	.os__result {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		position: relative;
		animation: fade-in 0.3s ease-out;
	}

	.os__slip {
		width: 120px;
		animation: slip-appear 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
		filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
	}

	.os__slip-border {
		border: 3px solid var(--rank-color, #8b0000);
		border-radius: 6px;
		padding: 3px;
		background: var(--rank-accent);
		box-shadow: var(--rank-glow, none);
	}

	.os__slip-inner {
		background:
			repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(139, 69, 19, 0.03) 2px, rgba(139, 69, 19, 0.03) 4px),
			linear-gradient(180deg, #faf5e4, #f5edd6, #faf5e4);
		border-radius: 3px;
		padding: 12px 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}

	.os__slip-deco {
		font-size: 0.875rem;
		opacity: 0.4;
	}

	.os__rank-wrap {
		padding: 2px 0;
	}

	.os__rank {
		font-size: 1.75rem;
		font-weight: 900;
		color: var(--rank-color, #8b0000);
		writing-mode: vertical-rl;
		letter-spacing: 0.2em;
		text-shadow: 1px 1px 0 rgba(255, 255, 255, 0.5);
	}

	.os__rank-particles {
		display: flex;
		gap: 4px;
		font-size: 0.75rem;
	}

	.os__points {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.os__points-value {
		font-size: 1.5rem;
		font-weight: 900;
		color: var(--color-point, #d97706);
		animation: point-pop 0.4s ease-out;
	}

	.os__points-value--small {
		font-size: 1.25rem;
	}

	.os__points-label {
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--color-text-muted, #9ca3af);
	}

	/* ============================
	   Phase 3: Stamp
	   ============================ */
	.os__stamp-phase {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		animation: fade-in 0.3s ease-out;
	}

	.os__stamp-title {
		font-size: 1rem;
		font-weight: 800;
		color: var(--color-text, #1f2937);
	}

	.os__seal-wrap {
		position: relative;
		width: 80px;
		height: 80px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.os__seal {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		border: 3px solid;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: seal-press 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
	}

	.os__seal-text {
		font-size: 1rem;
		font-weight: 900;
		writing-mode: vertical-rl;
		text-orientation: upright;
		letter-spacing: 0.05em;
		line-height: 1;
	}

	.os__ink-ring {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 0;
		height: 0;
		border-radius: 50%;
		animation: ink-spread 0.8s 0.3s ease-out forwards;
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.os__stamp-points {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.os__streak {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--color-text, #1f2937);
	}

	.os__streak-bonus {
		color: var(--theme-accent, #f59e0b);
	}

	.os__hint {
		font-size: 0.6875rem;
		color: var(--color-text-muted, #9ca3af);
	}

	.os__close {
		width: 100%;
		padding: 12px;
		border-radius: var(--radius-md, 12px);
		background: var(--theme-primary, #6366f1);
		color: white;
		font-weight: 700;
		font-size: 1rem;
		border: none;
		cursor: pointer;
		margin-top: 4px;
	}

	/* ============================
	   Confetti
	   ============================ */
	.os__confetti {
		position: absolute;
		inset: -20px;
		pointer-events: none;
		overflow: hidden;
	}

	.os__confetti-piece {
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
	@keyframes fade-in {
		from {
			opacity: 0;
			transform: scale(0.9);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	@keyframes torii-fade {
		from {
			opacity: 0.15;
			transform: scale(0.95);
		}
		to {
			opacity: 0.35;
			transform: scale(1);
		}
	}

	@keyframes box-shake {
		0%,
		100% {
			transform: rotate(-3deg);
		}
		50% {
			transform: rotate(3deg);
		}
	}

	@keyframes stick-bounce {
		from {
			transform: translateY(0);
		}
		to {
			transform: translateY(-15px);
		}
	}

	@keyframes petal-fall {
		0% {
			transform: translateY(-20px) rotate(0deg);
			opacity: 0;
		}
		20% {
			opacity: 0.6;
		}
		100% {
			transform: translateY(280px) rotate(360deg);
			opacity: 0;
		}
	}

	@keyframes slip-appear {
		0% {
			transform: translateY(40px) scale(0.5);
			opacity: 0;
		}
		100% {
			transform: translateY(0) scale(1);
			opacity: 1;
		}
	}

	@keyframes seal-press {
		0% {
			transform: scale(2) rotate(-15deg);
			opacity: 0;
		}
		40% {
			transform: scale(0.9) rotate(2deg);
			opacity: 1;
		}
		60% {
			transform: scale(1.05) rotate(-1deg);
		}
		100% {
			transform: scale(1) rotate(0deg);
		}
	}

	@keyframes ink-spread {
		0% {
			width: 0;
			height: 0;
			opacity: 0.8;
		}
		100% {
			width: 100px;
			height: 100px;
			opacity: 0;
		}
	}

	@keyframes point-pop {
		0% {
			transform: scale(0.5);
			opacity: 0;
		}
		60% {
			transform: scale(1.2);
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	@keyframes confetti-burst {
		0% {
			transform: translate(0, 0) scale(0) rotate(0deg);
			opacity: 0;
		}
		20% {
			opacity: 1;
			transform: scale(1);
		}
		100% {
			transform: translate(calc((var(--ci) - 7) * 25px), calc((var(--ci) - 5) * 20px)) scale(0.3)
				rotate(720deg);
			opacity: 0;
		}
	}

	/* ============================
	   Reduced Motion
	   ============================ */
	@media (prefers-reduced-motion: reduce) {
		.os__box,
		.os__stick,
		.os__torii,
		.os__petal,
		.os__confetti-piece,
		.os__seal,
		.os__ink-ring {
			animation: none;
		}
		.os__slip {
			animation: none;
			opacity: 1;
		}
	}
</style>
