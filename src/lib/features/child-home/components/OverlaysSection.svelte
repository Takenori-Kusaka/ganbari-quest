<script lang="ts">
import { resolve } from '$app/paths';
import type { CategoryId } from '$lib/domain/ids';
import { normalizeUiMode } from '$lib/domain/validation/age-tier-types';
import BirthdayModal from '$lib/features/birthday/BirthdayModal.svelte';
import type { DialogType } from '$lib/features/child-home/dialog-state-machine';
import {
	resolveUiModeChangeMessage,
	type UiModeChangeNotice,
} from '$lib/features/child-home/ui-mode-change-notice';
import LevelUpOverlay from '$lib/ui/components/LevelUpOverlay.svelte';
import SpecialRewardOverlay from '$lib/ui/components/SpecialRewardOverlay.svelte';
import StampPressOverlay from '$lib/ui/components/StampPressOverlay.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

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
	// #4687: 週コンプリート済の日 (押印なし) / おみくじログインボーナスの実付与額
	cardFull: boolean;
	loginBonusPoints: number;
	loginBonusRank: string | null;
	weeklyRedeem: {
		points: number;
		filledSlots: number;
		totalSlots: number;
		completeBonus: number;
		/** #4687: 交換したカード枚数 (2 以上 = 複数週の救済) */
		weeks?: number;
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
	categoryId?: CategoryId;
	categoryName?: string;
	spGranted?: number;
}

interface Props {
	/**
	 * #4433: 「いま開いてよい 1 枚」。`DialogFSM` は素の class instance で `$state` proxy が
	 * 効かず、`fsm.current` の変化は component 境界を越えて伝播しない (#4313 で実測)。
	 * FSM instance を渡して各所で `fsm.current` を読むのをやめ、**親が持つ `$state` の
	 * mirror を prop で受ける**。arbitration (同時に 1 枚) は引き続き FSM が担う。
	 */
	current: DialogType;
	levelUpData: LevelUpData | null;
	onLevelUpClose: () => void;
	latestReward: LatestReward | null;
	onRewardClose: () => void;
	stampPressData: StampPressData | null;
	onStampPressClose: () => void;
	birthdayBonus: BirthdayBonus | null;
	onBirthdayClose: () => void;
	/** #4313: 誕生日で年齢帯 UI が切り替わったことの未読告知 (次回ログインで 1 回だけ) */
	uiModeChangeNotice: UiModeChangeNotice | null;
	/** #4313: 既読化済みなら再表示しない (`current` が uiModeChange でも出さない)。 */
	uiModeChangeOpen: boolean;
	onUiModeChangeClose: () => void;
	nickname: string;
	uiMode: string;
}

let {
	current,
	levelUpData,
	onLevelUpClose,
	latestReward,
	onRewardClose,
	stampPressData,
	onStampPressClose,
	birthdayBonus,
	onBirthdayClose,
	uiModeChangeNotice,
	uiModeChangeOpen,
	onUiModeChangeClose,
	nickname,
	uiMode,
}: Props = $props();

// Derive open states from the FSM's current dialog (mirrored into `current` by the parent)
let levelUpOpen = $derived(current === 'levelUp');
let rewardOpen = $derived(current === 'specialReward');
let stampPressOpen = $derived(current === 'stampPress');
let birthdayModalOpen = $derived(current === 'birthday');
// #4313: 年齢帯 UI 切替の告知。FSM が「同時に 1 枚」を保証するため、誕生日モーダル等と
// 重ならない (ADR-0012)。文言は切替**後**の uiMode を基準に labels.ts SSOT から解決する。
let uiModeChangeMsg = $derived(
	uiModeChangeNotice ? resolveUiModeChangeMessage(uiModeChangeNotice.to) : null,
);
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
		cardFull={stampPressData.cardFull}
		loginBonusPoints={stampPressData.loginBonusPoints}
		loginBonusRank={stampPressData.loginBonusRank}
		weeklyRedeem={stampPressData.weeklyRedeem}
		uiMode={normalizeUiMode(uiMode)}
		onClose={onStampPressClose}
	/>
{/if}

<!--
	#4313: 年齢帯 UI 切替の告知 (誕生日で境界 3 / 6 / 13 / 16 歳を跨いだときのみ)。
	ADR-0012: 1 回で終わる静かな告知。自動再生・連続演出はせず、閉じる導線を常に持つ
	(closable 既定 true)。z-index は Dialog primitive の既定 layer = --z-modal トークン。
	`contentClass="relative"`: Dialog primitive の × は `absolute top-3 right-3` だが Content 側に
	位置指定が無く、既定のままだと full-screen positioner 基準で画面右上へ飛ぶ。card 基準に戻す。
-->
{#if uiModeChangeNotice && uiModeChangeMsg && uiModeChangeOpen}
	<Dialog
		open={uiModeChangeOpen}
		testid="ui-mode-change-dialog"
		ariaLabel={uiModeChangeMsg.ariaLabel}
		contentClass="relative"
		onOpenChange={(details) => {
			if (!details.open) onUiModeChangeClose();
		}}
	>
		<div class="flex flex-col items-center gap-3 py-2 text-center">
			<p class="text-4xl" aria-hidden="true">{uiModeChangeMsg.emoji}</p>
			<p class="text-lg font-black text-[var(--color-text)]" data-testid="ui-mode-change-heading">
				{uiModeChangeMsg.heading}
			</p>
			<p class="text-sm leading-relaxed text-[var(--color-text)]">{uiModeChangeMsg.body}</p>
			<p
				class="w-full rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-3 text-left text-xs leading-relaxed text-[var(--color-text-muted)]"
				data-testid="ui-mode-change-parent-note"
			>
				{uiModeChangeMsg.parentNote}
			</p>
			<a
				class="text-xs font-bold text-[var(--color-text-link)] underline"
				href={resolve('/admin/children')}
			>
				{uiModeChangeMsg.settingsLabel}
			</a>
			<Button
				variant="primary"
				class="w-full"
				data-testid="ui-mode-change-close-btn"
				onclick={onUiModeChangeClose}
			>
				{uiModeChangeMsg.closeLabel}
			</Button>
		</div>
	</Dialog>
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
