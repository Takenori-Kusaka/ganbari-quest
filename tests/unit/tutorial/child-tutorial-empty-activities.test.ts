// tests/unit/tutorial/child-tutorial-empty-activities.test.ts
//
// 子供ガイド (❓) の 1 章 1 step は `[data-tutorial="activity-card"]` を spotlight して
// 「やったことのカードをタップすると…」と案内する。活動が 1 件も無い画面では
// **光らせる先も押すものも無い** — 初回演出 `AdventureStartOverlay` と同じクラスの欠陥
// (「下にカードが無いのにカードを指す」) が、ガイド側にだけ残っていた。
//
// 固定する不変条件:
//   [A] 活動 0 件では selector を持たない (無い要素を spotlight しない)
//   [B] 活動 0 件では「タップすると」と言わず、まだ届いていないことを伝える
//   [C] 活動があれば従来どおり (step 数・id・selector は不変 = 進捗 index が壊れない)

import { describe, expect, it } from 'vitest';
import { getChildTutorialChapters } from '../../../src/lib/ui/tutorial/tutorial-chapters-child';

const MODES = ['preschool', 'elementary', 'junior', 'senior'] as const;

function recordCardStep(uiMode: string, hasActivities: boolean) {
	const chapters = getChildTutorialChapters(uiMode, { hasActivities });
	const step = chapters[0]?.steps[0];
	if (!step) throw new Error('1 章 1 step が取れない');
	return step;
}

describe('[A][B] 活動 0 件のガイド', () => {
	it('無い要素を spotlight しない (selector を持たない)', () => {
		for (const uiMode of MODES) {
			expect(recordCardStep(uiMode, false).selector, uiMode).toBeUndefined();
		}
	});

	it('「タップすると」と言わず、まだ届いていないことを伝える', () => {
		for (const uiMode of MODES) {
			const description = recordCardStep(uiMode, false).description;
			expect(description, uiMode).not.toContain('タップすると');
			expect(description, uiMode).not.toContain('タップする');
			expect(description, uiMode).toMatch(/まだ|とどいて|届いて/);
		}
	});

	it('文体は年齢帯で分かれたまま (junior / senior は漢字)', () => {
		expect(recordCardStep('senior', false).description).toMatch(/[一-鿿]/);
		expect(recordCardStep('preschool', false).description).not.toContain('保護者');
	});
});

describe('[C] 活動があるときは従来どおり', () => {
	it('カードを spotlight してタップを案内する', () => {
		for (const uiMode of MODES) {
			const step = recordCardStep(uiMode, true);
			expect(step.selector, uiMode).toBe('[data-tutorial="activity-card"]');
			expect(step.description, uiMode).toContain('タップする');
		}
	});

	it('step の id / 件数は 0 件でも変わらない (保存済み進捗 index が壊れない)', () => {
		for (const uiMode of MODES) {
			const withActivities = getChildTutorialChapters(uiMode, { hasActivities: true });
			const without = getChildTutorialChapters(uiMode, { hasActivities: false });
			expect(without.length, uiMode).toBe(withActivities.length);
			expect(
				without.map((c) => c.steps.map((s) => s.id)),
				uiMode,
			).toEqual(withActivities.map((c) => c.steps.map((s) => s.id)));
		}
	});
});
