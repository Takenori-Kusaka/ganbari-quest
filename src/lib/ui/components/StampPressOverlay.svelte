<script lang="ts">
import { getStampImagePathForEntry } from '$lib/domain/stamp-image';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import { soundService } from '$lib/ui/sound';

interface StampCardEntry {
	slot: number;
	emoji: string;
	rarity: string;
	omikujiRank: string | null;
}

interface Props {
	open: boolean;
	stampRarity: string;
	stampName: string;
	stampOmikujiRank: string | null;
	instantPoints: number;
	consecutiveDays: number;
	multiplier: number;
	/** Current card data after stamping */
	cardFilledSlots: number;
	cardTotalSlots: number;
	cardEntries: StampCardEntry[];
	/** Weekly redeem result (if previous week was auto-redeemed) */
	weeklyRedeem: {
		points: number;
		filledSlots: number;
		totalSlots: number;
		completeBonus: number;
	} | null;
	onClose?: () => void;
}

let {
	open = $bindable(),
	stampRarity,
	stampName,
	stampOmikujiRank,
	instantPoints,
	consecutiveDays,
	multiplier,
	cardFilledSlots,
	cardTotalSlots,
	cardEntries,
	weeklyRedeem,
	onClose,
}: Props = $props();

type Phase = 'card' | 'press' | 'points' | 'weekly';
let phase = $state<Phase>('card');

const rarityConfig: Record<string, { glow: string; particles: string[]; tier: number }> = {
	N: { glow: 'none', particles: [], tier: 0 },
	R: { glow: '0 0 15px rgba(59, 130, 246, 0.4)', particles: ['💙', '✨'], tier: 1 },
	SR: { glow: '0 0 20px rgba(147, 51, 234, 0.5)', particles: ['💜', '✨', '🌟'], tier: 2 },
	UR: { glow: '0 0 30px rgba(255, 215, 0, 0.6)', particles: ['🌟', '✨', '💫', '🎊'], tier: 3 },
};

const defaultConfig = { glow: 'none', particles: [] as string[], tier: 0 };
const config = $derived(rarityConfig[stampRarity] ?? defaultConfig);
const isComplete = $derived(cardFilledSlots >= cardTotalSlots);
const remaining = $derived(cardTotalSlots - cardFilledSlots);
const stampImageSrc = $derived(getStampImagePathForEntry(stampOmikujiRank, stampRarity));

$effect(() => {
	if (open) {
		phase = 'card';
		soundService.play('stamp-press');

		const t1 = setTimeout(() => {
			phase = 'press';
			if (config.tier >= 2) {
				soundService.play('special-reward');
			}
		}, 400);

		const t2 = setTimeout(() => {
			phase = 'points';
			soundService.play('point-gain');
		}, 1200);

		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
		};
	}
});

function handleClose() {
	if (weeklyRedeem && phase !== 'weekly') {
		phase = 'weekly';
		return;
	}
	open = false;
	onClose?.();
}
</script>

