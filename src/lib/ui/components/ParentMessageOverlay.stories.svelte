<script module lang="ts">
// #4841: 応援メッセージ dialog は年齢帯で文体が変わる (docs/DESIGN.md §8)。
//
// 実環境 (`DATA_SOURCE=demo`) では描画できない — demo の message repo
// (`src/lib/server/db/demo/message-repo.ts`) が `findUnshownMessage` で常に `undefined` を返し、
// 未読メッセージを作れないため。本 story が preschool (ひらがな) / senior (漢字) の視覚証跡になる。
//
// `component` 指定時は Storybook が args で component を描画するため、**meta 既定 args を必ず与える**
// (与えないと必須 props が undefined のまま mount される。同じ轍: #4538 / 本 PR の StampPressOverlay)。
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, screen, waitFor } from 'storybook/test';
import { getChildParentMessageLabels, STORYBOOK_LABELS } from '$lib/domain/labels';
import ParentMessageOverlay from './ParentMessageOverlay.svelte';

const L = STORYBOOK_LABELS.parentMessageOverlay;

const baseArgs = {
	open: true,
	messageType: 'reward_notice',
	stampLabel: '',
	body: L.body,
	icon: L.icon,
	bonusPoints: 50,
	uiMode: 'elementary' as const,
};

/** その年齢帯の文言 (タイトル / 差出人 / 受取額 / 確定ボタン) が実際に描画されることを確かめる。 */
async function expectMessageLabels(uiMode: string) {
	const t = getChildParentMessageLabels(uiMode);
	const title = await waitFor(() => screen.getByText(t.parentMessageTitle), { timeout: 5000 });
	await waitFor(() => expect(title).toBeVisible(), { timeout: 5000 });
	await expect(screen.getByText(t.parentMessageFrom)).toBeVisible();
	await expect(screen.getByTestId('parent-message-bonus')).toHaveTextContent(
		t.parentMessageBonusPoints(50),
	);
	await expect(screen.getByRole('button', { name: t.parentMessageConfirmBtn })).toBeVisible();
}

const { Story } = defineMeta({
	title: 'Components/ParentMessageOverlay',
	component: ParentMessageOverlay,
	tags: ['autodocs'],
	args: baseArgs,
});
</script>

<!-- 3-5 歳: 「💌 おうえんメッセージ！」「パパ・ママからのメッセージだよ」「うれしい！」 -->
<Story
	name="Preschool"
	args={{ ...baseArgs, uiMode: 'preschool' }}
	play={async () => {
		await expectMessageLabels('preschool');
	}}
/>

<!-- 16-18 歳: 「💌 応援メッセージ」「保護者からのメッセージ」「OK」 -->
<Story
	name="Senior"
	args={{ ...baseArgs, uiMode: 'senior' }}
	play={async () => {
		await expectMessageLabels('senior');
	}}
/>
