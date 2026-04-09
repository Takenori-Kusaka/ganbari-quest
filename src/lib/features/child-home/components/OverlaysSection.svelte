<script lang="ts">
import { untrack } from 'svelte';
import BirthdayModal from '$lib/features/birthday/BirthdayModal.svelte';
import LevelUpOverlay from '$lib/ui/components/LevelUpOverlay.svelte';
import SpecialRewardOverlay from '$lib/ui/components/SpecialRewardOverlay.svelte';
import StampPressOverlay from '$lib/ui/components/StampPressOverlay.svelte';

interface StampCardEntry {
	slot: number;
	emoji: string;
	rarity: string;
}

interface StampPressData {
	stampEmoji: string;
	stampRarity: string;
	stampName: string;
	instantPoints: number;
	consecutiveDays: number;
	multiplier: number;
	cardFilledSlots: number;
	cardTotalSlots: number;
	cardEntries: StampCardEntry[];
	weeklyRedeem: {
		points: number;
		filledSlots: number;
		totalSlots: number;
		completeBonus: number;
	} | null;
}

interface LatestReward {
	title: string;
	points: number;
	icon: string | null;
}

interface BirthdayBonus {
	newAge: number | null;
	totalPoints: number | null;
}

interface LevelUpData {
	oldLevel: number;
	oldTitle: string;
	newLevel: number;
	newTitle: string;
	categoryId?: number;
	categoryName?: string;
	spGranted?: number;
}

interface Props {
	levelUpOpen: boolean;
	levelUpData: LevelUpData | null;
	onLevelUpClose: () => void;
	rewardOpen: boolean;
	latestReward: LatestReward | null;
	onRewardClose: () => void;
	stampPressOpen: boolean;
	stampPressData: StampPressData | null;
	onStampPressClose: () => void;
	birthdayModalOpen: boolean;
	birthdayBonus: BirthdayBonus | null;
	nickname: string;
	uiMode: string;
}

let {
	levelUpOpen = $bindable(),
	levelUpData,
	onLevelUpClose,
	rewardOpen = $bindable(),
	latestReward,
	onRewardClose,
	stampPressOpen = $bindable(),
	stampPressData,
	onStampPressClose,
	birthdayModalOpen = $bindable(),
	birthdayBonus,
	nickname,
	uiMode,
}: Props = $props();

// --- Dialog queue: show only one overlay at a time (#611) ---
type OverlayType = 'stampPress' | 'levelUp' | 'reward' | 'birthday';
let queue = $state<OverlayType[]>([]);
let activeOverlay = $derived<OverlayType | null>(queue[0] ?? null);

function enqueueOverlay(type: OverlayType) {
	if (!queue.includes(type)) {
		queue = [...queue, type];
	}
}

function dequeueOverlay(type: OverlayType) {
	if (queue.includes(type)) {
		queue = queue.filter((t) => t !== type);
	}
}

// Enqueue/dequeue based on parent prop changes
$effect(() => {
	if (stampPressOpen && stampPressData) {
		untrack(() => enqueueOverlay('stampPress'));
	} else if (!stampPressOpen) {
		untrack(() => dequeueOverlay('stampPress'));
	}
});

$effect(() => {
	if (levelUpOpen && levelUpData) {
		untrack(() => enqueueOverlay('levelUp'));
	} else if (!levelUpOpen) {
		untrack(() => dequeueOverlay('levelUp'));
	}
});

$effect(() => {
	if (rewardOpen && latestReward) {
		untrack(() => enqueueOverlay('reward'));
	} else if (!rewardOpen) {
		untrack(() => dequeueOverlay('reward'));
	}
});

$effect(() => {
	if (birthdayModalOpen && birthdayBonus) {
		untrack(() => enqueueOverlay('birthday'));
	} else if (!birthdayModalOpen) {
		untrack(() => dequeueOverlay('birthday'));
	}
});
</script>

<!-- Level up overlay — only render when active in queue -->
{#if levelUpData && activeOverlay === 'levelUp'}
	<LevelUpOverlay
		bind:open={levelUpOpen}
		levelUp={levelUpData}
		onClose={onLevelUpClose}
	/>
{/if}

<!-- Special reward overlay -->
{#if latestReward && activeOverlay === 'reward'}
	<SpecialRewardOverlay
		bind:open={rewardOpen}
		title={latestReward.title}
		points={latestReward.points}
		icon={latestReward.icon}
		onClose={onRewardClose}
	/>
{/if}

<!-- Stamp press overlay -->
{#if stampPressData && activeOverlay === 'stampPress'}
	<StampPressOverlay
		bind:open={stampPressOpen}
		stampEmoji={stampPressData.stampEmoji}
		stampRarity={stampPressData.stampRarity}
		stampName={stampPressData.stampName}
		instantPoints={stampPressData.instantPoints}
		consecutiveDays={stampPressData.consecutiveDays}
		multiplier={stampPressData.multiplier}
		cardFilledSlots={stampPressData.cardFilledSlots}
		cardTotalSlots={stampPressData.cardTotalSlots}
		cardEntries={stampPressData.cardEntries}
		weeklyRedeem={stampPressData.weeklyRedeem}
		onClose={onStampPressClose}
	/>
{/if}

<!-- Birthday bonus modal -->
{#if birthdayBonus && activeOverlay === 'birthday'}
	<BirthdayModal
		bind:open={birthdayModalOpen}
		{nickname}
		newAge={birthdayBonus.newAge ?? 0}
		totalPoints={birthdayBonus.totalPoints ?? 0}
		{uiMode}
	/>
{/if}
