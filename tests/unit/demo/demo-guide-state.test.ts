// tests/unit/demo/demo-guide-state.test.ts
// #702 — デモガイド「つぎへ」でステップが 1→3→5 に飛ぶ回帰テスト
//
// バグの本質:
//   handleAdvance() で currentStep を進めた直後に、Svelte 5 の reactive な
//   `<a href={nextStep.href}>` バインディングが「新しい currentStep」に基づき
//   *次の次のステップ* の URL に更新され、ブラウザがそちらへナビゲートする。
//   結果として $page 変化を契機に checkAutoAdvance() がさらにもう 1 ステップ
//   進めてしまい、1 クリックで 2 ステップ進む。
//
// このユニットテストは demo-guide-state モジュール単体の論理を保証する。
// 「同一 matchPath ステップ間で auto-advance しない」「次のステップに進んだ
// 直後に同じ pathname で checkAutoAdvance を呼んでも更に進まない」など、
// コンポーネント側の修正と合わせて回帰を防ぐ。

import { beforeEach, describe, expect, it } from 'vitest';
import {
	advanceStep,
	checkAutoAdvance,
	dismissGuide,
	GUIDE_STEPS,
	getGuideState,
	goBack,
	resetGuide,
	startGuide,
} from '../../../src/lib/features/demo/demo-guide-state.svelte';

