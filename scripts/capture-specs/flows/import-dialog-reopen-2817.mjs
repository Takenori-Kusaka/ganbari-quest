/**
 * scripts/capture-specs/flows/import-dialog-reopen-2817.mjs
 *
 * PR #2817: per-child 取込 ChildSelectionDialog の確定後挙動 SS。
 *
 * 撮影目的:
 *   - dialog-open: `?import=<presetId>` で ChildSelectionDialog auto-open した状態
 *   - after-confirm: 確定 click 後の状態
 *     - 修正前 (origin/main): dialog が再 open して開いたまま (dead-end)
 *     - 修正後 (本 PR): dialog が閉じ「デモではお試し用です」message が表示される
 *
 * 使用例 (demo 環境 preview を別途起動してから):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5180 \
 *     node scripts/capture.mjs \
 *     --flow import-dialog-reopen-2817 \
 *     --url /admin/activities?import=kinder-starter \
 *     --actions scripts/capture-specs/flows/import-dialog-reopen-2817.mjs \
 *     --presets mobile,desktop --pr 2817
 */

import { mkdirSync, writeFileSync } from 'node:fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5180';
const DOM_OUT_DIR = process.env.DOM_OUT_DIR || 'tmp/screenshots/pr-2817-dom';
// before/after を SS ラベルで区別する (修正前 = origin/main build で SS_PHASE=before)
const PHASE = process.env.SS_PHASE || 'after';

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

	// --- 1) dialog auto-open 状態 ---
	await page.goto(`${BASE_URL}/admin/activities?import=kinder-starter`);
	const confirm = page.locator('[data-testid="child-selection-confirm"]');
	await confirm.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
	await rafSettle();
	await capture(`pr2817-${PHASE}-dialog-open`);
	await dumpDom(`${PHASE}-dialog-open`);

	// --- 2) 確定 click 後の状態 (修正前: dialog 開いたまま / 修正後: 閉じて demo message) ---
	await confirm.click().catch(() => {});
	// 結果が安定するまで feedback message or dialog 状態変化を待つ (両分岐を許容)
	await page
		.locator('text=デモではお試し用')
		.waitFor({ state: 'visible', timeout: 10_000 })
		.catch(() => {});
	await rafSettle();
	await capture(`pr2817-${PHASE}-after-confirm`);
	await dumpDom(`${PHASE}-after-confirm`);
};
