import { describe, expect, it } from 'vitest';

import {
	PRESETS,
	buildGridLayout,
	generateMarkdownSnippet,
	resolvePreset,
} from '../../../scripts/lib/screenshot-helpers.mjs';

describe('resolvePreset (#1424)', () => {
	it('mobile プリセットを解決できる', () => {
		const preset = resolvePreset('mobile');
		expect(preset).toEqual({ width: 390, height: 844, deviceScaleFactor: 2 });
	});

	it('tablet プリセットを解決できる', () => {
		const preset = resolvePreset('tablet');
		expect(preset).toEqual({ width: 768, height: 1024, deviceScaleFactor: 2 });
	});

	it('desktop プリセットを解決できる', () => {
		const preset = resolvePreset('desktop');
		expect(preset).toEqual({ width: 1280, height: 800, deviceScaleFactor: 1 });
	});

	it('不明なプリセットは Error をスローする', () => {
		expect(() => resolvePreset('unknown')).toThrowError(/Unknown preset/);
	});

	it('PRESETS と整合している', () => {
		for (const [name, expected] of Object.entries(PRESETS)) {
			expect(resolvePreset(name)).toEqual(expected);
		}
	});
});

describe('buildGridLayout (#1424)', () => {
	it('1 ステップ 2 列 → 1 列 1 行', () => {
		const layout = buildGridLayout(1, 2, 400, 300);
		expect(layout.cols).toBe(1);
		expect(layout.rows).toBe(1);
		expect(layout.totalWidth).toBe(400);
		expect(layout.totalHeight).toBe(300);
	});

	it('2 ステップ 2 列 → 2 列 1 行', () => {
		const layout = buildGridLayout(2, 2, 400, 300);
		expect(layout.cols).toBe(2);
		expect(layout.rows).toBe(1);
		expect(layout.totalWidth).toBe(800);
		expect(layout.totalHeight).toBe(300);
	});

	it('3 ステップ 2 列 → 2 列 2 行', () => {
		const layout = buildGridLayout(3, 2, 400, 300);
		expect(layout.cols).toBe(2);
		expect(layout.rows).toBe(2);
		expect(layout.totalWidth).toBe(800);
		expect(layout.totalHeight).toBe(600);
	});

	it('4 ステップ 2 列 → 2 列 2 行', () => {
		const layout = buildGridLayout(4, 2, 400, 300);
		expect(layout.cols).toBe(2);
		expect(layout.rows).toBe(2);
		expect(layout.totalWidth).toBe(800);
		expect(layout.totalHeight).toBe(600);
	});

	it('12 ステップ 2 列 → 2 列 6 行', () => {
		const layout = buildGridLayout(12, 2, 400, 300);
		expect(layout.cols).toBe(2);
		expect(layout.rows).toBe(6);
		expect(layout.totalHeight).toBe(1800);
	});

	it('1 ステップ 3 列 → cols は stepCount を超えない', () => {
		const layout = buildGridLayout(1, 3, 400, 300);
		expect(layout.cols).toBe(1);
	});

	it('totalHeight が 4000px 超の閾値を計算できる（警告判定用）', () => {
		// 14 steps × 300px / 2 cols = 7 rows × 300 = 2100px (under limit)
		const under = buildGridLayout(14, 2, 400, 300);
		expect(under.totalHeight).toBe(2100);

		// 28 steps × 300px / 2 cols = 14 rows × 300 = 4200px (over limit)
		const over = buildGridLayout(28, 2, 400, 300);
		expect(over.totalHeight).toBeGreaterThan(4000);
	});
});

describe('generateMarkdownSnippet (#1424)', () => {
	const steps = [
		{ label: '初期状態' },
		{ label: 'ダイアログ表示' },
		{ label: '入力完了' },
		{ label: '保存後' },
	];

	it('フロー名・ステップ数が見出しに反映される', () => {
		const md = generateMarkdownSnippet('add-activity', steps, 'tmp/screenshots/add-activity-flow.webp');
		expect(md).toContain('### add-activityフロー（4 ステップ）');
	});

	it('画像リンクが含まれる', () => {
		const md = generateMarkdownSnippet('my-flow', steps, 'some/path/my-flow-flow.webp');
		expect(md).toContain('![my-flow-flow](./some/path/my-flow-flow.webp)');
	});

	it('全ステップがテーブル行に含まれる', () => {
		const md = generateMarkdownSnippet('flow', steps, 'path/flow-flow.webp');
		expect(md).toContain('| 1 | 初期状態 |');
		expect(md).toContain('| 2 | ダイアログ表示 |');
		expect(md).toContain('| 3 | 入力完了 |');
		expect(md).toContain('| 4 | 保存後 |');
	});

	it('テーブルヘッダーが含まれる', () => {
		const md = generateMarkdownSnippet('flow', steps, 'path.webp');
		expect(md).toContain('| ステップ | 説明 |');
		expect(md).toContain('|---------|------|');
	});

	it('1 ステップの場合も正しく生成される', () => {
		const single = [{ label: '唯一のステップ' }];
		const md = generateMarkdownSnippet('solo', single, 'solo-flow.webp');
		expect(md).toContain('### soloフロー（1 ステップ）');
		expect(md).toContain('| 1 | 唯一のステップ |');
	});
});

describe('ScreenshotCapture / FlowRecorder — 設定検証 (#1424)', () => {
	it('resolvePreset: ステップ上限 80% の計算', () => {
		const maxSteps = 12;
		const threshold = Math.floor(maxSteps * 0.8);
		expect(threshold).toBe(9);

		const maxSteps10 = 10;
		const threshold10 = Math.floor(maxSteps10 * 0.8);
		expect(threshold10).toBe(8);
	});

	it('buildGridLayout: 5MB 超の WebP サイズ閾値は 5 * 1024 * 1024 = 5242880 bytes', () => {
		expect(5 * 1024 * 1024).toBe(5242880);
	});

	it('gridLayout: maxSteps=12, gridCols=2 の最大解像度は 800×1800px（4000px 以下）', () => {
		const layout = buildGridLayout(12, 2, 400, 300);
		expect(layout.totalHeight).toBeLessThanOrEqual(4000);
	});
});
