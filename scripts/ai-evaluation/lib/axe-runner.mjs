/**
 * axe-core inline runner (Issue #2692 / PR #2695 follow-up α)
 *
 * 役割:
 *   - WCAG 2.2 AA 自動 audit (5 age mode × 5 step = 25 cycle)
 *   - 本 product 子供向け custom audit (tapSize per age = age-tier.ts SSOT 整合)
 *
 * Mock mode (page._mockMode === true):
 *   - axe-core SDK load 回避
 *   - realistic dummy violations 5 件 (critical 1 / serious 2 / moderate 2)
 *   - tapSize 違反は MockStagehand.evaluate が dummy DOM を返すので runChildFriendlyAudit 共通
 *
 * SSOT:
 *   - src/lib/domain/validation/age-tier.ts AGE_TIER_CONFIG (tapSize: baby=120 / preschool=80 /
 *     elementary=56 / junior=48 / senior=44)
 *   - tmp/round18-parallel-path-first-review-plan-2026-05-30.md §4
 *   - tmp/stagehand-v3-migration-notes.md §大局的整理 (axe-core/playwright + Stagehand v3 型不整合)
 *
 * **v3 互換性 (#2695 follow-up α、本 file で完遂)**:
 *   旧来 `@axe-core/playwright::AxeBuilder` は `playwright-core` の `Page` 型を厳密要求 (`@axe-core/playwright/dist/index.d.ts` §2)。
 *   Stagehand v3 は内部 Playwright を廃止 (`understudy/Page`、CDP 直接接続) のため AxeBuilder は機能しない。
 *
 *   本 file では axe-core 公式 inline pattern (https://github.com/dequelabs/axe-core README §"Use axe to find accessibility issues"):
 *     1. `axe.source` (1.2MB JS source string) を `page.evaluate(<source string>)` で page context に inject
 *     2. `axe.run(options)` を `page.evaluate(fn, arg)` で実行し JSON 結果取得
 *
 *   v3 Page.evaluate signature (page.d.ts §276):
 *     `evaluate<R, Arg>(pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>), arg?: Arg): Promise<R>`
 *
 *   → string 形式 = expression として実行、function 形式 = stringify + Arg を JSON-serialize して page context に渡す。
 *      Playwright と signature 互換 (内部実装は CDP 直接) のため `@axe-core/playwright` の暗黙依存 (Page.frames() 等)
 *      を経由せず動作する。
 *
 * 検出対象:
 *   - critical / serious: 0 件達成必須
 *   - moderate: 列挙 (severity 2)
 *   - minor: 記録のみ (severity 1)
 *   - 子供向け固有: tapSize per age 違反
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @typedef {Object} AxeNode
 * @property {string[]} target
 * @property {string} html
 *
 * @typedef {Object} AxeViolation
 * @property {string} id
 * @property {string|null} impact  - 'critical' | 'serious' | 'moderate' | 'minor' | null
 * @property {string} description
 * @property {string} help
 * @property {string} helpUrl
 * @property {AxeNode[]} nodes
 *
 * @typedef {Object} AxeSummary
 * @property {number} critical
 * @property {number} serious
 * @property {number} moderate
 * @property {number} minor
 *
 * @typedef {Object} AxeAuditResult
 * @property {AxeViolation[]} violations
 * @property {number} critical
 * @property {number} serious
 * @property {number} moderate
 * @property {number} minor
 *
 * @typedef {Object} TapTarget
 * @property {string} tag
 * @property {number} w
 * @property {number} h
 * @property {string} [text]
 *
 * @typedef {Object} ChildFriendlyAuditResult
 * @property {number} expectedMin
 * @property {number} totalTargets
 * @property {TapTarget[]} violations
 *
 * @typedef {Object} StagehandV3Page
 *   v3 understudy/Page surface subset we depend on (page.d.ts §138 / §206 / §276 直読 SSOT).
 *   Mock mode では `_mockMode: true` + `evaluate(fn, arg)` のみで本 file は動作する。
 * @property {boolean} [_mockMode]
 * @property {(pageFunctionOrExpression: string | ((arg?: unknown) => unknown), arg?: unknown) => Promise<unknown>} evaluate
 */

