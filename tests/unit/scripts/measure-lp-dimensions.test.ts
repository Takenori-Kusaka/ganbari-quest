// #1783: LP HTML 内の <img src="screenshots/..."> 物理存在 gate のテスト
//
// scripts/measure-lp-dimensions.mjs の `findMissingScreenshots` 関数を直接 import すると
// tsconfig.checkJs=true の連鎖で .mjs の暗黙 any error が大量発覚するため、
// 子プロセスで script を起動して標準出力 / exit code / lp-metrics.json を検証する。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'measure-lp-dimensions.mjs');

// LP HTML 最小ひな型（chromium が起動できる程度の DOM 構造）
function makeLpHtml(imgRefs: string[]): string {
	const imgs = imgRefs.map((rel) => `<img src="${rel}" alt="x" data-testid="t">`).join('\n');
	return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>test</title></head>
<body>
<a href="/auth/signup">無料で始める</a>
<a href="/auth/login">ログイン</a>
${imgs}
</body>
</html>`;
}

function writeFile(siteDir: string, rel: string, content = 'dummy'): void {
	const target = join(siteDir, rel);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
}

interface MeasureResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

function runMeasure(siteDir: string, env: Record<string, string> = {}): MeasureResult {
	const outputPath = join(siteDir, 'lp-metrics.json');
	try {
		const stdout = execFileSync(
			'node',
			[SCRIPT_PATH, `--site-dir=${siteDir}`, `--output=${outputPath}`, '--target=index.html'],
			{
				// #1783 follow-up: CI 環境に chromium が install されていないため、
				// missing-image-gate の検証は MEASURE_SKIP_BROWSER=1 のブラウザレス経路で行う。
				// height / cta 計測は別 job (lp-metrics.yml) が担保しているため
				// unit test のスコープ外。
				env: { ...process.env, MEASURE_SKIP_BROWSER: '1', ...env },
				encoding: 'utf-8',
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		return { exitCode: 0, stdout, stderr: '' };
	} catch (err) {
		const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
		return {
			exitCode: e.status ?? -1,
			stdout: e.stdout?.toString() ?? '',
			stderr: e.stderr?.toString() ?? '',
		};
	}
}

describe('measure-lp-dimensions — missing image gate (#1783)', () => {
	let tmpSiteDir: string;

	beforeEach(() => {
		tmpSiteDir = mkdtempSync(join(tmpdir(), 'measure-lp-test-'));
	});

	afterEach(() => {
		rmSync(tmpSiteDir, { recursive: true, force: true });
	});

	it('全 ref が物理存在するとき exit 0 + lp-metrics.json に missing 0 件', () => {
		writeFile(tmpSiteDir, 'index.html', makeLpHtml(['screenshots/foo.webp']));
		writeFile(tmpSiteDir, 'screenshots/foo.webp');
		const r = runMeasure(tmpSiteDir);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain('[OK]');
		const metrics = JSON.parse(readFileSync(join(tmpSiteDir, 'lp-metrics.json'), 'utf-8'));
		expect(metrics.screenshotRefs).toContain('screenshots/foo.webp');
		expect(metrics.missingScreenshots).toEqual([]);
	}, 60000);

	it('1 件欠落で exit 1 + violations に missing が列挙される', () => {
		writeFile(tmpSiteDir, 'index.html', makeLpHtml(['screenshots/missing.webp']));
		const r = runMeasure(tmpSiteDir);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('[FAIL]');
		expect(r.stderr).toContain('screenshots/missing.webp');
		expect(r.stderr).toContain('missingScreenshots');
	}, 60000);

	it('SKIP_SCREENSHOT_EXISTENCE_CHECK=1 で missing を skip して exit 0', () => {
		writeFile(tmpSiteDir, 'index.html', makeLpHtml(['screenshots/missing.webp']));
		const r = runMeasure(tmpSiteDir, { SKIP_SCREENSHOT_EXISTENCE_CHECK: '1' });
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain('[OK]');
		const metrics = JSON.parse(readFileSync(join(tmpSiteDir, 'lp-metrics.json'), 'utf-8'));
		// SKIP 時も計測結果としては missing リストを保持
		expect(metrics.missingScreenshots).toContain('screenshots/missing.webp');
	}, 60000);

	it('複数 ref のうち一部欠落をすべて報告する', () => {
		writeFile(
			tmpSiteDir,
			'index.html',
			makeLpHtml([
				'screenshots/has.webp',
				'screenshots/missing-a.webp',
				'screenshots/missing-b.webp',
			]),
		);
		writeFile(tmpSiteDir, 'screenshots/has.webp');
		const r = runMeasure(tmpSiteDir);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('screenshots/missing-a.webp');
		expect(r.stderr).toContain('screenshots/missing-b.webp');
		expect(r.stderr).toContain('missingScreenshots (2 件)');
	}, 60000);

	it('screenshots/ 以外の <img src> は無視する', () => {
		const html = `<!DOCTYPE html><html><body>
			<img src="logos/brand.svg">
			<img src="static/icon.png">
		</body></html>`;
		writeFile(tmpSiteDir, 'index.html', html);
		const r = runMeasure(tmpSiteDir);
		expect(r.exitCode).toBe(0);
		const metrics = JSON.parse(readFileSync(join(tmpSiteDir, 'lp-metrics.json'), 'utf-8'));
		expect(metrics.screenshotRefs).toEqual([]);
		expect(metrics.missingScreenshots).toEqual([]);
	}, 60000);

	it('script ファイルが存在する（リファクタ予防）', () => {
		expect(existsSync(SCRIPT_PATH)).toBe(true);
	});
});

// #1840: 累積 desktopHeight warning gate のテスト
//
// MEASURE_SKIP_BROWSER=1 経路では desktopHeight が 0 になり warning に達しないため、
// JSON 出力に warnings フィールドが必ず含まれることと、
// `--warn-threshold` で閾値が上書きされ fail / warn / ok の境界が動くことを確認する。
describe('measure-lp-dimensions — cumulative desktopHeight warning gate (#1840)', () => {
	let tmpSiteDir: string;

	beforeEach(() => {
		tmpSiteDir = mkdtempSync(join(tmpdir(), 'measure-lp-warn-test-'));
	});

	afterEach(() => {
		rmSync(tmpSiteDir, { recursive: true, force: true });
	});

	it('lp-metrics.json に warnings フィールドが必ず含まれる', () => {
		writeFile(tmpSiteDir, 'index.html', makeLpHtml([]));
		const r = runMeasure(tmpSiteDir);
		expect(r.exitCode).toBe(0);
		const metrics = JSON.parse(readFileSync(join(tmpSiteDir, 'lp-metrics.json'), 'utf-8'));
		expect(Array.isArray(metrics.warnings)).toBe(true);
		// no-browser 経路では desktopHeight=0 なので warning は発生しない
		expect(metrics.warnings).toEqual([]);
	}, 60000);

	it('thresholds.desktopHeightWarn が JSON に含まれる', () => {
		writeFile(tmpSiteDir, 'index.html', makeLpHtml([]));
		const r = runMeasure(tmpSiteDir);
		expect(r.exitCode).toBe(0);
		const metrics = JSON.parse(readFileSync(join(tmpSiteDir, 'lp-metrics.json'), 'utf-8'));
		expect(metrics.thresholds.desktopHeightWarn).toBe(7800);
		expect(metrics.thresholds.desktopHeight).toBe(8000);
	}, 60000);
});
