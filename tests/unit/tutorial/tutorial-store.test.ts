// tests/unit/tutorial/tutorial-store.test.ts
// #961 QA: tutorial-store の quickMode 周辺ロジックのユニットテスト
//
// - startTutorial(1) でチャプター明示指定 → quickMode=false
// - startTutorial() で引数なし + 親チャプター → quickMode=true
// - startTutorial() で引数なし + 子チャプター → quickMode=false（①ガード）
// - continueFullTutorial / finishQuickTutorial の状態遷移
// - nextStep でクイックモード最終ステップ → showQuickComplete=true

import { beforeEach, describe, expect, it, vi } from 'vitest';

// $app/navigation の goto をモック（jsdom 内では URL 遷移できない）
vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
}));

// fetch をモック（completeTutorial / markTutorialStarted が叩く）
globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;

import {
	continueFullTutorial,
	endTutorial,
	finishQuickTutorial,
	getCurrentStep,
	isQuickCompleteShown,
	isQuickModeActive,
	isTutorialActive,
	nextStep,
	resetChapters,
	setChapters,
	startTutorial,
} from '../../../src/lib/ui/tutorial/tutorial-store.svelte';
// テスト対象の store を読み込む。注意: state はモジュール singleton なので、
// beforeEach で endTutorial/resetChapters を呼んでクリーンに戻す。
import type { TutorialChapter } from '../../../src/lib/ui/tutorial/tutorial-types';

// 子チャプターの最小定義（parent と別オブジェクト参照であることが重要）
const CHILD_CHAPTERS_FIXTURE: TutorialChapter[] = [
	{
		id: 1,
		title: 'こどもチャプター1',
		icon: '⭐',
		steps: [
			{
				id: 'child-1',
				chapterId: 1,
				selector: '[data-tutorial="activity-card"]',
				title: 'かつどうカード',
				description: 'これはかつどうカード',
				position: 'top',
			},
			{
				id: 'child-2',
				chapterId: 1,
				selector: '[data-tutorial="record-button"]',
				title: 'きろくボタン',
				description: 'これはきろくボタン',
				position: 'top',
			},
		],
	},
	{
		id: 2,
		title: 'こどもチャプター2',
		icon: '🎯',
		steps: [
			{
				id: 'child-2-1',
				chapterId: 2,
				selector: '[data-tutorial="stamp"]',
				title: 'スタンプ',
				description: 'スタンプの説明',
				position: 'top',
			},
		],
	},
];

describe('tutorial-store (#961 QA)', () => {
	beforeEach(() => {
		// 親チャプターにリセット、進捗クリア、localStorage クリア
		endTutorial();
		resetChapters();
		if (typeof localStorage !== 'undefined') {
			localStorage.clear();
		}
		vi.clearAllMocks();
	});

	describe('startTutorial (quickMode 判定)', () => {
		it('startTutorial(1) — チャプター明示指定時は quickMode=false', async () => {
			await startTutorial(1);
			expect(isQuickModeActive()).toBe(false);
			expect(isTutorialActive()).toBe(true);
		});

		it('startTutorial() — 引数なし + 親チャプター中は quickMode=true', async () => {
			// デフォルトで親チャプター（resetChapters 済み）
			await startTutorial();
			expect(isQuickModeActive()).toBe(true);
			expect(isTutorialActive()).toBe(true);
		});

		it('startTutorial() — 引数なし + 子チャプター中は quickMode=false（#961 QA ①ガード）', async () => {
			// 子チャプターに切替
			setChapters(CHILD_CHAPTERS_FIXTURE);
			await startTutorial();
			expect(isQuickModeActive()).toBe(false);
			expect(isTutorialActive()).toBe(true);
		});

		it('setChapters で親チャプター以外に切替後、resetChapters で親チャプターに戻ると quickMode 判定も親側になる', async () => {
			setChapters(CHILD_CHAPTERS_FIXTURE);
			resetChapters();
			await startTutorial();
			expect(isQuickModeActive()).toBe(true);
		});
	});

	describe('continueFullTutorial', () => {
		it('showQuickComplete→false, quickMode→false, currentChapter=2, currentStepIndex=0', async () => {
			// 前提: quickMode + showQuickComplete を true にするため、親チャプターで
			// チャプター1 を最後まで進める
			await startTutorial();
			// チャプター1 の最終ステップまで nextStep を回す
			// TUTORIAL_CHAPTERS の chapter1 は intro-1..4 の4ステップ
			// 最終ステップで nextStep → showQuickComplete=true になる
			for (let i = 0; i < 4; i++) {
				// eslint-disable-next-line no-await-in-loop
				await nextStep();
			}
			expect(isQuickCompleteShown()).toBe(true);

			// continueFullTutorial を呼ぶ
			await continueFullTutorial();

			expect(isQuickCompleteShown()).toBe(false);
			expect(isQuickModeActive()).toBe(false);
			// チャプター2 の最初のステップにいる
			const step = getCurrentStep();
			expect(step?.chapterId).toBe(2);
		});
	});

	describe('finishQuickTutorial', () => {
		it('showQuickComplete→false, quickMode→false, isActive→false', async () => {
			await startTutorial();
			for (let i = 0; i < 4; i++) {
				// eslint-disable-next-line no-await-in-loop
				await nextStep();
			}
			expect(isQuickCompleteShown()).toBe(true);

			await finishQuickTutorial();

			expect(isQuickCompleteShown()).toBe(false);
			expect(isQuickModeActive()).toBe(false);
			expect(isTutorialActive()).toBe(false);
		});
	});

	describe('isQuickCompleteShown', () => {
		it('初期状態は false', () => {
			expect(isQuickCompleteShown()).toBe(false);
		});

		it('quickMode でチャプター1 最終ステップの nextStep 後に true', async () => {
			await startTutorial();
			for (let i = 0; i < 4; i++) {
				// eslint-disable-next-line no-await-in-loop
				await nextStep();
			}
			expect(isQuickCompleteShown()).toBe(true);
		});
	});

	describe('nextStep (quickMode + chapter 1 最終ステップ)', () => {
		it('quickMode かつ chapter 1 の最後で showQuickComplete=true', async () => {
			await startTutorial();
			// チャプター1 の intro-1 (index 0) からスタート
			// intro-1 → intro-2 → intro-3 → intro-4 → (最終) nextStep で showQuickComplete
			for (let i = 0; i < 4; i++) {
				// eslint-disable-next-line no-await-in-loop
				await nextStep();
			}
			expect(isQuickCompleteShown()).toBe(true);
			// quickMode はまだ維持されたまま（ダイアログで使う）
			expect(isQuickModeActive()).toBe(true);
		});

		it('非 quickMode（チャプター明示指定）では chapter 1 最終で chapter 2 に遷移する', async () => {
			await startTutorial(1); // 明示指定 → quickMode=false
			expect(isQuickModeActive()).toBe(false);
			// 4回 nextStep で chapter2 に遷移するはず
			for (let i = 0; i < 4; i++) {
				// eslint-disable-next-line no-await-in-loop
				await nextStep();
			}
			expect(isQuickCompleteShown()).toBe(false);
			const step = getCurrentStep();
			expect(step?.chapterId).toBe(2);
		});
	});
});
