// tests/unit/tutorial/tutorial-store.test.ts
// #4654 (EPIC #4650 判断 2): 親の章立てチュートリアル (v1) 撤去後の tutorial-store の振る舞い。
//
// 旧 spec は quickMode（親チャプター専用の「チャプター1 だけ表示して継続を提案」機構）を検証していたが、
// 親チャプター (TUTORIAL_CHAPTERS) ごと撤去したため quickMode 自体が存在しない。
// 撤去後に残るのは「setChapters で渡された章 (= 子供画面ガイド) を順に進める」機構のみで、
// 本 spec はその進行 / 再開 / 終了と、**章未設定 (既定 = 空配列) では起動しても step が無い**ことを固定する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// $app/navigation の goto をモック（jsdom 内では URL 遷移できない）
vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
}));

// fetch をモック（completeTutorial が叩く）
globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;

import {
	endTutorial,
	getChapters,
	getCurrentStep,
	getProgress,
	isResumePromptShown,
	isTutorialActive,
	nextStep,
	prevStep,
	resumeTutorial,
	setChapters,
	startFromBeginning,
	startTutorial,
} from '../../../src/lib/ui/tutorial/tutorial-store.svelte';
import type { TutorialChapter } from '../../../src/lib/ui/tutorial/tutorial-types';

/** 子供画面ガイド相当の最小 fixture（2 章 3 step）。 */
const CHAPTERS_FIXTURE: TutorialChapter[] = [
	{
		id: 1,
		title: 'きろくしよう',
		icon: '⭐',
		steps: [
			{
				id: 'child-record-card',
				chapterId: 1,
				selector: '[data-tutorial="activity-card"]',
				title: 'かつどうカード',
				description: 'カードの説明',
				position: 'bottom',
			},
			{
				id: 'child-record-cancel',
				chapterId: 1,
				title: 'とりけし',
				description: 'とりけしの説明',
				position: 'bottom',
			},
		],
	},
	{
		id: 2,
		title: 'ほかの がめん',
		icon: '📊',
		steps: [
			{
				id: 'child-nav-status',
				chapterId: 2,
				selector: '[data-tutorial="nav-status"]',
				title: 'つよさ',
				description: 'つよさの説明',
				position: 'top',
			},
		],
	},
];

describe('tutorial-store (#4654 章立て撤去後)', () => {
	beforeEach(() => {
		endTutorial();
		setChapters(CHAPTERS_FIXTURE);
		if (typeof localStorage !== 'undefined') {
			localStorage.clear();
		}
		vi.clearAllMocks();
	});

	describe('章の差し替え', () => {
		it('setChapters で渡した章が有効になる', () => {
			expect(getChapters()).toStrictEqual(CHAPTERS_FIXTURE);
		});

		it('setChapters([]) で章が空になり、起動しても step が無い（親の章立てが既定で復活しない）', async () => {
			setChapters([]);
			await startTutorial();
			expect(getChapters()).toEqual([]);
			expect(getCurrentStep()).toBeNull();
		});
	});

	describe('進行', () => {
		it('startTutorial() は chapter1 の先頭 step から始まる（quickMode は存在しない）', async () => {
			await startTutorial();
			expect(isTutorialActive()).toBe(true);
			expect(getCurrentStep()?.id).toBe('child-record-card');
			expect(getProgress()).toEqual({ current: 1, total: 3 });
		});

		it('nextStep で章をまたいで最後まで進み、最終 step の次で完了して非 active になる', async () => {
			await startTutorial();
			await nextStep();
			expect(getCurrentStep()?.id).toBe('child-record-cancel');
			await nextStep();
			// 章 1 の最後 → 章 2 の先頭へ（途中で完了ダイアログを挟まない）
			expect(getCurrentStep()?.id).toBe('child-nav-status');
			expect(getProgress()).toEqual({ current: 3, total: 3 });
			await nextStep();
			expect(isTutorialActive()).toBe(false);
		});

		it('prevStep で前章の最終 step に戻れる', async () => {
			await startTutorial();
			await nextStep();
			await nextStep();
			expect(getCurrentStep()?.id).toBe('child-nav-status');
			await prevStep();
			expect(getCurrentStep()?.id).toBe('child-record-cancel');
		});
	});

	describe('再開', () => {
		it('保存済み進捗があると resume prompt を出し、resumeTutorial でその step から再開する', async () => {
			// #4651: 進捗 key は setChapters の scope 単位 (本 spec は既定 scope)
			localStorage.setItem('tutorial-progress:default:chapter', '2');
			localStorage.setItem('tutorial-progress:default:step', '0');
			await startTutorial();
			expect(isResumePromptShown()).toBe(true);
			expect(isTutorialActive()).toBe(false);

			await resumeTutorial();
			expect(isTutorialActive()).toBe(true);
			expect(getCurrentStep()?.id).toBe('child-nav-status');
		});

		it('startFromBeginning は保存済み進捗を捨てて先頭から始める', async () => {
			// #4651: 進捗 key は setChapters の scope 単位 (本 spec は既定 scope)
			localStorage.setItem('tutorial-progress:default:chapter', '2');
			localStorage.setItem('tutorial-progress:default:step', '0');
			await startFromBeginning();
			expect(isTutorialActive()).toBe(true);
			expect(getCurrentStep()?.id).toBe('child-record-card');
		});
	});
});
