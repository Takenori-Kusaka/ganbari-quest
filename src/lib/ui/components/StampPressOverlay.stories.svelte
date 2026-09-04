<script module lang="ts">
// #4841: ログインボーナスの受取演出は年齢帯で文体が変わる (docs/DESIGN.md §8)。
//
// 実環境 (`DATA_SOURCE=demo`) では「当日まだ受け取っていない」状態を作れず SS 撮影で描画できない
// ため、本 story が preschool (ひらがな) / senior (漢字) の視覚証跡になる。
//
// `component` 指定時は Storybook が args で component を描画するため、**meta 既定 args を必ず与える**
// (与えないと `cardEntries` 等が undefined のまま mount され render error になる。同じ轍: #4538)。
// play 関数で「文体が実際に描画される」ことまで assert し、args 欠落で無言に壊れないようにする。
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, screen, waitFor } from 'storybook/test';
import { getChildStampLabels, STORYBOOK_LABELS } from '$lib/domain/labels';
import StampPressOverlay from './StampPressOverlay.svelte';

const L = STORYBOOK_LABELS.stampPressOverlay;

/** 押印済みスロット (押印演出は「今週 n 回目」のカードを背景に出す)。 */
const cardEntries = [
	{ slot: 1, emoji: '🎋', rarity: 'N', omikujiRank: null },
	{ slot: 2, emoji: '🌟', rarity: 'R', omikujiRank: null },
];

const baseArgs = {
	open: true,
	stampRarity: 'R',
	stampName: L.stampName,
	stampOmikujiRank: null,
	instantPoints: 10,
	consecutiveDays: 3,
	multiplier: 1,
	cardFull: false,
	loginBonusPoints: 0,
	loginBonusRank: null,
	cardFilledSlots: 2,
	cardTotalSlots: 5,
	cardEntries,
	weeklyRedeem: null,
	uiMode: 'elementary' as const,
};

/**
 * points フェーズ (1.2s 後) まで待ってから、その年齢帯の文言が出ていることを確かめる。
 *
 * 描画直後は fade-in アニメーションの 0% (opacity: 0) を踏むため、`toBeVisible` は
 * waitFor でくるんで「アニメーションが終わって実際に見えている」ことまで待つ。
 */
async function expectStreakLabel(uiMode: string) {
	const t = getChildStampLabels(uiMode);
	const streak = await waitFor(() => screen.getByText(t.stampPressStreakLabel(3)), {
		timeout: 5000,
	});
	await waitFor(() => expect(streak).toBeVisible(), { timeout: 5000 });
	const confirm = screen.getByRole('button', { name: t.stampPressConfirmBtn });
	await waitFor(() => expect(confirm).toBeVisible(), { timeout: 5000 });
	return confirm;
}

const { Story } = defineMeta({
	title: 'Components/StampPressOverlay',
	component: StampPressOverlay,
	tags: ['autodocs'],
	args: baseArgs,
});
</script>

<!-- 3-5 歳: 「3にちれんぞく！」「やったね！」 -->
<Story
	name="Preschool"
	args={{ ...baseArgs, uiMode: 'preschool' }}
	play={async () => {
		await expectStreakLabel('preschool');
	}}
/>

<!-- 16-18 歳: 「3日連続！」「OK」 -->
<Story
	name="Senior"
	args={{ ...baseArgs, uiMode: 'senior' }}
	play={async () => {
		await expectStreakLabel('senior');
	}}
/>

<!-- 週次交換フェーズ (「つぎへ」/「次へ」で遷移する 2 画面目)。play で実際に遷移させて描画する -->
<Story
	name="SeniorWeeklyRedeem"
	args={{
		...baseArgs,
		uiMode: 'senior',
		cardFilledSlots: 5,
		cardEntries: [
			...cardEntries,
			{ slot: 3, emoji: '🎍', rarity: 'N', omikujiRank: null },
			{ slot: 4, emoji: '🌟', rarity: 'SR', omikujiRank: null },
			{ slot: 5, emoji: '🎋', rarity: 'N', omikujiRank: null },
		],
		weeklyRedeem: { points: 100, filledSlots: 5, totalSlots: 5, completeBonus: 50, weeks: 1 },
	}}
	play={async () => {
		const t = getChildStampLabels('senior');
		// 未交換カードがある回は確定ボタンが「次へ」になり、押すと週次交換フェーズに進む
		const next = await waitFor(() => screen.getByRole('button', { name: t.stampPressNextBtn }), {
			timeout: 5000,
		});
		await waitFor(() => expect(next).toBeVisible(), { timeout: 5000 });
		await next.click();
		const title = await waitFor(() => screen.getByText(t.stampPressWeeklyTitle));
		await waitFor(() => expect(title).toBeVisible(), { timeout: 5000 });
		await waitFor(
			() => expect(screen.getByText(t.stampPressWeeklyCount(5, 5))).toBeVisible(),
			{ timeout: 5000 },
		);
	}}
/>
