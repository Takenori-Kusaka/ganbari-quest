/**
 * axe-core Playwright runner (Issue #2692 AC3)
 *
 * 役割:
 *   - WCAG 2.2 AA 自動 audit (5 age mode × 5 step = 25 cycle)
 *   - 本 product 子供向け custom audit (tapSize per age = age-tier.ts SSOT 整合)
 *
 * SSOT:
 *   - src/lib/domain/validation/age-tier.ts AGE_TIER_CONFIG (tapSize: baby=120 / preschool=80 /
 *     elementary=56 / junior=48 / senior=44)
 *   - tmp/round18-parallel-path-first-review-plan-2026-05-30.md §4
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