/**
 * Mock axe violations (mock smoke test 用 realistic dummy、Issue #2692)
 *
 * 5 件 = critical 1 + serious 2 + moderate 2、Day 3 mock pipeline で structural test を埋める
 * realistic 度。実 Claude API call で意味ある数値になる metrics は別 thread。
 *
 * @type {AxeViolation[]}
 */
const MOCK_AXE_VIOLATIONS = [
	{
		id: 'color-contrast',
		impact: 'critical',
		description: 'Elements must have sufficient color contrast',
		help: 'Elements must have sufficient color contrast',
		helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
		nodes: [
			{
				target: ['.demo-only-notice'],
				html: '<div class="demo-only-notice">MOCK contrast violation</div>',
			},
		],
	},
	{
		id: 'label',
		impact: 'serious',
		description: 'Form elements must have labels',
		help: 'Form elements must have labels',
		helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/label',
		nodes: [{ target: ['input[name="search"]'], html: '<input type="search" name="search">' }],
	},
	{
		id: 'aria-required-attr',
		impact: 'serious',
		description: 'Required ARIA attributes must be provided',
		help: 'Required ARIA attributes must be provided',
		helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-attr',
		nodes: [{ target: ['[role="dialog"]'], html: '<div role="dialog">MOCK dialog</div>' }],
	},
	{
		id: 'heading-order',
		impact: 'moderate',
		description: 'Heading levels should only increase by one',
		help: 'Heading levels should only increase by one',
		helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/heading-order',
		nodes: [{ target: ['h4'], html: '<h4>MOCK heading skip</h4>' }],
	},
	{
		id: 'region',
		impact: 'moderate',
		description: 'All page content should be contained by landmarks',
		help: 'All page content should be contained by landmarks',
		helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/region',
		nodes: [{ target: ['.tour-card'], html: '<div class="tour-card">MOCK no landmark</div>' }],
	},
];

/**
 * age mode → 期待最小 tapSize (px)
 *
 * SSOT: src/lib/domain/validation/age-tier.ts AGE_TIER_CONFIG
 * (DESIGN.md §8 / §4 で同値定義済、本 file は POC 専用 mirror)
 *
 * @type {Record<'baby' | 'preschool' | 'elementary' | 'junior' | 'senior', number>}
 */
export const AGE_TAP_SIZE_MIN = {
	baby: 120,
	preschool: 80,
	elementary: 56,
	junior: 48,
	senior: 44, // Material Design 最小推奨
};

/**
 * axe-core (`axe.source` + `axe.run` ハンドル) を lazy import。
 * `@axe-core/playwright` ではなく axe-core 単体を使う点が #2695 follow-up α の核心。
 *
 * @returns {Promise<{ source: string }>}
 *   `source`: axe.min.js 全文 (1.2MB)、page.evaluate(<string expression>) で page context に inject
 *
 *   注: `axe.run` は inject 後の `window.axe.run(...)` を呼ぶため、ここでは source のみ返す。
 */
async function loadAxeSource() {
	try {
		// axe-core v4.x は CJS 設計 (package.json main='axe.js', module 指定なし)。
		// Node ESM の import() では namespace object に包まれ、`source` プロパティは default 配下に入る。
		// 互換性のため `mod.source` (古い ESM 互換用) → `mod.default.source` (CJS interop) の順で fallback。
		/** @type {any} */
		const mod = await import('axe-core');
		const cjsDefault = mod?.default;
		const source =
			typeof mod?.source === 'string'
				? mod.source
				: typeof cjsDefault?.source === 'string'
					? cjsDefault.source
					: null;
		if (!source) {
			throw new Error(
				`axe-core module loaded but \`source\` property missing on both mod and mod.default ` +
					`(mod keys sample: ${Object.keys(mod).slice(0, 5).join(',')}; default? ${!!cjsDefault})`,
			);
		}
		return { source };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(
			`axe-core load 失敗: ${msg}\n本 POC は npm install -D axe-core@^4.11 が前提です。`,
		);
	}
}

