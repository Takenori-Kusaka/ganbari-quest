<script lang="ts">
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface LevelUpData {
	oldLevel: number;
	oldTitle: string;
	newLevel: number;
	newTitle: string;
}

interface Props {
	open: boolean;
	levelUp: LevelUpData | null;
	onClose?: () => void;
}

let { open = $bindable(), levelUp, onClose }: Props = $props();

let displayLevel = $state(0);
let showTitle = $state(false);
let animating = $state(false);

const LEVEL_ICONS: Record<number, string> = {
	1: '🌱',
	2: '🌿',
	3: '⚔️',
	4: '💪',
	5: '✨',
	6: '🗡️',
	7: '🦅',
	8: '🌟',
	9: '👑',
	10: '🌈',
};

const LEVEL_MESSAGES: Record<number, string> = {
	1: 'ぼうけんがはじまるよ！',
	2: 'がんばってるね！',
	3: 'つよくなってきたよ！',
	4: 'すごいぞ！どんどんいこう！',
	5: 'もうたいしたものだ！',
	6: 'きみはもうベテランだ！',
	7: 'そらもとべそうだね！',
	8: 'すばらしい！マスターめざそう！',
	9: 'ほぼさいきょう！あとすこし！',
	10: 'かみさまレベルだ！おめでとう！',
};

$effect(() => {
	if (open && levelUp) {
		animating = true;
		showTitle = false;
		displayLevel = levelUp.oldLevel;

		soundService.play('level-up');

		// Count up animation
		const timer = setTimeout(() => {
			displayLevel = levelUp?.newLevel;
			setTimeout(() => {
				showTitle = true;
				animating = false;
			}, 400);
		}, 800);

		return () => clearTimeout(timer);
	}
});

function handleClose() {
	open = false;
	onClose?.();
}
</script>

<Dialog bind:open closable={false} title="">
	{#if levelUp}
		<div class="levelup-container">
			<!-- Sparkle effects -->
			<div class="levelup-sparkles">
				<span class="sparkle s1">✦</span>
				<span class="sparkle s2">✧</span>
				<span class="sparkle s3">✦</span>
				<span class="sparkle s4">✧</span>
				<span class="sparkle s5">⭐</span>
				<span class="sparkle s6">✦</span>
			</div>

			<p class="levelup-label">レベルアップ！</p>

			<div class="levelup-icon-wrapper">
				<span class="levelup-icon">{LEVEL_ICONS[levelUp.newLevel] ?? '⭐'}</span>
			</div>

			<div class="levelup-level">
				<span class="levelup-level-number">Lv.{displayLevel}</span>
			</div>

			{#if showTitle}
				<p class="levelup-title animate-bounce-in">{levelUp.newTitle}</p>
				<p class="levelup-message">{LEVEL_MESSAGES[levelUp.newLevel] ?? 'すごい！がんばったね！'}</p>
			{/if}

			<button
				class="tap-target levelup-btn"
				onclick={handleClose}
			>
				やったー！
			</button>
		</div>
	{/if}
</Dialog>

<style>
	.levelup-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-md);
		text-align: center;
		padding: var(--sp-lg) var(--sp-md);
		position: relative;
		overflow: hidden;
	}

	.levelup-sparkles {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.sparkle {
		position: absolute;
		font-size: 1.2rem;
		opacity: 0;
		animation: sparkle-float 2s ease-in-out infinite;
	}
	.s1 { top: 10%; left: 15%; animation-delay: 0s; color: #fbbf24; }
	.s2 { top: 5%; right: 20%; animation-delay: 0.3s; color: #f472b6; }
	.s3 { top: 30%; left: 5%; animation-delay: 0.6s; color: #60a5fa; }
	.s4 { top: 25%; right: 8%; animation-delay: 0.9s; color: #a78bfa; }
	.s5 { top: 50%; left: 10%; animation-delay: 1.2s; color: #fbbf24; }
	.s6 { top: 45%; right: 12%; animation-delay: 1.5s; color: #34d399; }

	@keyframes sparkle-float {
		0% { opacity: 0; transform: translateY(0) scale(0.5); }
		50% { opacity: 1; transform: translateY(-10px) scale(1.2); }
		100% { opacity: 0; transform: translateY(-20px) scale(0.5); }
	}

	.levelup-label {
		font-size: 1.5rem;
		font-weight: 800;
		background: linear-gradient(135deg, #f59e0b, #ef4444, #8b5cf6);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		animation: levelup-pulse 1s ease-in-out infinite alternate;
	}

	@keyframes levelup-pulse {
		from { transform: scale(1); }
		to { transform: scale(1.05); }
	}

	.levelup-icon-wrapper {
		width: 7rem;
		height: 7rem;
		border-radius: var(--radius-lg);
		border: 4px solid #fbbf24;
		background: linear-gradient(135deg, #fffbeb, #fef3c7, #fde68a);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 0 30px rgba(251, 191, 36, 0.4);
		animation: icon-glow 1.5s ease-in-out infinite alternate;
	}

	@keyframes icon-glow {
		from { box-shadow: 0 0 20px rgba(251, 191, 36, 0.3); }
		to { box-shadow: 0 0 40px rgba(251, 191, 36, 0.6); }
	}

	.levelup-icon {
		font-size: 3.5rem;
		animation: icon-bounce 0.6s ease-out;
	}

	@keyframes icon-bounce {
		0% { transform: scale(0); }
		50% { transform: scale(1.3); }
		70% { transform: scale(0.9); }
		100% { transform: scale(1); }
	}

	.levelup-level {
		animation: level-pop 0.5s ease-out 0.8s both;
	}

	@keyframes level-pop {
		0% { transform: scale(0); opacity: 0; }
		60% { transform: scale(1.3); }
		100% { transform: scale(1); opacity: 1; }
	}

	.levelup-level-number {
		font-size: 2.5rem;
		font-weight: 900;
		color: var(--theme-accent, #f59e0b);
		text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
	}

	.levelup-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text);
	}

	.levelup-message {
		font-size: 1rem;
		color: var(--color-text-muted);
		animation: fade-in 0.5s ease-out 1.4s both;
	}

	@keyframes fade-in {
		from { opacity: 0; transform: translateY(10px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.levelup-btn {
		width: 100%;
		padding: 1rem;
		border-radius: var(--radius-md);
		background: linear-gradient(135deg, #f59e0b, #f97316);
		color: white;
		font-weight: 700;
		font-size: 1.125rem;
		border: none;
		margin-top: var(--sp-sm);
		animation: fade-in 0.5s ease-out 1.6s both;
		cursor: pointer;
	}

	.levelup-btn:active {
		transform: scale(0.97);
	}
</style>
