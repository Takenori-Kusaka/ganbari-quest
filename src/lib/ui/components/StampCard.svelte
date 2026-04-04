<script lang="ts">
interface StampEntry {
	slot: number;
	emoji: string;
	name: string;
	rarity: string;
}

interface Props {
	weekStart: string;
	weekEnd: string;
	entries: StampEntry[];
	canStampToday: boolean;
	totalSlots: number;
	filledSlots: number;
	status: string;
	redeemedPoints: number | null;
}

let {
	weekStart,
	weekEnd,
	entries,
	canStampToday,
	totalSlots,
	filledSlots,
	status,
	redeemedPoints,
}: Props = $props();

const dayLabels = ['月', '火', '水', '木', '金', '土', '日'];

const rarityGlow: Record<string, string | undefined> = {
	SR: '0 0 8px rgba(147, 51, 234, 0.3)',
	UR: '0 0 10px rgba(255, 215, 0, 0.5)',
};

function formatDateShort(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00`);
	return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Determine if a slot is "today" — the first empty slot if card is collecting */
function isTodaySlot(slotIndex: number): boolean {
	if (status !== 'collecting') return false;
	return slotIndex + 1 === filledSlots + 1 && canStampToday;
}
</script>

<div class="stamp-card" data-testid="stamp-card">
	<!-- Header -->
	<div class="stamp-card__header">
		<span class="stamp-card__period">📅 {formatDateShort(weekStart)}〜{formatDateShort(weekEnd)}</span>
		<span class="stamp-card__label">今週のスタンプ</span>
	</div>

	<!-- 7 Stamp slots with day labels -->
	<div class="stamp-card__slots">
		{#each Array(totalSlots) as _, i}
			{@const entry = entries.find((e) => e.slot === i + 1)}
			{@const glow = entry ? rarityGlow[entry.rarity] : undefined}
			{@const isToday = isTodaySlot(i)}
			<div class="stamp-slot" class:stamp-slot--today={isToday}>
				{#if entry}
					<span class="stamp-slot__emoji" style:filter={glow ? `drop-shadow(${glow})` : undefined}>
						{entry.emoji}
					</span>
				{:else}
					<span class="stamp-slot__empty"></span>
				{/if}
				<span class="stamp-slot__day">{dayLabels[i] ?? i + 1}</span>
			</div>
		{/each}
	</div>

	<!-- Progress bar -->
	<div class="stamp-card__progress">
		<div class="stamp-card__progress-bar">
			<div class="stamp-card__progress-fill" style:width="{(filledSlots / totalSlots) * 100}%"></div>
		</div>
		<span class="stamp-card__progress-text">{filledSlots}/{totalSlots} おしたよ！</span>
	</div>

	<!-- Status message -->
	{#if status === 'redeemed' && redeemedPoints != null}
		<p class="stamp-card__done">✅ {redeemedPoints}pt もらったよ！</p>
	{:else if filledSlots >= totalSlots && status === 'collecting'}
		<div class="stamp-card__complete" data-testid="stamp-complete">
			<p class="stamp-card__complete-text">🎊 コンプリート！</p>
			<p class="stamp-card__complete-sub">週明けにボーナスポイントがもらえるよ！</p>
		</div>
	{:else if !canStampToday && status === 'collecting'}
		<p class="stamp-card__done">✅ きょうはもうおしたよ！</p>
	{:else if canStampToday}
		<p class="stamp-card__hint">✨ あと{totalSlots - filledSlots}回でコンプリート！</p>
	{/if}
</div>

<style>
	/* Header */
	.stamp-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.stamp-card__period {
		font-size: 0.625rem;
		color: var(--color-text-muted, #9ca3af);
		white-space: nowrap;
	}

	.stamp-card__label {
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--color-text-muted, #9ca3af);
	}

	/* 7-column stamp slots */
	.stamp-card__slots {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 4px;
		margin-bottom: 8px;
	}

	.stamp-slot {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.stamp-slot--today .stamp-slot__empty {
		animation: pulse-today 1.2s ease-in-out infinite;
		border-color: var(--theme-accent, #f59e0b);
	}

	.stamp-slot__emoji {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
	}

	.stamp-slot__empty {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: 2px dashed #d1d5db;
		background: var(--gray-50, #f8fafc);
	}

	.stamp-slot__day {
		font-size: 0.5625rem;
		font-weight: 700;
		color: var(--color-text-muted, #9ca3af);
	}

	/* Progress bar */
	.stamp-card__progress {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
	}

	.stamp-card__progress-bar {
		flex: 1;
		height: 6px;
		background: #e5e7eb;
		border-radius: 3px;
		overflow: hidden;
	}

	.stamp-card__progress-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--theme-accent, #f59e0b), var(--theme-sub, #fbbf24));
		border-radius: 3px;
		transition: width 0.5s ease;
	}

	.stamp-card__progress-text {
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--color-text-muted, #9ca3af);
		white-space: nowrap;
	}

	/* Status messages */
	.stamp-card__hint {
		text-align: center;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-text-muted, #9ca3af);
		margin: 0;
	}

	.stamp-card__done {
		text-align: center;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--theme-accent, #f59e0b);
		margin: 0;
	}

	/* Complete celebration */
	.stamp-card__complete {
		text-align: center;
		padding: 4px 0;
	}

	.stamp-card__complete-text {
		font-size: 1rem;
		font-weight: 900;
		color: var(--theme-accent, #f59e0b);
		margin: 0;
	}

	.stamp-card__complete-sub {
		font-size: 0.6875rem;
		font-weight: 600;
		color: #92400e;
		margin: 2px 0 0;
	}

	/* Animations */
	@keyframes pulse-today {
		0%, 100% { transform: scale(1); opacity: 1; }
		50% { transform: scale(1.15); opacity: 0.7; }
	}

	@media (prefers-reduced-motion: reduce) {
		.stamp-slot--today .stamp-slot__empty {
			animation: none;
		}
	}
</style>