/**
 * axe-core source を page context に inject + `axe.run(opts)` を実行
 *
 * 公式 inline pattern (https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#section-3-API-Reference):
 *   1. `await page.evaluate(axe.source)` — page context に `window.axe` を定義
 *   2. `await page.evaluate(opts => window.axe.run(opts), runOptions)` — 結果 JSON 取得
 *
 * v3 Page.evaluate (page.d.ts §276) は string と function 両方受け付ける Playwright-style 互換 signature。
 * CDP 直接実装でも Playwright 暗黙依存 (frames() 等) を介在させない点が `@axe-core/playwright` との
 * 互換性破綻ポイント。本 file は v3 Page の `evaluate` 1 つだけ使うため依存最小。
 *
 * @param {StagehandV3Page} page
 * @param {Record<string, unknown>} runOptions  axe.run(options) に渡す runOptions
 * @returns {Promise<{ violations: AxeViolation[], passes: unknown[], incomplete: unknown[], url: string, timestamp: string }>}
 */
async function runAxeInPage(page, runOptions) {
	const { source } = await loadAxeSource();

	// Step 1: inject axe-core source (page context に window.axe を定義)
	await page.evaluate(source);

	// Step 2: axe.run を page context で実行 (Promise を返す関数を string 化 → evaluate)
	// 第 2 引数 (Arg) は JSON-serialize されて page context の fn 引数に渡る (v3 page.d.ts §276)
	// typedef の signature `(arg?: unknown) => unknown` に整合させるため、page context fn の引数は `unknown` で受ける
	/** @type {{ violations: AxeViolation[], passes: unknown[], incomplete: unknown[], url: string, timestamp: string }} */
	const results = /** @type {any} */ (
		await page.evaluate(
			/**
			 * @param {unknown} opts  axe.run(options) に渡る runOptions、page context 内では `Record<string, unknown>` として扱われる
			 * @returns {Promise<unknown>}
			 */
			(opts) => {
				// page context: window.axe は inject 済 (上記 evaluate(source))
				/** @type {{ run: (options: unknown) => Promise<unknown> }} */
				const axe = /** @type {any} */ (
					/** @type {{ axe?: unknown }} */ (/** @type {unknown} */ (globalThis)).axe
				);
				if (!axe || typeof axe.run !== 'function') {
					throw new Error('axe.source inject 失敗: window.axe.run が未定義');
				}
				return axe.run(opts);
			},
			runOptions,
		)
	);

	return results;
}

/**
 * 単一 page で axe-core WCAG 2.2 AA audit を実行 + JSON 出力
 *
 * @param {StagehandV3Page} page - Stagehand v3 understudy/Page (CDP 直接、Playwright 不使用)
 * @param {string} jsonPath - JSON 出力先 absolute path
 * @returns {Promise<AxeAuditResult>}
 */
export async function runAxeAudit(page, jsonPath) {
	// Mock mode: realistic dummy violations 5 件で structural test
	// strict `=== true` check: 実 understudy/Page で偶然 _mockMode が truthy になる事故を防ぐ
	if (page?._mockMode === true) {
		const summary = { critical: 1, serious: 2, moderate: 2, minor: 0 };
		await fs.mkdir(dirname(jsonPath), { recursive: true });
		await fs.writeFile(
			jsonPath,
			JSON.stringify(
				{
					url: '[MOCK] http://localhost:5180/mock',
					timestamp: new Date().toISOString(),
					summary,
					violations: MOCK_AXE_VIOLATIONS,
					passes_count: 42, // dummy
					_mock: true,
				},
				null,
				2,
			),
			'utf-8',
		);
		return { violations: MOCK_AXE_VIOLATIONS, ...summary };
	}

	// 実 mode: axe-core inline 実行 (#2695 follow-up α、@axe-core/playwright 撤去)
	const runOptions = {
		runOnly: {
			type: 'tag',
			values: ['wcag2a', 'wcag2aa', 'wcag22aa', 'best-practice'],
		},
	};
	const results = await runAxeInPage(page, runOptions);

	// category summary (DoR 12 整合)
	const summary = {
		critical: 0,
		serious: 0,
		moderate: 0,
		minor: 0,
	};
	for (const v of results.violations || []) {
		if (v.impact === 'critical') summary.critical++;
		else if (v.impact === 'serious') summary.serious++;
		else if (v.impact === 'moderate') summary.moderate++;
		else summary.minor++;
	}

	await fs.mkdir(dirname(jsonPath), { recursive: true });
	await fs.writeFile(
		jsonPath,
		JSON.stringify(
			{
				url: results.url,
				timestamp: results.timestamp,
				summary,
				violations: results.violations,
				passes_count: Array.isArray(results.passes) ? results.passes.length : 0,
			},
			null,
			2,
		),
		'utf-8',
	);

	return { violations: results.violations || [], ...summary };
}