describe('demo-guide-state (#702)', () => {
	const guide = getGuideState();

	beforeEach(() => {
		// 各テスト前にガイド状態を完全リセット
		// startGuide() で guideDismissed=false に戻してから resetGuide() で
		// guideActive=false, currentStep=0 にする（resetGuide 単体では
		// guideDismissed をリセットしないため、前テストの dismissGuide() が残る）
		startGuide();
		resetGuide();
	});

	describe('GUIDE_STEPS の整合性', () => {
		it('7 ステップが定義されている', () => {
			expect(GUIDE_STEPS).toHaveLength(7);
		});

		it('Step 1 と Step 2 は同一 matchPath を共有する（活動記録は同じ画面で行う）', () => {
			expect(GUIDE_STEPS[0]?.matchPath).toBe('/demo/preschool/home');
			expect(GUIDE_STEPS[1]?.matchPath).toBe('/demo/preschool/home');
		});

		it('Step 2 以降は requiresAction を持たない（つぎへ ボタンで進める）', () => {
			expect(GUIDE_STEPS[1]?.requiresAction).toBeFalsy();
		});
	});

	describe('startGuide / advanceStep / goBack', () => {
		it('startGuide() で currentStep が 0 になる', () => {
			startGuide();
			expect(guide.currentStep).toBe(0);
			expect(guide.active).toBe(true);
		});

		it('advanceStep() で currentStep が 1 ずつ増える', () => {
			startGuide();
			advanceStep();
			expect(guide.currentStep).toBe(1);
			advanceStep();
			expect(guide.currentStep).toBe(2);
		});

		it('advanceStep() は最終ステップを超えない', () => {
			startGuide();
			for (let i = 0; i < 10; i++) advanceStep();
			expect(guide.currentStep).toBe(GUIDE_STEPS.length - 1);
		});

		it('goBack() で currentStep が 1 ずつ減る', () => {
			startGuide();
			advanceStep();
			advanceStep();
			expect(guide.currentStep).toBe(2);
			goBack();
			expect(guide.currentStep).toBe(1);
		});

		it('goBack() は 0 を下回らない', () => {
			startGuide();
			goBack();
			expect(guide.currentStep).toBe(0);
		});
	});

	describe('checkAutoAdvance — 同一 matchPath 連続ステップ間でスキップしない', () => {
		it('Step 1 (currentStep=0) で /demo/preschool/home パスを受けても Step 2 へ進まない', () => {
			startGuide();
			checkAutoAdvance('/demo/preschool/home');
			// Step 1 と Step 2 は同一 matchPath なので auto-advance してはならない
			expect(guide.currentStep).toBe(0);
		});

		it('Step 2 (currentStep=1) で /demo/preschool/home パスを受けても Step 3 へ進まない', () => {
			startGuide();
			advanceStep(); // → Step 2
			checkAutoAdvance('/demo/preschool/home');
			// pathname は Step 3 の matchPath (/demo/preschool/status) ではないので動かない
			expect(guide.currentStep).toBe(1);
		});

		it('Step 1 (currentStep=0) で /demo/preschool/status パスを受けても Step 2 へ進まない', () => {
			// nextStep (Step 2) の matchPath は /demo/preschool/home なので一致しない
			startGuide();
			checkAutoAdvance('/demo/preschool/status');
			expect(guide.currentStep).toBe(0);
		});
	});

	describe('checkAutoAdvance — guideActive 制御', () => {
		it('startGuide していない状態では何もしない', () => {
			// active=false から開始
			checkAutoAdvance('/demo/preschool/status');
			expect(guide.currentStep).toBe(0);
			expect(guide.active).toBe(false);
		});

		it('dismissGuide した後は何もしない', () => {
			startGuide();
			advanceStep();
			advanceStep();
			dismissGuide();
			expect(guide.active).toBe(false);
			checkAutoAdvance('/demo/preschool/admin');
			// dismiss されたら currentStep は固定される
			expect(guide.currentStep).toBe(2);
		});
	});

	describe('#702 回帰: 手動 advance 後に新しい pathname で checkAutoAdvance しても 2 段飛ばしにならない', () => {
		// このシナリオは「Step 1 で つぎへ 押下 → handleAdvance で currentStep=1 → ブラウザが
		// Step 2 の href (/demo/preschool/home?childId=902) にナビゲート → $page 変化 →
		// $effect が checkAutoAdvance('/demo/preschool/home') を実行」をシミュレートする。
		// 修正後は Step 2 のままであるべき（Step 3 にスキップしてはならない）。
		it('Step 1 → Step 2: 手動 advance 後の同一 pathname で動かない', () => {
			startGuide();
			advanceStep(); // つぎへ クリック相当
			expect(guide.currentStep).toBe(1);
			// ブラウザナビゲーション後の $effect 相当
			checkAutoAdvance('/demo/preschool/home');
			expect(guide.currentStep).toBe(1); // Step 2 のまま
		});

		it('Step 2 → Step 3: 手動 advance 後に Step 3 の pathname で動かない', () => {
			startGuide();
			advanceStep(); // → Step 2
			advanceStep(); // つぎへ クリック → Step 3
			expect(guide.currentStep).toBe(2);
			// ブラウザナビゲーション後の $effect 相当
			checkAutoAdvance('/demo/preschool/status');
			expect(guide.currentStep).toBe(2); // Step 3 のまま (Step 4 にスキップしない)
		});

		it('Step 3 → Step 4: 手動 advance 後に Step 4 の pathname で動かない', () => {
			startGuide();
			advanceStep();
			advanceStep();
			advanceStep(); // → Step 4
			expect(guide.currentStep).toBe(3);
			checkAutoAdvance('/demo/preschool/battle');
			expect(guide.currentStep).toBe(3); // Step 4 のまま (Step 5 にスキップしない)
		});

		it('全 7 ステップを正しく順番に踏める', () => {
			startGuide();
			const visited: number[] = [];
			visited.push(guide.currentStep + 1); // 1
			advanceStep();
			checkAutoAdvance('/demo/preschool/home'); // step 2 nav
			visited.push(guide.currentStep + 1); // 2
			advanceStep();
			checkAutoAdvance('/demo/preschool/status'); // step 3 nav
			visited.push(guide.currentStep + 1); // 3
			advanceStep();
			checkAutoAdvance('/demo/preschool/battle'); // step 4 nav
			visited.push(guide.currentStep + 1); // 4
			advanceStep();
			checkAutoAdvance('/demo/admin'); // step 5 nav
			visited.push(guide.currentStep + 1); // 5
			advanceStep();
			checkAutoAdvance('/demo/admin/license'); // step 6 nav
			visited.push(guide.currentStep + 1); // 6
			advanceStep();
			checkAutoAdvance('/demo/signup'); // step 7 nav
			visited.push(guide.currentStep + 1); // 7
			expect(visited).toEqual([1, 2, 3, 4, 5, 6, 7]);
		});
	});
});
