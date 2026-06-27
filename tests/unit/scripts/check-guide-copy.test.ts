// tests/unit/scripts/check-guide-copy.test.ts
// #3261 (EPIC #3260 F0): ガイド文言 linter の検証。
//   - lintGuideSteps: 謎用語 / 内部事情露出 / 文字数上限 / step 数 を検出
//   - lintGuideSourceFile (#3295): _guide.ts への SSOT バイパス (生の日本語表示文字列直書き) を検出
//   - 既存 11 ガイドは違反 0（baseline）

import { describe, expect, it } from 'vitest';
import {
	COPY_LIMITS,
	lintAllGuides,
	lintGuideSourceFile,
	lintGuideSourceFiles,
	lintGuideSteps,
	MAX_STEPS,
} from '../../../scripts/check-guide-copy.ts';

describe('lintGuideSourceFile (#3295)', () => {
	it('step / page-level の表示フィールドに生の日本語文字列直書きがあれば検出する', () => {
		// SSOT バイパス: title / what / how / goal / tips に日本語リテラル直書き。
		const src = `
import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
export const X = {
	title: '設定',
	steps: [
		{
			id: 'a',
			what: 'ここから設定します',
			how: "手順です",
			goal: \`ゴールです\`,
			tips: ['ヒントです'],
		},
	],
};`;
		const v = lintGuideSourceFile(src, 'x/_guide.ts');
		const fields = v.map((x) => x.field).sort();
		expect(fields).toEqual(['goal', 'how', 'tips', 'title', 'what']);
	});

	it('labels 参照 (L.title / ...L.steps[...]) と icon 絵文字は違反にしない', () => {
		// 正規の post-F3 構造: 表示文言は labels 参照のみ、icon は絵文字 (日本語表示文字外)。
		const src = `
import { PAGE_GUIDE_LABELS } from '$lib/domain/labels';
const L = PAGE_GUIDE_LABELS.adminActivities;
export const X = {
	title: L.title,
	icon: '📋',
	steps: [
		{
			id: 'activities-intro',
			...L.steps['activities-intro'],
		},
		{
			id: 'activities-add',
			selector: '[data-tutorial="add-activity-btn"]',
			...L.steps['activities-add'],
			position: 'bottom',
		},
	],
};`;
		expect(lintGuideSourceFile(src, 'x/_guide.ts')).toHaveLength(0);
	});

	it('現行 _guide.ts は SSOT バイパス違反 0（baseline）', () => {
		const violations = lintGuideSourceFiles();
		expect(
			violations.length,
			`SSOT バイパス違反:\n${violations.map((v) => `  ${v.file}:${v.line} ${v.field}: ${v.detail}`).join('\n')}`,
		).toBe(0);
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
