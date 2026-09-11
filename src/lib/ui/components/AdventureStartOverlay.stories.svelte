<script module lang="ts">
// 初回訪問の子供にだけ出る冒険スタート演出。年齢帯で文体が変わる (docs/DESIGN.md §8)。
//
// 実環境 (`DATA_SOURCE=demo`) では描画できない — 表示条件が `isFirstTime = !hasRecords`
// (`(child)/[uiMode=uiMode]/home/+page.server.ts`) で、demo の子供はいずれも記録済のため。
// 本 story が preschool (ひらがな) / senior (漢字) と「活動 0 件」時の視覚証跡になる。
//
// **play が見るのは phase 1 (1000ms) / phase 2 (3000ms) まで**。演出は phase 4 (8000ms) まで
// setTimeout で進むが、Storybook vitest の testTimeout は 5000ms (`vite.config.ts` の
// 既定値、per-story 指定は addon が持たない) なので、待つと必ず timeout する。
// 最終 phase (「さあ、はじめよう」/ 活動 0 件時の文言差) の assertion は fake timer で
// `tests/unit/components/child-first-screen-age-tier.test.ts` が持つ。
// **story を開けば演出は最後まで進む**ので、視覚証跡としては最終 phase まで確認できる。
//
// `component` 指定時は Storybook が args で component を描画するため、**meta 既定 args を必ず与える**
// (与えないと必須 props が undefined のまま mount される。同じ轍: #4538 / #4841)。
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, screen, waitFor } from 'storybook/test';
import { getChildAdventureStartLabels, STORYBOOK_LABELS } from '$lib/domain/labels';
import AdventureStartOverlay from './AdventureStartOverlay.svelte';

const L = STORYBOOK_LABELS.adventureStartOverlay;

const baseArgs = {
	open: true,
	childName: L.childName,
	uiMode: 'elementary',
	hasActivities: true,
};

/** phase 1 (あいさつ) → phase 2 (見出し) が、その年齢帯の文体で出ることを確かめる。 */
async function expectEarlyPhases(uiMode: string) {
	const t = getChildAdventureStartLabels(uiMode);
	const greeting = await waitFor(() => screen.getByText(t.adventureGreeting(L.childName)), {
		timeout: 3000,
	});
	await waitFor(() => expect(greeting).toBeVisible(), { timeout: 3000 });
	await waitFor(() => expect(screen.getByText(t.adventureBigText2)).toBeVisible(), {
		timeout: 4000,
	});
}

const { Story } = defineMeta({
	title: 'Components/AdventureStartOverlay',
	component: AdventureStartOverlay,
	tags: ['autodocs'],
	args: baseArgs,
});
</script>

<!-- 3-5 歳: 「やあ！ はると！」「きょうから いっしょに ぼうけんだよ！」→ 「したのカードをタップしてみてね」 -->
<Story
	name="Preschool"
	args={{ ...baseArgs, uiMode: 'preschool' }}
	play={async () => {
		await expectEarlyPhases('preschool');
	}}
/>

<!-- 16-18 歳: 「ようこそ、はると！」「今日からいっしょに 冒険を始めよう！」→ 「下のカードを選んで記録してみよう」 -->
<Story
	name="Senior"
	args={{ ...baseArgs, uiMode: 'senior' }}
	play={async () => {
		await expectEarlyPhases('senior');
	}}
/>

<!-- 活動 0 件: 最終 phase で「下のカード」を指さず「活動が届いたら始めよう」になる -->
<Story
	name="SeniorWithoutActivities"
	args={{ ...baseArgs, uiMode: 'senior', hasActivities: false }}
	play={async () => {
		await expectEarlyPhases('senior');
	}}
/>
