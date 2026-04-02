<script lang="ts">
import { enhance } from '$app/forms';
import { soundService } from '$lib/ui/sound';

interface StampEntry {
	slot: number;
	emoji: string;
	name: string;
	rarity: string;
	omikujiRank?: string | null;
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

let stamping = $state(false);
let newStamp = $state<{ omikujiRank: string; slot: number } | null>(null);
let redeemResult = $state<{ points: number } | null>(null);

/** おみくじランク別のスタンプ画像とスタイル */
const rankConfig: Record<string, { image: string; label: string; glow?: string }> = {
	大大吉: {
		image: '/assets/stamps/daidaikichi.png',
		label: '大大吉',
		glow: '0 0 10px rgba(212, 160, 23, 0.5)',
	},
	大吉: {
		image: '/assets/stamps/daikichi.png',
		label: '大吉',
		glow: '0 0 8px rgba(124, 58, 237, 0.3)',
	},
	中吉: { image: '/assets/stamps/chukichi.png', label: '中吉' },
	小吉: { image: '/assets/stamps/shokichi.png', label: '小吉' },
	吉: { image: '/assets/stamps/kichi.png', label: '吉' },
	末吉: { image: '/assets/stamps/suekichi.png', label: '末吉' },
};

function formatDateShort(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00`);
	return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getConfig(rank: string) {
	return rankConfig[rank] ?? rankConfig.吉;
}
</script>

<div class="stamp-card" data-testid="stamp-card">
	<!-- Stamp slots -->
	<div class="stamp-card__slots">
		{#each Array(totalSlots) as _, i}
			{@const entry = entries.find((e) => e.slot === i + 1)}
			{@const rank = entry?.omikujiRank ?? (entry ? '吉' : null)}
			{@const config = rank ? getConfig(rank) : null}
			{@const isNew = newStamp && newStamp.slot === i + 1}
			<div class="stamp-slot" class:stamp-slot--new={isNew}>
				{#if entry && config}
					<!-- 押印済み: イラストスタンプ -->
					<div
						class="stamp-seal"
						class:stamp-seal--rare={rank === '大大吉' || rank === '大吉'}
						style:filter={config.glow ? `drop-shadow(${config.glow})` : undefined}
					>
						<img
							src={config.image}
							alt={config.label}
							class="stamp-seal__img"
							width="48"
							height="48"
						/>
					</div>
				{:else}
					<!-- 空スロット -->
					<div class="stamp-empty">
						<div class="stamp-empty__circle"></div>
					</div>
				{/if}
				<span class="stamp-slot__day">{i + 1}</span>
			</div>
		{/each}
	</div>

	<!-- Progress -->
	<div class="stamp-card__progress">
		<span class="stamp-card__period">{formatDateShort(weekStart)}〜{formatDateShort(weekEnd)}</span>
		<div class="stamp-card__progress-right">
			<div class="stamp-card__progress-bar">
				<div class="stamp-card__progress-fill" style:width="{(filledSlots / totalSlots) * 100}%"></div>
			</div>
			<span class="stamp-card__progress-text">{filledSlots}/{totalSlots} おしたよ！</span>
		</div>
	</div>

	<!-- Action area -->
	{#if status === 'redeemed' && redeemedPoints != null}
		<div class="stamp-card__action">
			<p class="stamp-card__result stamp-card__result--redeemed">✅ {redeemedPoints}pt もらったよ！</p>
		</div>
	{:else if redeemResult}
		<div class="stamp-card__action">
			<p class="stamp-card__result stamp-card__result--got">🎉 {redeemResult.points}pt ゲット！</p>
		</div>
	{:else if newStamp}
		<div class="stamp-card__action stamp-card__action--bounce">
			<p class="stamp-card__result">
				{newStamp.omikujiRank}のスタンプをおしたよ！
			</p>
		</div>
	{:else if canStampToday}
		<form
			method="POST"
			action="?/stampCard"
			use:enhance={() => {
				stamping = true;
				return async ({ result, update }) => {
					stamping = false;
					if (result.type === 'success' && result.data) {
						const data = result.data as Record<string, unknown>;
						const omikujiRank = (data.omikujiRank as string) || (data.stampName as string) || '吉';
						newStamp = { omikujiRank, slot: filledSlots + 1 };
						soundService.play('stamp-press');
						setTimeout(() => { newStamp = null; }, 3000);
					}
					await update({ reset: false });
				};
			}}
		>
			<button
				type="submit"
				class="stamp-card__btn"
				data-testid="stamp-today-btn"
				disabled={stamping}
			>
				{stamping ? 'おしています...' : '📿 きょうのスタンプをおす！'}
			</button>
		</form>
		<p class="stamp-card__hint">あと{totalSlots - filledSlots}かいおせるよ！</p>
	{:else if filledSlots > 0 && status === 'collecting'}
		<form
			method="POST"
			action="?/redeemStampCard"
			use:enhance={() => {
				return async ({ result, update }) => {
					if (result.type === 'success' && result.data) {
						const data = result.data as Record<string, unknown>;
						redeemResult = { points: data.totalPoints as number };
						soundService.play('point-gain');
					}
					await update({ reset: false });
				};
			}}
		>
			<button type="submit" class="stamp-card__btn stamp-card__btn--redeem" data-testid="stamp-redeem-btn">
				🎁 ポイントにこうかん（{filledSlots}/{totalSlots}）
			</button>
		</form>
	{:else}
		<p class="stamp-card__done">✅ きょうはもうおしたよ！</p>
	{/if}

	<!-- Complete bonus or hint -->
	{#if filledSlots >= totalSlots && status === 'collecting' && !redeemResult}
		<div class="stamp-card__complete" data-testid="stamp-complete">
			<p class="stamp-card__complete-text">🎊 コンプリート！ 🎊</p>
			<p class="stamp-card__complete-sub">ボーナスポイントをもらおう！</p>
		</div>
	{:else if filledSlots < totalSlots && status === 'collecting' && !redeemResult}
		<p class="stamp-card__bonus-hint">{totalSlots}つあつめると ⭐ボーナスポイント！</p>
	{/if}
</div>

<style>
	.stamp-card__period {
		font-size: 0.625rem;
		color: var(--color-text-muted, #9ca3af);
		white-space: nowrap;
	}

	/* Stamp slots grid */
	.stamp-card__slots {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 6px;
		margin-bottom: 10px;
	}

	.stamp-slot {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
	}

	.stamp-slot__day {
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--color-text-muted, #9ca3af);
	}

	/* Stamp image */
	.stamp-seal {
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
	}

	.stamp-seal__img {
		width: 48px;
		height: 48px;
		object-fit: contain;
	}

	.stamp-seal--rare .stamp-seal__img {
		width: 52px;
		height: 52px;
	}

	/* Empty slot */
	.stamp-empty {
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.stamp-empty__circle {
		width: 42px;
		height: 42px;
		border-radius: 50%;
		border: 2px dashed #d1d5db;
		background: var(--gray-50, #f8fafc);
	}

	/* New stamp animation */
	.stamp-slot--new .stamp-seal {
		animation: seal-stamp 0.5s ease-out;
	}

	@keyframes seal-stamp {
		0% { transform: scale(0) rotate(-20deg); opacity: 0; }
		50% { transform: scale(1.3) rotate(5deg); }
		70% { transform: scale(0.95) rotate(-2deg); }
		100% { transform: scale(1) rotate(0deg); opacity: 1; }
	}

	/* Progress bar */
	.stamp-card__progress {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}

	.stamp-card__progress-right {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 0;
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

	/* Action buttons */
	.stamp-card__action {
		text-align: center;
		padding: 4px 0;
	}

	.stamp-card__action--bounce {
		animation: bounce-in 0.4s ease-out;
	}

	@keyframes bounce-in {
		0% { transform: scale(0.8); opacity: 0; }
		60% { transform: scale(1.05); }
		100% { transform: scale(1); opacity: 1; }
	}

	.stamp-card__result {
		font-size: 0.8125rem;
		font-weight: 700;
		margin: 0;
		color: var(--color-text, #1f2937);
	}

	.stamp-card__result--redeemed {
		color: var(--color-point, #d97706);
		font-size: 0.75rem;
	}

	.stamp-card__result--got {
		color: var(--color-point, #d97706);
		font-size: 0.875rem;
	}

	.stamp-card__btn {
		width: 100%;
		padding: 8px;
		border-radius: var(--radius-md, 12px);
		font-size: 0.8125rem;
		font-weight: 700;
		color: white;
		border: none;
		cursor: pointer;
		background: linear-gradient(135deg, var(--theme-accent, #f59e0b), var(--theme-sub, #fbbf24));
	}

	.stamp-card__btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.stamp-card__btn--redeem {
		background: none;
		border: 2px solid var(--theme-accent, #f59e0b);
		color: var(--theme-accent, #f59e0b);
	}

	.stamp-card__hint {
		text-align: center;
		font-size: 0.625rem;
		color: var(--color-text-muted, #9ca3af);
		margin: 4px 0 0;
	}

	.stamp-card__done {
		text-align: center;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--theme-accent, #f59e0b);
		margin: 0;
	}

	.stamp-card__bonus-hint {
		text-align: center;
		font-size: 0.625rem;
		font-weight: 600;
		color: #92400e;
		margin: 6px 0 0;
	}

	/* Complete celebration */
	.stamp-card__complete {
		text-align: center;
		padding: 8px 0 4px;
		animation: bounce-in 0.4s ease-out;
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
</style>
