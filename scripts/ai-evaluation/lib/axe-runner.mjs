// @ts-nocheck — Pre-PMF POC: .mjs jsdoc 型整備は別 follow-up Issue (#2695 scope 外)
/**
 * axe-core Playwright runner (Issue #2692 AC3)
 *
 * 役割:
 *   - WCAG 2.2 AA 自動 audit (5 age mode × 5 step = 25 cycle)
 *   - 本 product 子供向け custom audit (tapSize per age = age-tier.ts SSOT 整合)
 *
 * Mock mode (page._mockMode === true):
 *   - axe-core SDK load 回避
 *   - realistic dummy violations 5 件 (critical 1 / serious 2 / moderate 2)
 *   - tapSize 違反は MockStagehand.$$eval が dummy DOM を返すので runChildFriendlyAudit 共通
 *
 * SSOT:
 *   - src/lib/domain/validation/age-tier.ts AGE_TIER_CONFIG (tapSize: baby=120 / preschool=80 /
 *     elementary=56 / junior=48 / senior=44)
 *   - tmp/round18-parallel-path-first-review-plan-2026-05-30.md §4
 *   - tmp/stagehand-v3-migration-notes.md §大局的整理 (axe-core/playwright + Stagehand v3 型不整合)
 *
 * **v3 互換性警告 (PR #2695 Day 3 真因解消、honest path)**:
 *   - `@axe-core/playwright` の `AxeBuilder` は `playwright-core` の `Page` 型を厳密要求
 *   - Stagehand v3 は内部 Playwright 利用を廃止 (`understudy/Page`、CDP 直接接続)
 *   - 型不互換 + runtime も Playwright API でないため、実 mode で `AxeBuilder({ page: stagehand.context.activePage() })` は機能しない可能性が高い
 *   - **本 PR では実 mode を一時 SKIP** (TODO 明示 + warning)、Mock mode のみ pipeline 健全性を担保
 *   - 後続: axe-core 自体を `(await activePage()).evaluate()` 経由で inline 実行する方式に書き直す (別 follow-up Issue)
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
 * Mock axe violations (mock smoke test 用 realistic dummy、Issue #2692)
 *
 * 5 件 = critical 1 + serious 2 + moderate 2、Day 3 mock pipeline で structural test を埋める
 * realistic 度。実 Claude API call で意味ある数値になる metrics は別 thread。
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
 */
export const AGE_TAP_SIZE_MIN = {
	baby: 120,
	preschool: 80,
	elementary: 56,
	junior: 48,
	senior: 44, // Material Design 最小推奨
};

/**
 * @axe-core/playwright を lazy import
 */
async function loadAxeBuilder() {
	try {
		const mod = await import('@axe-core/playwright');
		return mod.default || mod.AxeBuilder;
	} catch (err) {
		throw new Error(
			`@axe-core/playwright load 失敗: ${err.message}\n` +
				`本 POC は npm install -D @axe-core/playwright@^4.11 が前提です。`,
		);
	}
}

/**
 * 単一 page で axe-core WCAG 2.2 AA audit を実行 + JSON 出力
 *
 * @param {Page} page - Playwright Page instance (Stagehand.page 含む)
 * @param {string} jsonPath - JSON 出力先 absolute path
 * @returns {Promise<{ violations: any[], critical: number, serious: number, moderate: number, minor: number }>}
 */
export async function runAxeAudit(page, jsonPath) {
	// Mock mode: realistic dummy violations 5 件で structural test
	if (page?._mockMode) {
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

	// v3 互換性警告: Stagehand v3 Page (understudy/Page) は playwright-core Page と型不互換。
	// 実 mode で AxeBuilder が機能しない可能性があるため、warning を残しつつ best-effort 実行。
	// 失敗時は呼出元の try/catch で吸収される (run-poc.mjs の axe step catch 経路)。
	if (
		page &&
		!page._mockMode &&
		typeof page.context !== 'function' &&
		page.constructor?.name === 'Page'
	) {
		// Stagehand v3 understudy/Page は context() メソッド/プロパティが Playwright Page と異なる
		console.warn(
			'[axe-runner] WARN: Stagehand v3 Page と @axe-core/playwright は型不整合。' +
				' 実 mode の axe-core 実行は後続 Issue で `evaluate()` 経由 inline 実装に書換予定。',
		);
	}
	const AxeBuilder = await loadAxeBuilder();
	const results = await new AxeBuilder({ page }).withTags(['wcag22aa', 'best-practice']).analyze();

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
				passes_count: results.passes?.length || 0,
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
 * @param {Page} page - Playwright Page instance
 * @param {keyof typeof AGE_TAP_SIZE_MIN} ageMode - 'baby' | 'preschool' | ...
 * @returns {Promise<{ expectedMin: number, totalTargets: number, violations: Array<{tag, w, h, text?}> }>}
 */
export async function runChildFriendlyAudit(page, ageMode) {
	const expectedMin = AGE_TAP_SIZE_MIN[ageMode];
	if (!expectedMin) throw new Error(`Unknown ageMode: ${ageMode}`);

	// 全 tap target を DOM から抽出 (text 短縮で IDOR / 個人情報露出回避)
	const targets = await page.$$eval('button, a, [role="button"], [role="link"]', (els) =>
		els.map((el) => {
			const rect = el.getBoundingClientRect();
			return {
				tag: el.tagName.toLowerCase(),
				w: Math.round(rect.width),
				h: Math.round(rect.height),
				text: (el.textContent || '').trim().slice(0, 40),
			};
		}),
	);

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
 */
export async function runFullAudit({ page, ageMode, axeJsonPath }) {
	const axe = await runAxeAudit(page, axeJsonPath);
	const childFriendly = await runChildFriendlyAudit(page, ageMode);
	return { axe, childFriendly };
}
