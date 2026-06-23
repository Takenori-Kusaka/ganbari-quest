// tests/unit/scripts/check-guide-copy.test.ts
// #3261 (EPIC #3260 F0): ガイド文言 linter の検証。
//   - parseGuideSteps: _guide.ts ソースから step text を抽出（' / " / ` 複数行）
//   - lintGuideSteps: 謎用語 / 内部事情露出 / 文字数上限 / step 数 を検出
//   - 既存 11 ガイドは違反 0（baseline）

import { describe, expect, it } from 'vitest';
import {
	COPY_LIMITS,
	lintAllGuides,
	lintGuideSteps,
	MAX_STEPS,
	parseGuideSteps,
} from '../../../scripts/check-guide-copy.ts';

describe('parseGuideSteps (#3261)', () => {
	it('\' / " / ` 複数行の text フィールドを step ごとに抽出する', () => {
		const src = `
export const X = {
	steps: [
		{
			id: 'a',
			title: 'タイトル',
			what: \`複数行の
説明です\`,
			how: "手順です",
			goal: 'ゴール',
		},
		{
			id: 'b',
			title: 'ふたつめ',
			what: 'みじかい',
		},
	],
};`;
		const steps = parseGuideSteps(src);
		expect(steps).toHaveLength(2);
		expect(steps[0]?.title).toBe('タイトル');
		expect(steps[0]?.what).toContain('複数行');
		expect(steps[0]?.how).toBe('手順です');
		expect(steps[1]?.title).toBe('ふたつめ');
	});
});

describe('lintGuideSteps (#3261)', () => {
	it('謎用語（非 SSOT）を検出する', () => {
		const v = lintGuideSteps([{ id: 'a', what: 'パックから追加します' } as never], 'x');
		expect(v.some((x) => x.kind === 'mystery')).toBe(true);
	});

	it('内部事情の露出（route パス / .svelte / data-tutorial）を検出する', () => {
		const v = lintGuideSteps(
			[{ what: '/admin/settings に移動' } as never, { how: 'Foo.svelte を開く' } as never],
			'x',
		);
		expect(v.filter((x) => x.kind === 'internal').length).toBeGreaterThanOrEqual(2);
	});

	it('文字数上限超過を検出する', () => {
		const longWhat = 'あ'.repeat(COPY_LIMITS.what + 10);
		const v = lintGuideSteps([{ what: longWhat } as never], 'x');
		expect(v.some((x) => x.kind === 'length' && x.field === 'what')).toBe(true);
	});

	it('step 数 > MAX_STEPS を検出する', () => {
		const steps = Array.from({ length: MAX_STEPS + 1 }, (_, i) => ({ title: `t${i}` }));
		const v = lintGuideSteps(steps, 'x');
		expect(v.some((x) => x.kind === 'steps')).toBe(true);
	});

	it('正常な文言は違反ゼロ', () => {
		const v = lintGuideSteps([{ title: 'みじかい', what: 'ふつうの説明', goal: 'ゴール' }], 'x');
		expect(v).toHaveLength(0);
	});
});

describe('既存ガイドの baseline (#3261)', () => {
	it('現行 11 ガイドはガイド文言ルール違反 0', () => {
		const violations = lintAllGuides();
		expect(
			violations.length,
			`ガイド文言ルール違反:\n${violations.map((v) => `  ${v.file} step${v.step} ${v.field} [${v.kind}]: ${v.detail}`).join('\n')}`,
		).toBe(0);
	});
});
