#!/usr/bin/env node
/**
 * scripts/demo-review-screenshots.mjs (#563)
 *
 * Playwright でガイドツアーの全ステップをスクリーンショットとして取得する。
 *
 * 前提:
 *   - `npm run dev` でローカルサーバーが起動していること (http://localhost:5173)
 *   - `npm i -D playwright` で playwright がインストール済み
 *
 * 使用法:
 *   node scripts/demo-review-screenshots.mjs
 *   BASE_URL=https://www.ganbari-quest.com node scripts/demo-review-screenshots.mjs
 *
 * 出力: tmp/demo-review/ 以下に
 *   - 10-demo-top.png
 *   - 40-guide-step1.png ... 80-guide-step5.png
 *   - デスクトップ・モバイル両方
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const OUTPUT_DIR = path.resolve('tmp/demo-review');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const VIEWPORTS = [
	{ name: 'desktop', width: 1280, height: 800 },
	{ name: 'mobile', width: 390, height: 844 },
];

async function captureGuideTour(browser, viewport) {
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();

	const shot = async (name) => {
		const filePath = path.join(OUTPUT_DIR, `${name}-${viewport.name}.png`);
		await page.screenshot({ path: filePath, fullPage: false });
		console.log(`  ✓ ${name}-${viewport.name}.png`);
	};

	console.log(`\n=== ${viewport.name} (${viewport.width}x${viewport.height}) ===`);

	// 1. /demo トップページ
	await page.goto(`${BASE_URL}/demo`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(500);
	await shot('10-demo-top');

	// 2. ガイド開始
	const startBtn = page.locator('a:has-text("ガイド付きデモを はじめる"), a:has-text("ガイドを再開する")').first();
	if ((await startBtn.count()) === 0) {
		console.log('  ✗ ガイド開始ボタンが見つかりません');
		await context.close();
		return;
	}
	await startBtn.click();
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(800); // DOM安定待ち
	await shot('40-guide-step1');

	// 3. Step 1 → Step 5 まで順に つぎへ を押す
	for (let i = 2; i <= 5; i++) {
		const nextBtn = page.locator('a:has-text("つぎへ"), a:has-text("はじめる")').first();
		const count = await nextBtn.count();
		if (count === 0) {
			console.log(`  ✗ step ${i}: つぎへ/はじめる ボタンが見つかりません`);
			break;
		}
		await nextBtn.click();
		await page.waitForLoadState('networkidle').catch(() => {});
		await page.waitForTimeout(800); // DOM安定待ち
		await shot(`${40 + (i - 1) * 10}-guide-step${i}`);
	}

	await context.close();
}

async function main() {
	console.log('=== Demo Guide Tour Review ===');
	console.log(`BASE_URL: ${BASE_URL}`);
	console.log(`Output: ${OUTPUT_DIR}`);

	const browser = await chromium.launch();
	try {
		for (const viewport of VIEWPORTS) {
			await captureGuideTour(browser, viewport);
		}
	} finally {
		await browser.close();
	}

	console.log('\n✓ 完了');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
