<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, waitFor, within } from 'storybook/test';
import { asActivityId, asChildId } from '$lib/domain/ids';
import { SETUP_FIRST_ADVENTURE_LABELS } from '$lib/domain/labels';
import FirstAdventurePage from './+page.svelte';

// #4908: セットアップ 8/9「はじめてのぼうけん」の記録演出。以下 3 状態を視覚確認する。
//   1. Selecting — 活動選択中 (演出前)
//   2. RecordedMatchingPoints — カードの基礎ポイントと演出合計が一致 (内訳なし)
//   3. RecordedWithBonusAndLevelUp — 内訳表示 + レベルアップ表示 (#4908 実測パターン:
//      カード +10pt に対し演出 +20pt、レベルアップは実数で描画される)
const ACTIVITIES = [
	{
		id: asActivityId('activity-1'),
		name: 'しゅくだいをした',
		icon: '📝',
		basePoints: 10,
		isVisible: true,
	},
	{
		id: asActivityId('activity-2'),
		name: 'どくしょした',
		icon: '📖',
		basePoints: 10,
		isVisible: true,
	},
];

const baseData = {
	child: { id: asChildId('child-1'), nickname: 'てすとくん' },
	children: [{ id: asChildId('child-1'), nickname: 'てすとくん' }],
	activities: ACTIVITIES,
	imported: 0,
	skipped: 0,
	challengesRequested: 0,
	challengesAdded: 0,
	challengesFailed: 0,
};

const { Story } = defineMeta({
	title: 'Routes/Setup/FirstAdventureCelebration',
	component: FirstAdventurePage,
	tags: ['autodocs'],
});
</script>

<Story
	name="Selecting"
	args={{ data: baseData, form: null }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('しゅくだいをした')).toBeVisible();
	}}
/>

<!-- カードの基礎ポイントと演出合計が一致するときは内訳を出さない -->
<Story
	name="RecordedMatchingPoints"
	args={{
		data: baseData,
		form: {
			success: true,
			activityName: 'どくしょした',
			totalPoints: 10,
			basePoints: 10,
			levelUp: null,
		},
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// .success-screen は fadeIn (opacity 0→1、0.3s) で入場するため、mount 直後は
		// 一時的に opacity:0 = toBeVisible() 不成立になりうる。アニメ完了を待つ。
		await waitFor(() => expect(canvas.getByText('+10pt')).toBeVisible());
	}}
/>

<!-- #4908 実測パターン: 基礎 10pt に対し演出合計 +20pt (内訳を出す) + レベルアップ (実数で描画) -->
<Story
	name="RecordedWithBonusAndLevelUp"
	args={{
		data: baseData,
		form: {
			success: true,
			activityName: 'しゅくだいをした',
			totalPoints: 20,
			basePoints: 10,
			levelUp: {
				oldLevel: 1,
				oldTitle: 'かけだし',
				newLevel: 2,
				newTitle: 'みならい',
				categoryId: 'benkyou',
				categoryName: '勉強',
				spGranted: 0,
			},
		},
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await waitFor(() => expect(canvas.getByText('+20pt')).toBeVisible());
		await expect(
			canvas.getByText(SETUP_FIRST_ADVENTURE_LABELS.pointsBreakdown(10, 20)),
		).toBeVisible();
		await expect(canvas.getByText('Lv.1')).toBeVisible();
		await expect(canvas.getByText('Lv.2')).toBeVisible();
	}}
/>
