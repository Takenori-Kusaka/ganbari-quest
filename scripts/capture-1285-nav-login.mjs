#!/usr/bin/env node
// Capture LP header nav screenshots for #1285 (#1297 PR)
// Usage: node scripts/capture-1285-nav-login.mjs
// Expects static server at http://localhost:8088 (serve ./site/)

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8088';
const OUTPUT_DIR = path.resolve('docs/screenshots/1285-lp-nav-login-ghost');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function waitStable(page) {
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
}

async function captureHeader(page, viewport, url, outName, openHamburger = false) {
	await page.setViewportSize(viewport);
	await page.goto(`${BASE_URL}${url}`, { waitUntil: 'networkidle' });
	await waitStable(page);

	if (openHamburger) {
		const toggle = await page.$(
			'.nav-toggle, [data-testid="nav-toggle"], button[aria-label*="メニュー"]',
		);
		if (toggle) {
			await toggle.click();
			await waitStable(page);
		} else {
			console.warn(`[warn] hamburger button not found at ${viewport.width}x${viewport.height}`);
		}
	}

	// Capture the top portion of the page (header area).
	const clipHeight = openHamburger ? Math.min(viewport.height, 560) : 180;
	const outPath = path.join(OUTPUT_DIR, `${outName}.png`);
	await page.screenshot({
		path: outPath,
		clip: { x: 0, y: 0, width: viewport.width, height: clipHeight },
	});
	console.log(`[ok] ${outPath}`);
}

async function main() {
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ deviceScaleFactor: 2 });
	const page = await ctx.newPage();

	await captureHeader(page, DESKTOP, '/index.html', 'index-desktop-header');
	await captureHeader(page, MOBILE, '/index.html', 'index-mobile-header', true);
	await captureHeader(page, DESKTOP, '/selfhost.html', 'selfhost-desktop-header');

	await browser.close();
	console.log('done.');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
