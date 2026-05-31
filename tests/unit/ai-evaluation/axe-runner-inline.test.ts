/**
 * axe-runner inline implementation test (PR #2695 follow-up α / Issue #2692)
 *
 * 目的:
 *   旧 `@axe-core/playwright` 撤去 + axe-core inline 実行 (axe.source + page.evaluate)
 *   への切替が Stagehand v3 understudy/Page と互換であることを CI で機械的に検証する。
 *
 * 検証範囲:
 *   1. axe-core module の `source` 属性 (1.2MB JS string) が公式 inline pattern で利用可能
 *   2. runAxeAudit 実 mode が v3 Page.evaluate(string) → axe.source inject + axe.run の 2 phase を踏む
 *   3. runChildFriendlyAudit が v3 Page.evaluate(fn) 経由で DOM 抽出 (旧 $$eval 不使用)
 *   4. anti-regression: scripts/ai-evaluation 配下に `@axe-core/playwright` import が残っていない
 *   5. anti-regression: AxeBuilder pattern (`new AxeBuilder(...)`) が残っていない
 *
 * SSOT:
 *   - axe-core README §"Use axe to find accessibility issues"
 *     (https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)
 *   - Stagehand v3 page.d.ts §276 (`evaluate<R, Arg>(pageFunctionOrExpression: string | fn, arg?: Arg)`)
 *   - tmp/stagehand-v3-migration-notes.md §大局的整理 (@axe-core/playwright + v3 型不整合)
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * .mjs file dynamic import で TypeScript 型推論が effectively any になるため、
 * 受け側に narrow type を付ける。`runtime invariant` は vitest assertion で担保する。
 */
type AxeRunnerModule = {
	runAxeAudit: (
		page: { _mockMode?: boolean; evaluate?: (fn: unknown, arg?: unknown) => Promise<unknown> },
		jsonPath: string,
	) => Promise<{
		violations: Array<{ id: string; impact: string | null }>;
		critical: number;
		serious: number;
		moderate: number;
		minor: number;
	}>;
	runChildFriendlyAudit: (
		page: {
			_mockMode?: boolean;
			evaluate?: (fn: unknown, arg?: unknown) => Promise<unknown>;
			$$eval?: (sel: string, fn: unknown) => Promise<unknown[]>;
		},
		ageMode: 'baby' | 'preschool' | 'elementary' | 'junior' | 'senior',
	) => Promise<{ expectedMin: number; totalTargets: number; violations: unknown[] }>;
	AGE_TAP_SIZE_MIN: Record<'baby' | 'preschool' | 'elementary' | 'junior' | 'senior', number>;
};

async function loadAxeRunner(): Promise<AxeRunnerModule> {
	// @ts-expect-error — .mjs file dynamic import (TypeScript は型解決できないが runtime invariant は assert で担保)
	return import('../../../scripts/ai-evaluation/lib/axe-runner.mjs');
}

describe('axe-core source attribute (inline injection 基盤)', () => {
	it('axe-core module exports source as non-empty string (>= 100KB)', async () => {
		const axe = await import('axe-core');
		expect(typeof axe.source).toBe('string');
		// minified axe.js は ~1.2MB、最低 100KB の sanity check
		expect(axe.source.length).toBeGreaterThan(100_000);
		// IIFE / function を含む有効な JS source であること
		expect(axe.source).toMatch(/function|=>/);
	});

	it('axe-core module exports run function', async () => {
		const axe = await import('axe-core');
		expect(typeof axe.run).toBe('function');
	});
});

