<script lang="ts">
interface Tier {
	name: string;
	months: number;
	titleUnlock: string | null;
	unlocked: boolean;
}

interface Props {
	subscriptionMonths: number;
	memoryTickets: number;
	currentTierName: string;
	nextTierMonths: number | null;
	nextTierRemaining: number | null;
	tiers: Tier[];
	loginBonusMultiplier: number;
}

let {
	subscriptionMonths,
	memoryTickets,
	currentTierName,
	nextTierMonths,
	nextTierRemaining,
	tiers,
	loginBonusMultiplier,
}: Props = $props();

const tierIcons: Record<number, string> = {
	1: '🥉',
	3: '🥈',
	6: '🥇',
	12: '🏅',
	24: '👑',
};

const progressPct = $derived(
	nextTierMonths ? Math.min(100, Math.round((subscriptionMonths / nextTierMonths) * 100)) : 100,
);
</script>

{#if subscriptionMonths > 0}
	<div class="rounded-xl border bg-[var(--color-surface-card)] p-4 space-y-3">
		<div class="flex items-center gap-2">
			<span class="text-xl">🎖️</span>
			<div>
				<h3 class="font-bold text-sm">サポーターバッジ</h3>
				<p class="text-xs text-[var(--color-text-muted)]">プレミアム継続: {subscriptionMonths}ヶ月目</p>
			</div>
		</div>

		<!-- Tier badges -->
		<div class="flex gap-2 flex-wrap">
			{#each tiers as tier (tier.months)}
				<div
					class="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold {tier.unlocked
						? 'bg-[var(--color-feedback-warning-bg)] text-[var(--color-feedback-warning-text)] border border-[var(--color-feedback-warning-border)]'
						: 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] border border-[var(--color-border-default)]'}"
				>
					<span>{tier.unlocked ? (tierIcons[tier.months] ?? '🎖️') : '🔒'}</span>
					{tier.months}ヶ月
				</div>
			{/each}
		</div>

		<!-- Progress to next tier -->
		{#if nextTierMonths && nextTierRemaining}
			<div>
				<p class="text-xs text-[var(--color-text-muted)]">
					次のバッジまで: あと{nextTierRemaining}ヶ月
				</p>
				<div class="mt-1 h-2 rounded-full bg-[var(--color-surface-muted-strong)] overflow-hidden">
					<div
						class="h-full rounded-full bg-[var(--color-gold-400)] transition-all"
						style:width="{progressPct}%"
					></div>
				</div>
				<p class="text-[10px] text-[var(--color-text-muted)] mt-0.5 text-right">
					{subscriptionMonths}/{nextTierMonths}
				</p>
			</div>
		{:else}
			<p class="text-xs text-[var(--color-feedback-warning-text)] font-bold">🏆 全ティア到達！</p>
		{/if}

		<!-- Stats -->
		<div class="flex gap-4 text-xs">
			{#if memoryTickets > 0}
				<div class="flex items-center gap-1">
					<span>🎫</span>
					<span class="font-bold">思い出チケット: {memoryTickets}枚</span>
				</div>
			{/if}
			{#if loginBonusMultiplier > 1}
				<div class="flex items-center gap-1">
					<span>⭐</span>
					<span class="font-bold">ログインボーナス ×{loginBonusMultiplier}</span>
				</div>
			{/if}
		</div>
	</div>
{/if}
