<script lang="ts">
import { enhance } from '$app/forms';
import { soundService } from '$lib/ui/sound';

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

let stamping = $state(false);
let newStamp = $state<{ emoji: string; rarity: string; name: string } | null>(null);
let redeemResult = $state<{ points: number } | null>(null);

const rarityColors: Record<string, string> = {
	N: '#9ca3af',
	R: '#3b82f6',
	SR: '#a855f7',
	UR: '#f59e0b',
};

const rarityLabels: Record<string, string> = {
	N: 'N',
	R: 'R',
	SR: 'SR',
	UR: 'UR',
};

function formatDateShort(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00`);
	return `${d.getMonth() + 1}/${d.getDate()}`;
}
</script>

<div class="bg-white rounded-[var(--radius-md)] p-[var(--sp-md)] shadow-sm" data-testid="stamp-card">
	<div class="flex items-center justify-between mb-[var(--sp-sm)]">
		<h3 class="text-sm font-bold text-[var(--color-text)]">
			🎴 しゅうかんスタンプ
		</h3>
		<span class="text-[10px] text-[var(--color-text-muted)]">
			{formatDateShort(weekStart)}〜{formatDateShort(weekEnd)}
		</span>
	</div>

	<!-- スタンプスロット -->
	<div class="flex justify-center gap-2 mb-[var(--sp-sm)]">
		{#each Array(totalSlots) as _, i}
			{@const entry = entries.find((e) => e.slot === i + 1)}
			<div
				class="stamp-slot"
				class:filled={!!entry}
				class:new-stamp={newStamp && entry?.slot === filledSlots}
				style={entry ? `border-color: ${rarityColors[entry.rarity]}` : ''}
			>
				{#if entry}
					<span class="text-2xl">{entry.emoji}</span>
					<span
						class="rarity-badge"
						style="background: {rarityColors[entry.rarity]}"
					>
						{rarityLabels[entry.rarity]}
					</span>
				{:else}
					<span class="text-xl text-gray-300">?</span>
				{/if}
			</div>
		{/each}
	</div>

	<!-- アクションエリア -->
	{#if status === 'redeemed' && redeemedPoints != null}
		<div class="text-center py-1">
			<p class="text-xs font-bold text-[var(--color-point)]">
				✅ {redeemedPoints}pt もらったよ！
			</p>
		</div>
	{:else if redeemResult}
		<div class="text-center py-1">
			<p class="text-sm font-bold text-[var(--color-point)]">
				🎉 {redeemResult.points}pt ゲット！
			</p>
		</div>
	{:else if newStamp}
		<div class="text-center py-1 animate-bounce-in">
			<p class="text-sm font-bold" style="color: {rarityColors[newStamp.rarity]}">
				{newStamp.emoji} {newStamp.name}！
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
						newStamp = {
							emoji: data.stampEmoji as string,
							rarity: data.stampRarity as string,
							name: data.stampName as string,
						};
						soundService.play('special-reward');
						setTimeout(() => { newStamp = null; }, 3000);
					}
					await update({ reset: false });
				};
			}}
		>
			<button
				type="submit"
				class="w-full py-2 rounded-[var(--radius-md)] text-sm font-bold text-white"
				style="background: linear-gradient(135deg, var(--theme-accent), var(--theme-sub));"
				data-testid="stamp-today-btn"
				disabled={stamping}
			>
				{stamping ? 'おしています...' : '🎴 きょうのスタンプをおす！'}
			</button>
		</form>
		<p class="text-center text-[10px] text-[var(--color-text-muted)] mt-1">
			あと{totalSlots - filledSlots}かいおせるよ！
		</p>
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
			<button
				type="submit"
				class="w-full py-2 rounded-[var(--radius-md)] text-sm font-bold border-2"
				style="border-color: var(--theme-accent); color: var(--theme-accent);"
				data-testid="stamp-redeem-btn"
			>
				🎁 ポイントにこうかん（{filledSlots}/{totalSlots}）
			</button>
		</form>
	{:else}
		<p class="text-center text-[10px] text-[var(--color-text-muted)]">
			きょうはもうおしたよ！
		</p>
	{/if}
</div>

<style>
	.stamp-slot {
		width: 3.2rem;
		height: 3.2rem;
		border-radius: var(--radius-md);
		border: 2px dashed #d1d5db;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		position: relative;
		background: #fafafa;
		transition: all 0.3s ease;
	}

	.stamp-slot.filled {
		border-style: solid;
		background: white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.stamp-slot.new-stamp {
		animation: stamp-pop 0.5s ease-out;
	}

	@keyframes stamp-pop {
		0% { transform: scale(0); }
		60% { transform: scale(1.2); }
		100% { transform: scale(1); }
	}

	.rarity-badge {
		position: absolute;
		bottom: -4px;
		right: -4px;
		font-size: 8px;
		font-weight: 700;
		color: white;
		padding: 0 3px;
		border-radius: 4px;
		line-height: 14px;
	}
</style>