describe('runAxeAudit 実 mode — v3 Page.evaluate 経由で axe.source inject + axe.run', () => {
	it('Stagehand v3 page (evaluate のみ持つ Mock) で axe-core inline 動作', async () => {
		const { runAxeAudit } = await loadAxeRunner();

		/**
		 * inject + run の 2 phase を spy で記録する Stagehand v3 風 Mock page。
		 * - 1 回目 evaluate(string): axe.source を文字列として受け取り、page context に inject (扱いは記録のみ)
		 * - 2 回目 evaluate(fn, opts): function を受け取り、内部で window.axe.run を呼ぶことを期待。
		 *   ここでは fn を直接呼び出さず、axe.run の戻り値相当の dummy result を返す。
		 */
		const evalCalls: Array<{ type: 'string' | 'function'; argType: string }> = [];
		const mockPage = {
			// _mockMode は **false** にする (実 mode path をテストするため)
			async evaluate(fnOrExpr: unknown, arg?: unknown): Promise<unknown> {
				if (typeof fnOrExpr === 'string') {
					evalCalls.push({ type: 'string', argType: 'none' });
					return undefined; // axe.source inject phase
				}
				if (typeof fnOrExpr === 'function') {
					evalCalls.push({ type: 'function', argType: typeof arg });
					// axe.run 戻り値相当の dummy
					return {
						violations: [
							{
								id: 'color-contrast',
								impact: 'critical',
								description: 'dummy',
								help: 'dummy',
								helpUrl: 'https://example.com',
								nodes: [{ target: ['.x'], html: '<div class="x"/>' }],
							},
							{
								id: 'label',
								impact: 'serious',
								description: 'dummy',
								help: 'dummy',
								helpUrl: 'https://example.com',
								nodes: [{ target: ['input'], html: '<input/>' }],
							},
						],
						passes: [{ id: 'dummy-pass' }],
						incomplete: [],
						url: 'http://localhost:5180/test',
						timestamp: '2026-05-31T00:00:00.000Z',
					};
				}
				throw new Error('unexpected evaluate argument type');
			},
		};

		const tmp = await mkdtemp(join(tmpdir(), 'axe-inline-test-'));
		try {
			const jsonPath = join(tmp, 'axe-real.json');
			const result = await runAxeAudit(mockPage, jsonPath);

			// 2 phase 呼出を確認 (axe.source inject + axe.run)
			expect(evalCalls).toHaveLength(2);
			const [call0, call1] = evalCalls;
			expect(call0).toBeDefined();
			expect(call1).toBeDefined();
			if (!call0 || !call1) throw new Error('unreachable: toHaveLength(2) guard 後');
			expect(call0.type).toBe('string'); // axe.source string injection
			expect(call1.type).toBe('function'); // axe.run wrapper function
			expect(call1.argType).toBe('object'); // runOptions object

			// summary 集計
			expect(result.critical).toBe(1);
			expect(result.serious).toBe(1);
			expect(result.moderate).toBe(0);
			expect(result.violations).toHaveLength(2);

			// JSON 出力検証
			const json = JSON.parse(await readFile(jsonPath, 'utf-8'));
			expect(json.url).toBe('http://localhost:5180/test');
			expect(json.summary.critical).toBe(1);
			expect(json.passes_count).toBe(1);
		} finally {
			await rm(tmp, { recursive: true, force: true });
		}
	});

	it('axe inject 失敗 (window.axe.run 未定義) は error を throw する page context fn を持つ', async () => {
		// 実装内部の page.evaluate(fn, opts) 関数が window.axe.run 未定義時に throw する仕様の構造確認。
		// 直接 page context を再現は困難なので、runAxeAudit が fn を string 化し evaluate に渡すこと、
		// その fn 内に "window.axe.run が未定義" guard 文字列が含まれることを source レベルで assert。
		const src = await readFile(resolve('scripts/ai-evaluation/lib/axe-runner.mjs'), 'utf-8');
		expect(src).toContain('axe.source inject 失敗');
		// guard 文字列: `typeof axe.run !== 'function'` を含むこと (window.axe.run 未定義検出)
		expect(src).toMatch(/typeof\s+axe\.run\s*!==?\s*['"]function['"]/);
	});
});

describe('runChildFriendlyAudit — v3 Page.evaluate(fn) 経由 (旧 $$eval 撤去)', () => {
	it('実 mode (mockMode 不設定) で page.evaluate(fn) 経由 DOM 抽出', async () => {
		const { runChildFriendlyAudit } = await loadAxeRunner();

		let evaluateCalled = false;
		const mockPage = {
			// _mockMode は付けない (実 mode 経路をテスト)
			async evaluate(fnOrExpr: unknown): Promise<unknown> {
				evaluateCalled = true;
				expect(typeof fnOrExpr).toBe('function'); // string ではなく function form を期待
				// dummy tap target 配列 (page context で document.querySelectorAll の戻り値相当)
				return [
					{ tag: 'button', w: 64, h: 64, text: 'OK' }, // 違反 (senior=44 はクリア、baby=120 で違反)
					{ tag: 'a', w: 200, h: 32, text: 'リンク' }, // 違反 (h=32 < 44)
				];
			},
		};
		const result = await runChildFriendlyAudit(mockPage, 'senior');
		expect(evaluateCalled).toBe(true);
		expect(result.expectedMin).toBe(44);
		expect(result.totalTargets).toBe(2);
		expect(result.violations).toHaveLength(1); // h=32 のみ違反
	});

	it('Mock mode (page._mockMode=true) は $$eval 経由 (後方互換維持)', async () => {
		const { runChildFriendlyAudit } = await loadAxeRunner();

		let dollarEvalCalled = false;
		const mockPage = {
			_mockMode: true,
			async $$eval(_sel: string, _fn: unknown): Promise<unknown[]> {
				dollarEvalCalled = true;
				return [
					{ tag: 'button', w: 64, h: 64, text: 'OK' },
					{ tag: 'a', w: 200, h: 56, text: 'リンク' }, // OK (h=56 > 44)
				];
			},
		};
		const result = await runChildFriendlyAudit(mockPage, 'senior');
		// Mock 経路で $$eval が呼ばれた事を確認 (実 mode の evaluate(fn) ではなく)
		expect(dollarEvalCalled).toBe(true);
		expect(result.expectedMin).toBe(44);
	});
});

describe('Anti-regression — @axe-core/playwright / AxeBuilder pattern 撤去確認', () => {
	it('scripts/ai-evaluation 配下に @axe-core/playwright import が残っていない', async () => {
		const dirs = ['scripts/ai-evaluation', 'scripts/ai-evaluation/lib'];
		const offenders: string[] = [];
		for (const d of dirs) {
			const entries = await readdir(resolve(d), { withFileTypes: true });
			for (const ent of entries) {
				if (!ent.isFile()) continue;
				if (!/\.(mjs|js|ts)$/.test(ent.name)) continue;
				const src = await readFile(resolve(d, ent.name), 'utf-8');
				// import / require / from 形式すべて
				if (/['"]@axe-core\/playwright['"]/.test(src)) {
					offenders.push(`${d}/${ent.name}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it('scripts/ai-evaluation 配下に AxeBuilder の new コンストラクタ呼出が残っていない', async () => {
		const dirs = ['scripts/ai-evaluation', 'scripts/ai-evaluation/lib'];
		const offenders: string[] = [];
		for (const d of dirs) {
			const entries = await readdir(resolve(d), { withFileTypes: true });
			for (const ent of entries) {
				if (!ent.isFile()) continue;
				if (!/\.(mjs|js|ts)$/.test(ent.name)) continue;
				const src = await readFile(resolve(d, ent.name), 'utf-8');
				// `new AxeBuilder(...)` の発見 (`identifier-AxeBuilder` 内含む historical comment は除外)
				if (/new\s+AxeBuilder\s*\(/.test(src)) {
					offenders.push(`${d}/${ent.name}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it('package.json devDependencies に @axe-core/playwright が無い', async () => {
		const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf-8')) as {
			devDependencies?: Record<string, string>;
			dependencies?: Record<string, string>;
		};
		expect(pkg.devDependencies?.['@axe-core/playwright']).toBeUndefined();
		expect(pkg.dependencies?.['@axe-core/playwright']).toBeUndefined();
	});

	it('package.json devDependencies に axe-core が直接登録されている', async () => {
		const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf-8')) as {
			devDependencies?: Record<string, string>;
		};
		expect(pkg.devDependencies?.['axe-core']).toBeDefined();
	});
});
