<script lang="ts">
import BirthdayModal from '$lib/features/birthday/BirthdayModal.svelte';
import LevelUpOverlay from '$lib/ui/components/LevelUpOverlay.svelte';
import OmikujiStampOverlay from '$lib/ui/components/OmikujiStampOverlay.svelte';
import SpecialRewardOverlay from '$lib/ui/components/SpecialRewardOverlay.svelte';

interface StampPressData {
	omikujiRank: string;
	totalPoints: number;
	multiplier: number;
	consecutiveDays: number;
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

<!-- Omikuji + Stamp overlay (unified) -->
{#if stampPressData}
	<OmikujiStampOverlay
		bind:open={stampPressOpen}
		rank={stampPressData.omikujiRank}
		totalPoints={stampPressData.totalPoints}
		multiplier={stampPressData.multiplier}
		consecutiveDays={stampPressData.consecutiveDays}
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