<Dialog bind:open closable={false} ariaLabel="スタンプ">
	<div class="sp" data-testid="stamp-press-overlay">
		{#if phase === 'card' || phase === 'press' || phase === 'points'}
			<!-- Stamp card mini display -->
			<p class="sp__week-label">今週 {cardFilledSlots}回目！</p>

			<div class="sp__card-slots">
				{#each Array(cardTotalSlots) as _, i}
					{@const entry = cardEntries.find((e) => e.slot === i + 1)}
					{@const isToday = i + 1 === cardFilledSlots}
					<div class="sp__slot" class:sp__slot--today={isToday && phase === 'card'}>
						{#if entry && !(isToday && phase === 'card')}
							<img src={getStampImagePathForEntry(entry.omikujiRank, entry.rarity)} alt="" class="sp__slot-img" />
						{:else if isToday && (phase === 'press' || phase === 'points')}
							<img
								src={stampImageSrc}
								alt={stampName}
								class="sp__slot-img sp__slot-img--new"
								style:filter={config.glow !== 'none' ? `drop-shadow(${config.glow})` : undefined}
							/>
						{:else}
							<span class="sp__slot-empty"></span>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Press animation -->
			{#if phase === 'press' || phase === 'points'}
				<div class="sp__press-area">
					<div class="sp__stamp-icon" style:box-shadow={config.glow}>
						<img src={stampImageSrc} alt={stampName} class="sp__stamp-main-img" />
					</div>
					{#if config.tier >= 2}
						<div class="sp__particles">
							{#each config.particles as p, i}
								{#each Array(3) as _, j}
									<span class="sp__particle" style:--pi={i * 3 + j}>{p}</span>
								{/each}
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Points display -->
			{#if phase === 'points'}
				<div class="sp__points-section">
					<p class="sp__points-value">+{instantPoints}pt</p>
					{#if consecutiveDays >= 2}
						<p class="sp__streak">{consecutiveDays}にちれんぞく！
							{#if multiplier > 1}
								<span class="sp__streak-bonus">×{multiplier}</span>
							{/if}
						</p>
					{/if}

					{#if isComplete}
						<div class="sp__complete">
							<p class="sp__complete-text">コンプリート！</p>
							<p class="sp__complete-sub">週末にボーナスポイント！</p>
						</div>
					{:else}
						<p class="sp__remaining">あと{remaining}回でコンプリート！</p>
					{/if}

					<button class="sp__close tap-target" data-testid="login-bonus-confirm" onclick={handleClose}>
						{weeklyRedeem ? 'つぎへ' : 'やったね！'}
					</button>
				</div>
			{/if}

		{:else if phase === 'weekly'}
			<!-- Weekly redeem ceremony -->
			<div class="sp__weekly">
				<p class="sp__weekly-title">先週のがんばり</p>
				<div class="sp__weekly-card">
					<p class="sp__weekly-count">{weeklyRedeem?.filledSlots}/{weeklyRedeem?.totalSlots} おしたよ！</p>
					{#if weeklyRedeem && weeklyRedeem.filledSlots >= (weeklyRedeem.totalSlots)}
						<p class="sp__weekly-complete">コンプリート！</p>
					{/if}
				</div>

				<div class="sp__weekly-points">
					<p class="sp__points-value sp__points-value--big">+{weeklyRedeem?.points ?? 0}pt</p>
					{#if weeklyRedeem?.completeBonus}
						<p class="sp__weekly-bonus">コンプリートボーナス +{weeklyRedeem.completeBonus}pt</p>
					{/if}
				</div>

				<p class="sp__weekly-message">今週もがんばろう！</p>

				<button class="sp__close tap-target" data-testid="weekly-redeem-confirm" onclick={handleClose}>
					やったね！
				</button>
			</div>
		{/if}
	</div>
</Dialog>

<style>
	.sp {
		text-align: center;
		padding: var(--sp-sm, 8px) 0;
		min-height: 280px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}

	.sp__week-label {
		font-size: 1rem;
		font-weight: 800;
		color: var(--color-text, #1f2937);
		margin: 0;
	}

	/* Card slots (5 horizontal) */
	.sp__card-slots {
		display: flex;
		gap: 6px;
		justify-content: center;
	}

	.sp__slot {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		width: 40px;
	}

	.sp__slot--today {
		animation: pulse-slot 1s ease-in-out infinite;
	}

	.sp__slot-stamp {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
	}

	.sp__slot-img {
		width: 36px;
		height: 36px;
		object-fit: contain;
	}

	.sp__slot-img--new {
		animation: stamp-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
	}

	.sp__slot-empty {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 2px dashed var(--color-text-muted);
		background: var(--color-surface-muted);
	}

	/* Press area */
	.sp__press-area {
		position: relative;
		width: 80px;
		height: 80px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.sp__stamp-icon {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: var(--color-surface-card, #fff);
		border: 3px solid var(--theme-accent, #f59e0b);
		display: flex;
		align-items: center;
		justify-content: center;
		animation: stamp-press-main 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
	}

	.sp__stamp-main-img {
		width: 56px;
		height: 56px;
		object-fit: contain;
	}

	.sp__particles {
		position: absolute;
		inset: -20px;
		pointer-events: none;
	}

	.sp__particle {
		position: absolute;
		font-size: 1rem;
		animation: particle-burst 1.5s ease-out forwards;
		animation-delay: calc(var(--pi) * 0.08s);
		left: 50%;
		top: 50%;
	}

	/* Points section */
	.sp__points-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		animation: fade-in 0.3s ease-out;
	}

	.sp__points-value {
		font-size: 1.5rem;
		font-weight: 900;
		color: var(--color-point, #d97706);
		margin: 0;
		animation: point-pop 0.4s ease-out;
	}

	.sp__points-value--big {
		font-size: 2rem;
	}

	.sp__streak {
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--color-text, #1f2937);
		margin: 0;
	}

	.sp__streak-bonus {
		color: var(--theme-accent, #f59e0b);
	}

	.sp__remaining {
		font-size: 0.75rem;
		color: var(--color-text-muted, #9ca3af);
		margin: 0;
	}

	.sp__complete {
		text-align: center;
		animation: bounce-in 0.4s ease-out;
	}

	.sp__complete-text {
		font-size: 1.125rem;
		font-weight: 900;
		color: var(--theme-accent, #f59e0b);
		margin: 0;
	}

	.sp__complete-sub {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		margin: 2px 0 0;
	}

	.sp__close {
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

	/* Weekly ceremony */
	.sp__weekly {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		animation: fade-in 0.3s ease-out;
	}

	.sp__weekly-title {
		font-size: 1.125rem;
		font-weight: 800;
		color: var(--color-text, #1f2937);
		margin: 0;
	}

	.sp__weekly-card {
		padding: 12px 24px;
		background: var(--color-surface-muted, #f8fafc);
		border-radius: var(--radius-md, 12px);
	}

	.sp__weekly-count {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text, #1f2937);
		margin: 0;
	}

	.sp__weekly-complete {
		font-size: 0.875rem;
		font-weight: 900;
		color: var(--theme-accent, #f59e0b);
		margin: 4px 0 0;
	}

	.sp__weekly-points {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.sp__weekly-bonus {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--theme-accent, #f59e0b);
		margin: 0;
	}

	.sp__weekly-message {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text, #1f2937);
		margin: 0;
	}

	/* Animations */
	@keyframes pulse-slot {
		0%, 100% { transform: scale(1); opacity: 1; }
		50% { transform: scale(1.1); opacity: 0.7; }
	}

	@keyframes stamp-bounce {
		0% { transform: scale(0) translateY(-20px); opacity: 0; }
		40% { transform: scale(1.3) translateY(0); opacity: 1; }
		60% { transform: scale(0.95); }
		100% { transform: scale(1); }
	}

	@keyframes stamp-press-main {
		0% { transform: scale(2) rotate(-15deg); opacity: 0; }
		40% { transform: scale(0.9) rotate(2deg); opacity: 1; }
		60% { transform: scale(1.05) rotate(-1deg); }
		100% { transform: scale(1) rotate(0deg); }
	}

	@keyframes particle-burst {
		0% { transform: translate(0, 0) scale(0); opacity: 0; }
		20% { opacity: 1; transform: scale(1); }
		100% {
			transform: translate(calc((var(--pi) - 5) * 20px), calc((var(--pi) - 4) * 18px)) scale(0.3);
			opacity: 0;
		}
	}

	@keyframes fade-in {
		from { opacity: 0; transform: scale(0.9); }
		to { opacity: 1; transform: scale(1); }
	}

	@keyframes point-pop {
		0% { transform: scale(0.5); opacity: 0; }
		60% { transform: scale(1.2); }
		100% { transform: scale(1); opacity: 1; }
	}

	@keyframes bounce-in {
		0% { transform: scale(0.8); opacity: 0; }
		60% { transform: scale(1.05); }
		100% { transform: scale(1); opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.sp__slot--today,
		.sp__slot-img--new,
		.sp__stamp-icon,
		.sp__particle {
			animation: none;
		}
	}
</style>
