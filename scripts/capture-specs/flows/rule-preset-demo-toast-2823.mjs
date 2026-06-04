/**
 * scripts/capture-specs/flows/rule-preset-demo-toast-2823.mjs
 *
 * PR #2823: rule-preset 取込が demo 環境で無言だった問題の before/after SS。
 *
 * 撮影目的 (/admin/settings/rules?import=<presetId> に遷移 → hidden form auto-submit):
 *   - 修正前 (origin/main build, SS_PHASE=before): demo write-guard no-op が form-result
 *     effect の `presetId` 必須分岐に当たらず toast が一切出ない (無言)
 *   - 修正後 (本 PR build, SS_PHASE=after): `form.demo === true` 分岐で
 *     「デモではお試し用です（実際の追加は行われません）」toast が表示される
 *     (activity / reward / challenge / checklist と同文言、5 type 統一)
 *
 * 使用例 (demo 環境 preview を別途起動してから):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5180 \
 *     node scripts/capture.mjs \
 *     --flow rule-preset-demo-toast-2823 \
 *     --url /admin/settings/rules?import=early-bird \
 *     --actions scripts/capture-specs/flows/rule-preset-demo-toast-2823.mjs \
 *     --presets mobile,desktop --pr 2823
 */

import { mkdirSync, writeFileSync } from 'node:fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180';
const DOM_OUT_DIR = process.env.DOM_OUT_DIR || 'tmp/screenshots/pr-2823-dom';
// before/after を SS ラベルで区別する (修正前 = origin/main build で SS_PHASE=before)
const PHASE = process.env.SS_PHASE || 'after';

// demo seed に存在する bonus type の rule-preset (/admin/settings/rules で取込可能)。
const RULE_PRESET_ID = process.env.RULE_PRESET_ID || 'early-bird';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	mkdirSync(DOM_OUT_DIR, { recursive: true });
	const dumpDom = async (/** @type {string} */ label) => {
		const html = await page.evaluate(() => document.documentElement.outerHTML);
		writeFileSync(`${DOM_OUT_DIR}/${label}.dom.html`, html, 'utf-8');
	};

	const rafSettle = () =>
		page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);

	// `?import=<presetId>` に遷移すると hidden form が auto-submit され、demo write-guard が
	// {demo:true, imported:0} を返す。修正後はここで「デモではお試し用」toast が出る。
	// Toast は ~3s で自動消滅するため、表示を待ってから即座に capture する (rafSettle のみ、
	// 追加 sleep なし)。修正前 (origin/main) は toast が出ないため waitFor が timeout し、
	// before SS は無言状態を撮る (catch で握りつぶす)。
	await page.goto(`${BASE_URL}/admin/settings/rules?import=${RULE_PRESET_ID}`);
	const toast = page.locator('text=デモではお試し用');
	await toast.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
	await rafSettle();
	// DOM dump は toast 消滅前に確実に取る (SS の証跡補強)。
	await dumpDom(`${PHASE}-rules-import-demo`);
	await capture(`pr2823-${PHASE}-rules-import-demo`);
};
