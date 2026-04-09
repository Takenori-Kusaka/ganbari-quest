<script lang="ts">
import { getStampImagePath } from '$lib/domain/stamp-image';

interface StampEntry {
	slot: number;
	emoji: string;
	name: string;
	rarity: string;
	omikujiRank: string | null;
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

function formatDateShort(dateStr: string): string {
	const parts = dateStr.split('-');
	return `${Number(parts[1])}/${Number(parts[2])}`;
}

/** Determine if a slot is "today" — the first empty slot if card is collecting */
function isTodaySlot(slotIndex: number): boolean {
	if (status !== 'collecting') return false;
	return slotIndex + 1 === filledSlots + 1 && canStampToday;
}
</script>

<div class="stamp-card" data-testid="stamp-card">
	<!-- Card header with decorative border -->
	<div class="stamp-card__header">
		<span class="stamp-card__title">スタンプカード</span>
		<span class="stamp-card__period">{formatDateShort(weekStart)}〜{formatDateShort(weekEnd)}</span>
	</div>

	<!-- Stamp area: 3 top + 2 bottom staggered -->
	<div class="stamp-card__body">
		<div class="stamp-card__row stamp-card__row--top">
			{#each Array(3) as _, i}
				{@const entry = entries.find((e) => e.slot === i + 1)}
				{@const isToday = isTodaySlot(i)}
				<div class="stamp-slot" class:stamp-slot--today={isToday}>
					<div class="stamp-slot__circle" class:stamp-slot__circle--filled={!!entry}>
						{#if entry?.omikujiRank}
							<img
								src={getStampImagePath(entry.omikujiRank)}
								alt={entry.name}
								class="stamp-slot__img"
							/>
						{:else if entry}
							<span class="stamp-slot__emoji">{entry.emoji}</span>
						{:else}
							<span class="stamp-slot__number">{i + 1}</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
		<div class="stamp-card__row stamp-card__row--bottom">
			{#each Array(2) as _, i}
				{@const slotIdx = i + 3}
				{@const entry = entries.find((e) => e.slot === slotIdx + 1)}
				{@const isToday = isTodaySlot(slotIdx)}
				<div class="stamp-slot" class:stamp-slot--today={isToday}>
					<div class="stamp-slot__circle" class:stamp-slot__circle--filled={!!entry}>
						{#if entry?.omikujiRank}
							<img
								src={getStampImagePath(entry.omikujiRank)}
								alt={entry.name}
								class="stamp-slot__img"
							/>
						{:else if entry}
							<span class="stamp-slot__emoji">{entry.emoji}</span>
						{:else}
							<span class="stamp-slot__number">{slotIdx + 1}</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Progress -->
	<div class="stamp-card__progress">
		<div class="stamp-card__progress-bar">
			<div class="stamp-card__progress-fill" style:width="{(filledSlots / totalSlots) * 100}%"></div>
		</div>
		<span class="stamp-card__progress-text">{filledSlots}/{totalSlots}</span>
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
	.stamp-card {
		background: linear-gradient(135deg, var(--color-surface-card, #fffbeb) 0%, var(--color-surface-card, #fef3c7) 100%);
		border: 2px solid var(--theme-accent, #f59e0b);
		border-radius: 16px;
		padding: 12px;
		position: relative;
		overflow: hidden;
	}

	/* Decorative corner dots */
	.stamp-card::before,
	.stamp-card::after {
		content: '';
		position: absolute;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--theme-accent, #f59e0b);
		opacity: 0.3;
	}

	.stamp-card::before {
		top: 6px;
		left: 6px;
	}

	.stamp-card::after {
		top: 6px;
		right: 6px;
	}

	/* Header */
	.stamp-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
		padding-bottom: 6px;
		border-bottom: 1px dashed var(--theme-accent, #f59e0b);
	}

	.stamp-card__title {
		font-size: 0.75rem;
		font-weight: 800;
		color: var(--color-text, #92400e);
	}

	.stamp-card__period {
		font-size: 0.625rem;
		color: var(--color-text-muted, #9ca3af);
	}

	/* Stamp body */
	.stamp-card__body {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
	}

	.stamp-card__row {
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	/* Stamp slot */
	.stamp-slot {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.stamp-slot--today .stamp-slot__circle {
		animation: pulse-today 1.2s ease-in-out infinite;
		border-color: var(--theme-accent, #f59e0b);
		box-shadow: 0 0 8px rgba(245, 158, 11, 0.3);
	}

	.stamp-slot__circle {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		border: 2px dashed var(--color-text-muted, #d1d5db);
		background: rgba(255, 255, 255, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.3s ease;
	}

	.stamp-slot__circle--filled {
		border-style: solid;
		border-color: transparent;
		background: transparent;
	}

	.stamp-slot__img {
		width: 48px;
		height: 48px;
		object-fit: contain;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
	}

	.stamp-slot__emoji {
		font-size: 1.5rem;
	}

	.stamp-slot__number {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--color-text-muted, #d1d5db);
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
		background: rgba(0, 0, 0, 0.06);
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
		color: var(--color-text-muted, #92400e);
		margin: 2px 0 0;
	}

	/* Animations */
	@keyframes pulse-today {
		0%, 100% { transform: scale(1); opacity: 1; }
		50% { transform: scale(1.1); opacity: 0.7; }
	}

	@media (prefers-reduced-motion: reduce) {
		.stamp-slot--today .stamp-slot__circle {
			animation: none;
		}
	}
</style>
