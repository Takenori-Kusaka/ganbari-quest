import type { TutorialChapter } from './tutorial-types';

/**
 * 子供画面用チュートリアルチャプター定義
 * 4章9ステップ（親画面の6章19ステップより少なく、子供が飽きない分量）
 *
 * 年齢帯別の文字サイズ・表現はTutorialBubble側で調整する。
 * ここでは全年齢共通の構造を定義。
 */
export const CHILD_TUTORIAL_CHAPTERS: TutorialChapter[] = [
	{
		id: 1,
		title: 'かつどうを きろくしよう',
		icon: '⭐',
		steps: [
			{
				id: 'child-record-1',
				chapterId: 1,
				selector: '[data-tutorial="activity-card"]',
				title: 'かつどうカード',
				description: 'このカードを タップしてみよう！やったことを きろく できるよ',
				position: 'bottom',
			},
			{
				id: 'child-record-2',
				chapterId: 1,
				selector: '[data-tutorial="record-button"]',
				title: 'きろく！ ボタン',
				description: 'きろく！ を おすと ポイントが もらえるよ！',
				position: 'top',
			},
			{
				id: 'child-record-3',
				chapterId: 1,
				title: 'ポイント ゲット！',
				description: 'すごい！ まいにち きろくすると もっと たくさん ポイントが もらえるよ！',
				position: 'bottom',
			},
		],
	},
	{
		id: 2,
		title: 'クエストを クリアしよう',
		icon: '🎯',
		steps: [
			{
				id: 'child-quest-1',
				chapterId: 2,
				selector: '[data-tutorial="daily-missions"]',
				title: 'きょうのクエスト',
				description: 'まいにち かわる クエストが あるよ。クリアすると ボーナスポイント！',
				position: 'bottom',
			},
			{
				id: 'child-quest-2',
				chapterId: 2,
				selector: '[data-tutorial="combo-counter"]',
				title: 'コンボ',
				description: 'れんぞくで きろくすると コンボ！ コンボが つづくと ポイントアップ！',
				position: 'bottom',
			},
		],
	},
	{
		id: 3,
		title: 'まいにち ログインしよう',
		icon: '🎴',
		steps: [
			{
				id: 'child-login-1',
				chapterId: 3,
				selector: '[data-tutorial="stamp-progress"]',
				title: 'スタンプカード',
				description: 'まいにち ログインすると スタンプが もらえるよ。ぜんぶ あつめると ボーナス！',
				position: 'bottom',
			},
			{
				id: 'child-login-2',
				chapterId: 3,
				selector: '[data-tutorial="omikuji"]',
				title: 'おみくじ',
				description: 'ログインすると おみくじも ひけるよ。大吉だと ポイント たくさん！',
				position: 'bottom',
			},
		],
	},
	{
		id: 4,
		title: 'つよさを みてみよう',
		icon: '📊',
		steps: [
			{
				id: 'child-status-1',
				chapterId: 4,
				selector: '[data-tutorial="nav-status"]',
				title: 'つよさ がめん',
				description: 'したの「つよさ」ボタンを おすと、じぶんの つよさが みれるよ！',
				position: 'top',
			},
			{
				id: 'child-status-2',
				chapterId: 4,
				selector: '[data-tutorial="radar-chart"]',
				title: 'レーダーチャート',
				description: '5つの ちからが チャートに なっているよ。どの ちからが つよいかな？',
				position: 'bottom',
			},
		],
	},
];

export function getChildAllSteps() {
	return CHILD_TUTORIAL_CHAPTERS.flatMap((ch) => ch.steps);
}
