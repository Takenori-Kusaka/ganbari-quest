/**
 * scripts/capture-specs/flows/lp-floating-cta-1732.mjs (#1732)
 *
 * site/index.html の floating-cta（モバイル下部追従 CTA）を hero / mid / bottom の
 * 3 phase でスクロールしながら撮影する flow。--server-mode lp で動作。
 *
 * 使用例:
 *   node scripts/capture.mjs \
 *     --flow lp-floating-cta-1732 \
 *     --url /index.html \
 *     --actions scripts/capture-specs/flows/lp-floating-cta-1732.mjs \
 *     --server-mode lp \
 *     --presets desktop,mobile \
 *     --out docs/screenshots/pr-1732/
 *
 * 各 viewport で 3 SS（hero / mid / bottom）合計 6 SS を生成。
 * desktop 1280 では floating-cta は CSS で hidden だが、撮影自体は viewport 全体を
 * 撮るため「floating-cta が hidden で hero CTA だけ見える」状態の比較用となる。
 */

import fs from 'node:fs';
import path from 'node:path';
import { waitForStablePage } from '../../lib/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5280';

/**
 * docHeight の % 地点までスクロールし、floating-cta phase 切替を待つ。
 * @param {import('playwright').Page} page
 * @param {number} percent 0-100
 */
async function scrollToPercent(page, percent) {
	await page.evaluate((p) => {
		const docH = document.documentElement.scrollHeight || document.body.scrollHeight;
		const winH = window.innerHeight;
		const maxScroll = Math.max(1, docH - winH);
		const target = Math.floor((maxScroll * p) / 100);
		window.scrollTo({ top: target, behavior: 'instant' });
	}, percent);
	// rAF + reflow 安定化（fade transition .2s 完了を待つ）
	await waitForStablePage(page, { skipNetworkIdle: true });
}

/**
 * floating-cta 要素の outerHTML + 親 DOM スナップショットを記録する。
 * #1747 AC4 / #1766 「SS と DOM の同一性保証」原則に準拠し、撮影と同じ Playwright page から
 * floating-cta 周辺の DOM を抜き出して `*-dom.html` として保存する。
 * @param {import('playwright').Page} page
 * @param {string} pngPath
 */
async function saveFloatingCtaDom(page, pngPath) {
	const snapshot = await page.evaluate(() => {
		const el = document.getElementById('floating-cta');
		if (!el) return '<!-- floating-cta element not found -->';
		const phase = el.getAttribute('data-floating-cta-phase') || '';
		const visible = el.classList.contains('visible');
		const text = document.getElementById('floating-cta-text')?.outerHTML || '';
		const btn = document.getElementById('floating-cta-button')?.outerHTML || '';
		return [
			`<!-- floating-cta DOM snapshot -->`,
			`<!-- phase=${phase} visible=${visible} scrollY=${window.scrollY} docH=${document.documentElement.scrollHeight} -->`,
			el.outerHTML,
			'',
			'<!-- inner text element -->',
			text,
			'',
			'<!-- inner button element -->',
			btn,
		].join('\n');
	});
	const domPath = pngPath.replace(/\.png$/, '.dom.html');
	fs.mkdirSync(path.dirname(domPath), { recursive: true });
	fs.writeFileSync(domPath, snapshot, 'utf-8');
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
	await page.locator('body').waitFor({ state: 'visible', timeout: 15_000 });
	// applyLpKeys() / floating-cta scroll listener の初期化を待つ
	await waitForStablePage(page);

	// 1. hero phase (10% 地点 — SHOW_AFTER_PX 500px を超え、MID_START_PERCENT 30 未満)
	await scrollToPercent(page, 10);
	const heroPng = await capture('floating-cta-01-hero');
	await saveFloatingCtaDom(page, heroPng);

	// 2. mid phase (50% 地点 — MID_START_PERCENT 30 以上、BOTTOM_START_PERCENT 70 未満)
	await scrollToPercent(page, 50);
	const midPng = await capture('floating-cta-02-mid');
	await saveFloatingCtaDom(page, midPng);

	// 3. bottom phase (75% 地点 — BOTTOM_START_PERCENT 70 以上、HIDE_BEFORE_FOOTER 200px の手前)
	await scrollToPercent(page, 75);
	const bottomPng = await capture('floating-cta-03-bottom');
	await saveFloatingCtaDom(page, bottomPng);
};
