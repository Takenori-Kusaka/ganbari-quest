#!/usr/bin/env node
// Capture LP tour-shot / core-loop-visual screenshots for #1284 (#1296 PR)
// Usage: node scripts/capture-1284-tour-shot.mjs
// Expects static server at http://localhost:8088 (serve ./site/)

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8088';
const OUTPUT_DIR = path.resolve('docs/screenshots/1284-lp-tour-clipping-fix');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const targets = [
	{ name: 'core-loop', selector: '.core-loop-visual', padY: 80 },
	{ name: 'machine-tour', selector: '.machine-tour', padY: 40 },
];

async function capture(page, viewport, viewportName) {
	await page.setViewportSize(viewport);
	await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
	await page.evaluate(
		() =>
			new Promise((resolve) => {
				const done = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
				if (document.fonts?.ready) {
					document.fonts.ready.then(done);
				} else {
					done();
				}
			}),
	);

	for (const { name, selector } of targets) {
		const el = await page.$(selector);
		if (!el) {
			console.warn(`[skip] ${selector} not found at ${viewportName}`);
			continue;
		}
		await el.scrollIntoViewIfNeeded();
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
				),
		);
		const outPath = path.join(OUTPUT_DIR, `${name}-${viewportName}.png`);
		await el.screenshot({ path: outPath });
		console.log(`[ok] ${outPath}`);
	}
}

async function main() {
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ deviceScaleFactor: 2 });
	const page = await ctx.newPage();

	await capture(page, MOBILE, 'mobile');
	await capture(page, DESKTOP, 'desktop');

	await browser.close();
	console.log('done.');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
