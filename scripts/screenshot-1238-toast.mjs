#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

async function waitForFonts(page) {
	await page.evaluate(
		() =>
			new Promise((resolve) => {
				const finish = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
				if (document.fonts?.ready) document.fonts.ready.then(finish);
				else finish();
			}),
	);
}

const BASE = process.env.BASE_URL || 'http://localhost:5175';
const OUT = path.resolve('docs/screenshots/1238-toast-primitive');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
	const browser = await chromium.launch({ headless: true });
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2,
	});
	const page = await ctx.newPage();

	// 1. demo/admin/license で「購入」ボタン押下 → Toast primitive で表示される
	await page.goto(`${BASE}/demo/admin/license`, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.waitForSelector('[data-testid="demo-license-page"][data-hydrated="true"]', {
		state: 'visible',
		timeout: 20000,
	});
	await waitForFonts(page);

	const checkoutBtn = page.getByTestId('demo-checkout-button');
	await checkoutBtn.scrollIntoViewIfNeeded();
	await page.screenshot({
		path: path.join(OUT, '01-demo-license-before.png'),
		fullPage: false,
	});

	// Scroll to top BEFORE click so the fixed-top toast is visible
	await page.evaluate(() => window.scrollTo(0, 0));
	// Re-locate the button (it's at bottom but scrollIntoView behavior can be controlled via click)
	await checkoutBtn.click();
	// Immediately after click, toast should appear at top
	const toast = page.getByRole('alert').filter({ hasText: 'デモでは実際の操作はできません' });
	await toast.waitFor({ state: 'visible', timeout: 5000 });
	// Scroll back to top if the click caused scroll
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({
		path: path.join(OUT, '02-demo-license-toast-primitive.png'),
		fullPage: false,
	});
	console.info('[OK] demo/admin/license Toast captured');

	// 3. Clean Storybook shot (no demo banner stack) to show primitive in isolation
	const sbBase = process.env.STORYBOOK_URL || 'http://localhost:6006';
	try {
		await page.goto(`${sbBase}/iframe.html?id=primitives-toast--info&viewMode=story`, {
			waitUntil: 'domcontentloaded',
			timeout: 10000,
		});
		const button = page.getByRole('button', { name: /お知らせ/ });
		await button.waitFor({ state: 'visible', timeout: 5000 });
		await button.click();
		await page.waitForSelector('[role="alert"]', { state: 'visible', timeout: 3000 });
		await waitForFonts(page);
		await page.screenshot({
			path: path.join(OUT, '03-storybook-toast-info.png'),
			fullPage: false,
		});
		console.info('[OK] Storybook Toast captured');
	} catch (err) {
		console.warn('[WARN] Storybook not available, skipping clean shot:', err.message);
	}

	await ctx.close();
	await browser.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
