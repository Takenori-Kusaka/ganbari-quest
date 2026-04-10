<script lang="ts">
import BirthdayModal from '$lib/features/birthday/BirthdayModal.svelte';
import type { DialogFSM } from '$lib/features/child-home/dialog-state-machine';
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
	fsm: DialogFSM;
	levelUpData: LevelUpData | null;
	onLevelUpClose: () => void;
	latestReward: LatestReward | null;
	onRewardClose: () => void;
	stampPressData: StampPressData | null;
	onStampPressClose: () => void;
	birthdayBonus: BirthdayBonus | null;
	onBirthdayClose: () => void;
	nickname: string;
	uiMode: string;
}

let {
	fsm,
	levelUpData,
	onLevelUpClose,
	latestReward,
	onRewardClose,
	stampPressData,
	onStampPressClose,
	birthdayBonus,
	onBirthdayClose,
	nickname,
	uiMode,
}: Props = $props();

// Derive open states from FSM current dialog
let levelUpOpen = $derived(fsm.current === 'levelUp');
let rewardOpen = $derived(fsm.current === 'specialReward');
let stampPressOpen = $derived(fsm.current === 'stampPress');
let birthdayModalOpen = $derived(fsm.current === 'birthday');
</script>

<!-- Level up overlay — only render when active in FSM -->
{#if levelUpData && levelUpOpen}
	<LevelUpOverlay
		open={levelUpOpen}
		levelUp={levelUpData}
		onClose={onLevelUpClose}
	/>
{/if}

<!-- Special reward overlay -->
{#if latestReward && rewardOpen}
	<SpecialRewardOverlay
		open={rewardOpen}
		title={latestReward.title}
		points={latestReward.points}
		icon={latestReward.icon}
		onClose={onRewardClose}
	/>
{/if}

<!-- Stamp press overlay -->
{#if stampPressData && stampPressOpen}
	<StampPressOverlay
		open={stampPressOpen}
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
{#if birthdayBonus && birthdayModalOpen}
	<BirthdayModal
		open={birthdayModalOpen}
		{nickname}
		newAge={birthdayBonus.newAge ?? 0}
		totalPoints={birthdayBonus.totalPoints ?? 0}
		{uiMode}
		onClose={onBirthdayClose}
	/>
{/if}
