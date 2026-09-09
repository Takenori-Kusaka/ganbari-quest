<script module lang="ts">
// 子供ホームで活動が 1 件も無いときの空状態。年齢帯で文体が変わる (docs/DESIGN.md §8)。
//
// 実環境 (`DATA_SOURCE=demo`) では描画できない — demo の子供にはいずれも活動が配られており、
// `ProdDashboardSections.svelte` の `{#if activities.length === 0}` に入らないため。
// 本 story が preschool (ひらがな) / senior (漢字) の視覚証跡になる。
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, screen } from 'storybook/test';
import { getChildActivityEmptyLabels } from '$lib/domain/labels';
import ActivityEmptyState from './ActivityEmptyState.svelte';

const baseArgs = { uiMode: 'elementary' };

async function expectEmptyStateLabels(uiMode: string) {
	const t = getChildActivityEmptyLabels(uiMode);
	await expect(screen.getByTestId('activity-empty-state')).toBeVisible();
	await expect(screen.getByText(t.activityEmptyTitle)).toBeVisible();
	await expect(screen.getByText(t.activityEmptyDesc)).toBeVisible();
	await expect(screen.getByText(t.activityEmptyWait)).toBeVisible();
}

const { Story } = defineMeta({
	title: 'Components/ActivityEmptyState',
	component: ActivityEmptyState,
	tags: ['autodocs'],
	args: baseArgs,
});
</script>

<!-- 3-5 歳: 「ぼうけんの じゅんびちゅう...」「おうちの人が かつどうを よういしているよ！」 -->
<Story
	name="Preschool"
	args={{ ...baseArgs, uiMode: 'preschool' }}
	play={async () => {
		await expectEmptyStateLabels('preschool');
	}}
/>

<!-- 16-18 歳: 「冒険の準備中...」「保護者が活動を用意しています」 -->
<Story
	name="Senior"
	args={{ ...baseArgs, uiMode: 'senior' }}
	play={async () => {
		await expectEmptyStateLabels('senior');
	}}
/>