/**
 * 子供向け固有 audit: button / a / [role="button"] の tapSize per age 違反検出
 *
 * v3 互換: `page.$$eval` は understudy/Page に存在しないため `page.evaluate(fn)` 経由で全要素列挙する。
 * Mock mode では `_mockMode: true` の page が dummy tap target 配列を直接返す形に統一済
 * (`stagehand-runner.mjs` mockPage.$$eval / mockPage.evaluate どちらも互換維持)。
 *
 * @param {StagehandV3Page & { $$eval?: (selector: string, fn: (els: Element[]) => TapTarget[]) => Promise<TapTarget[]> }} page
 * @param {keyof typeof AGE_TAP_SIZE_MIN} ageMode - 'baby' | 'preschool' | ...
 * @returns {Promise<ChildFriendlyAuditResult>}
 */
export async function runChildFriendlyAudit(page, ageMode) {
	const expectedMin = AGE_TAP_SIZE_MIN[ageMode];
	if (!expectedMin) throw new Error(`Unknown ageMode: ${ageMode}`);

	/** @type {TapTarget[]} */
	let targets;
	if (page?._mockMode === true && typeof page.$$eval === 'function') {
		// Mock 後方互換: stagehand-runner.mjs mockPage が dummy 配列を返す
		targets = /** @type {TapTarget[]} */ (
			await page.$$eval('button, a, [role="button"], [role="link"]', () => [])
		);
	} else {
		// 実 mode: v3 Page.evaluate(fn) で page context 内で DOM 抽出
		targets = /** @type {TapTarget[]} */ (
			await page.evaluate(() => {
				/** @type {NodeListOf<Element>} */
				const els = document.querySelectorAll('button, a, [role="button"], [role="link"]');
				return Array.from(els).map((el) => {
					const rect = el.getBoundingClientRect();
					return {
						tag: el.tagName.toLowerCase(),
						w: Math.round(rect.width),
						h: Math.round(rect.height),
						text: (el.textContent || '').trim().slice(0, 40),
					};
				});
			})
		);
	}

	// visible target のみ判定 (display: none / hidden は除外)
	const visible = targets.filter((t) => t.w > 0 && t.h > 0);
	const violations = visible.filter((t) => t.w < expectedMin || t.h < expectedMin);

	return {
		expectedMin,
		totalTargets: visible.length,
		violations,
	};
}

/**
 * axe-core + 子供向け custom audit を統合実行 (Issue #2692 AC3 用)
 *
 * @param {{ page: StagehandV3Page & { $$eval?: any }, ageMode: keyof typeof AGE_TAP_SIZE_MIN, axeJsonPath: string }} opts
 * @returns {Promise<{ axe: AxeAuditResult, childFriendly: ChildFriendlyAuditResult }>}
 */
export async function runFullAudit({ page, ageMode, axeJsonPath }) {
	const axe = await runAxeAudit(page, axeJsonPath);
	const childFriendly = await runChildFriendlyAudit(page, ageMode);
	return { axe, childFriendly };
}
