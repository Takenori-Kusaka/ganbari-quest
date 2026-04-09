<script lang="ts">
import BirthdayModal from '$lib/features/birthday/BirthdayModal.svelte';
import LevelUpOverlay from '$lib/ui/components/LevelUpOverlay.svelte';
import SpecialRewardOverlay from '$lib/ui/components/SpecialRewardOverlay.svelte';
import StampPressOverlay from '$lib/ui/components/StampPressOverlay.svelte';

interface StampCardEntry {
	slot: number;
	emoji: string;
	rarity: string;
	omikujiRank: string | null;
}

interface StampPressData {
	stampEmoji: string;
	stampRarity: string;
	stampName: string;
	stampOmikujiRank: string | null;
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
</script>

<!-- Level up overlay -->
{#if levelUpData}
	<LevelUpOverlay
		bind:open={levelUpOpen}
		levelUp={levelUpData}
		onClose={onLevelUpClose}
	/>
{/if}

<!-- Special reward overlay -->
{#if latestReward}
	<SpecialRewardOverlay
		bind:open={rewardOpen}
		title={latestReward.title}
		points={latestReward.points}
		icon={latestReward.icon}
		onClose={onRewardClose}
	/>
{/if}

<!-- Stamp press overlay -->
{#if stampPressData}
	<StampPressOverlay
		bind:open={stampPressOpen}
		stampEmoji={stampPressData.stampEmoji}
		stampRarity={stampPressData.stampRarity}
		stampName={stampPressData.stampName}
		stampOmikujiRank={stampPressData.stampOmikujiRank}
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
{#if birthdayBonus}
	<BirthdayModal
		bind:open={birthdayModalOpen}
		{nickname}
		newAge={birthdayBonus.newAge ?? 0}
		totalPoints={birthdayBonus.totalPoints ?? 0}
		{uiMode}
	/>
{/if}
