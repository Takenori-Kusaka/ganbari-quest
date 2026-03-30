<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface Props {
	open: boolean;
	/** Stamp emoji from stampToday result */
	stampEmoji: string;
	/** Stamp rarity: N, R, SR, UR */
	stampRarity: string;
	/** Total points from login bonus */
	totalPoints: number;
	/** Consecutive login days */
	consecutiveDays: number;
	/** Point multiplier from streak */
	multiplier: number;
	onClose?: () => void;
}

let {
	open = $bindable(),
	stampEmoji,
	stampRarity,
	totalPoints,
	consecutiveDays,
	multiplier,
	onClose,
}: Props = $props();

let phase = $state<'press' | 'result'>('press');

const rarityConfig: Record<
	string,
	{ label: string; color: string; glow: string; bgClass: string }
> = {
	UR: {
		label: 'UR',
		color: '#b8860b',
		glow: '0 0 30px rgba(255, 215, 0, 0.5)',
		bgClass: 'from-yellow-400 to-amber-500',
	},
	SR: {
		label: 'SR',
		color: '#7b2d8b',
		glow: '0 0 20px rgba(147, 51, 234, 0.4)',
		bgClass: 'from-purple-400 to-violet-500',
	},
	R: {
		label: 'R',
		color: '#1e40af',
		glow: '0 0 15px rgba(59, 130, 246, 0.3)',
		bgClass: 'from-blue-400 to-blue-500',
	},
	N: { label: 'N', color: '#4b5563', glow: 'none', bgClass: 'from-gray-400 to-gray-500' },
};

const defaultConfig = { label: 'N', color: '#4b5563', glow: 'none', bgClass: 'from-gray-400 to-gray-500' } as const;
const config = $derived(rarityConfig[stampRarity] ?? defaultConfig);

$effect(() => {
	if (open) {
		phase = 'press';
		soundService.play('omikuji-roll');

		const timer = setTimeout(() => {
			phase = 'result';
			soundService.play('special-reward');
		}, 1200);
		return () => clearTimeout(timer);
	}
});

function handleClose() {
	open = false;
	onClose?.();
}
</script>

<Dialog bind:open closable={false} title="">
	<div class="stamp-press" data-testid="stamp-press-overlay">
		{#if phase === 'press'}
			<!-- Stamp falling animation -->
			<div class="stamp-press__scene">
				<p class="text-sm font-bold text-gray-500 mb-2">きょうのスタンプ</p>
				<div class="stamp-press__stamp-falling">
					<span class="text-6xl">{stampEmoji}</span>
				</div>
				<div class="stamp-press__ink-ring"></div>
				<p class="text-sm text-gray-400 mt-4 animate-pulse">ドスン...！</p>
			</div>
		{:else}
			<!-- Result: stamp + points -->
			<div class="stamp-press__result" style="--rarity-glow: {config.glow}">
				<!-- Particles for SR/UR -->
				{#if stampRarity === 'UR' || stampRarity === 'SR'}
					<div class="stamp-press__particles">
						{#each Array(8) as _, i}
							<span class="stamp-press__particle" style="--i:{i}">
								{stampRarity === 'UR' ? '✨' : '⭐'}
							</span>
						{/each}
					</div>
				{/if}

				<div class="stamp-press__stamp-result" style="box-shadow: {config.glow}">
					<span class="text-5xl block mb-1">{stampEmoji}</span>
					<span
						class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white bg-gradient-to-r {config.bgClass}"
					>
						{config.label}
					</span>
				</div>

				<div class="mt-4 text-center">
					<p class="text-3xl font-bold text-amber-500 mb-1">+{totalPoints}pt</p>
					{#if consecutiveDays > 1}
						<p class="text-sm font-bold text-orange-500">
							{consecutiveDays}にち れんぞく！
							{#if multiplier > 1}
								<span class="text-xs">x{multiplier}</span>
							{/if}
						</p>
					{/if}
				</div>

				<button
					type="button"
					onclick={handleClose}
					class="mt-5 w-full py-2.5 bg-[var(--theme-accent)] text-white font-bold rounded-[var(--radius-lg)] text-base"
				>
					やったね！
				</button>
			</div>
		{/if}
	</div>
</Dialog>

<style>
	.stamp-press {
		text-align: center;
		padding: 1rem 0;
		min-height: 250px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* === Press phase === */
	.stamp-press__scene {
		position: relative;
	}

	.stamp-press__stamp-falling {
		animation: stamp-fall 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
	}

	@keyframes stamp-fall {
		0% {
			transform: translateY(-120px) scale(1.5);
			opacity: 0;
		}
		60% {
			transform: translateY(0) scale(1);
			opacity: 1;
		}
		75% {
			transform: translateY(-10px) scale(1.02);
		}
		100% {
			transform: translateY(0) scale(1);
		}
	}

	.stamp-press__ink-ring {
		position: absolute;
		bottom: 20%;
		left: 50%;
		width: 0;
		height: 0;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(239, 68, 68, 0.2) 0%, transparent 70%);
		animation: ink-spread 1.2s 0.6s ease-out forwards;
		transform: translateX(-50%);
	}

	@keyframes ink-spread {
		0% {
			width: 0;
			height: 0;
			opacity: 1;
		}
		100% {
			width: 120px;
			height: 120px;
			margin-left: -60px;
			margin-bottom: -60px;
			opacity: 0;
		}
	}

	/* === Result phase === */
	.stamp-press__result {
		animation: result-appear 0.4s ease-out;
		position: relative;
	}

	@keyframes result-appear {
		from {
			transform: scale(0.8);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}

	.stamp-press__stamp-result {
		display: inline-block;
		padding: 1rem 1.5rem;
		border-radius: 1rem;
		background: white;
		border: 2px solid #e5e7eb;
	}

	/* === Particles === */
	.stamp-press__particles {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.stamp-press__particle {
		position: absolute;
		top: 50%;
		left: 50%;
		font-size: 1.2rem;
		animation: particle-burst 1.5s ease-out forwards;
		animation-delay: calc(var(--i) * 0.05s);
	}

	@keyframes particle-burst {
		0% {
			transform: translate(-50%, -50%) scale(0);
			opacity: 1;
		}
		100% {
			transform:
				translate(
					calc(-50% + cos(calc(var(--i) * 45deg)) * 80px),
					calc(-50% + sin(calc(var(--i) * 45deg)) * 80px)
				)
				scale(1);
			opacity: 0;
		}
	}
</style>
