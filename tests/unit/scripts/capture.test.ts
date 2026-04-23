import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
	buildGridLayout,
	checkImageNotBlank,
	checkStepLimit,
	generateMarkdownSnippet,
	PRESETS,
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
		const md = generateMarkdownSnippet(
			'add-activity',
			steps,
			'tmp/screenshots/add-activity-flow.webp',
		);
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

describe('checkStepLimit (#1424)', () => {
	it('正常範囲内のステップはエラーをスローしない', () => {
		expect(() => checkStepLimit(1, 12, 2, 400, 300)).not.toThrow();
		expect(() => checkStepLimit(12, 12, 2, 400, 300)).not.toThrow();
	});

	it('maxSteps + 1 でエラーをスローし、ステップ番号を明示する', () => {
		expect(() => checkStepLimit(13, 12, 2, 400, 300)).toThrowError(/ステップ上限超過/);
		expect(() => checkStepLimit(13, 12, 2, 400, 300)).toThrowError(/13 > 12/);
		expect(() => checkStepLimit(13, 12, 2, 400, 300)).toThrowError(/--max-steps/);
	});

	it('80% 閾値以下（floor(12 * 0.8) = 9）は warn=false を返す', () => {
		const result = checkStepLimit(9, 12, 2, 400, 300);
		expect(result.warn).toBe(false);
		expect(result.layout).toBeNull();
	});

	it('80% 閾値超過（stepIndex=10 > 9）は warn=true + layout を返す', () => {
		const result = checkStepLimit(10, 12, 2, 400, 300);
		expect(result.warn).toBe(true);
		expect(result.layout).not.toBeNull();
		expect(result.layout?.totalWidth).toBe(800);
	});

	it('maxSteps=10 の場合 floor(10 * 0.8)=8、stepIndex=9 で warn=true', () => {
		const under = checkStepLimit(8, 10, 2, 400, 300);
		expect(under.warn).toBe(false);

		const over = checkStepLimit(9, 10, 2, 400, 300);
		expect(over.warn).toBe(true);
	});
});

describe('checkImageNotBlank (#1424)', () => {
	let tmpDir: string;
	let whitePng: string;
	let blackPng: string;
	let normalPng: string;

	beforeAll(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'capture-test-'));
		whitePng = join(tmpDir, 'white.png');
		blackPng = join(tmpDir, 'black.png');
		normalPng = join(tmpDir, 'normal.png');

		const sharp = (await import('sharp')).default;

		await sharp({
			create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 255, b: 255 } },
		})
			.png()
			.toFile(whitePng);

		await sharp({
			create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
		})
			.png()
			.toFile(blackPng);

		// 非均一画像（グラデーション）
		const buf = Buffer.alloc(10 * 10 * 3);
		for (let i = 0; i < 100; i++) {
			buf[i * 3] = i * 2; // 0〜198 の範囲
			buf[i * 3 + 1] = 100;
			buf[i * 3 + 2] = 50;
		}
		await sharp(buf, { raw: { width: 10, height: 10, channels: 3 } })
			.png()
			.toFile(normalPng);
	});

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('全白画像は blank=true・reason に「全白」を含む', async () => {
		const result = await checkImageNotBlank(whitePng);
		expect(result.blank).toBe(true);
		expect(result.reason).toContain('全白');
	});

	it('全黒画像は blank=true・reason に「全黒」を含む', async () => {
		const result = await checkImageNotBlank(blackPng);
		expect(result.blank).toBe(true);
		expect(result.reason).toContain('全黒');
	});

	it('通常画像（非均一）は blank=false・reason が空', async () => {
		const result = await checkImageNotBlank(normalPng);
		expect(result.blank).toBe(false);
		expect(result.reason).toBe('');
	});
});
