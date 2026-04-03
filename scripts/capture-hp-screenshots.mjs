#!/usr/bin/env node
// scripts/capture-hp-screenshots.mjs
// HP (site/index.html) 用のプロダクトスクリーンショットを自動取得
// 使用法: node scripts/capture-hp-screenshots.mjs
// 前提: npm run dev でローカルサーバーが起動していること

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const OUTPUT_DIR = path.resolve('site/screenshots');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Mobile viewport (iPhone 14 Pro size)
const MOBILE = { width: 390, height: 844 };

const SCREENSHOTS = [
	// Hero: メインのプロダクトショット（子供ホーム画面）
	{
		name: 'hero-child-home',
		url: '/demo/lower/home',
		viewport: MOBILE,
		description: 'Hero用: 子供ホーム画面（小学生低学年モード）',
	},
	// Features: 各機能カード用
	{
		name: 'feature-point-level',
		url: '/demo/lower/home',
		viewport: MOBILE,
		description: 'Features: ポイント＆レベルアップ',
	},
	{
		name: 'feature-combo-mission',
		url: '/demo/lower/home',
		viewport: MOBILE,
		description: 'Features: コンボ＆デイリーミッション',
		scrollTo: '.combo-counter, [data-testid="daily-missions"]',
	},
	{
		name: 'feature-radar-chart',
		url: '/demo/lower/status',
		viewport: MOBILE,
		description: 'Features: 成長レーダーチャート',
	},
	{
		name: 'feature-titles',
		url: '/demo/lower/achievements',
		viewport: MOBILE,
		description: 'Features: 称号＆実績コレクション',
	},
	{
		name: 'feature-checklist',
		url: '/demo/admin/checklists',
		viewport: MOBILE,
		description: 'Features: やることリスト',
	},
	{
		name: 'feature-dream',
		url: '/demo/admin/status',
		viewport: MOBILE,
		description: 'Features: 成長記録・管理画面',
	},
	// Age Modes: 5つの年齢モード
	{
		name: 'age-baby',
		url: '/demo/baby/home',
		viewport: MOBILE,
		description: 'Age Modes: はじめの一歩（0-2歳）',
	},
	{
		name: 'age-kinder',
		url: '/demo/kinder/home',
		viewport: MOBILE,
		description: 'Age Modes: じぶんでタップ（3-5歳）',
	},
	{
		name: 'age-lower',
		url: '/demo/lower/home',
		viewport: MOBILE,
		description: 'Age Modes: 冒険スタート（6-9歳）',
	},
	{
		name: 'age-upper',
		url: '/demo/upper/home',
		viewport: MOBILE,
		description: 'Age Modes: チャレンジ（10-14歳）',
	},
	{
		name: 'age-teen',
		url: '/demo/teen/home',
		viewport: MOBILE,
		description: 'Age Modes: みらい設計（15-18歳）',
	},
];

async function captureScreenshots() {
	console.log('=== HP用スクリーンショット撮影 ===');
	console.log(`Base URL: ${BASE_URL}`);
	console.log(`Output: ${OUTPUT_DIR}\n`);

	const browser = await chromium.launch({ headless: true });
	let successCount = 0;

	for (const shot of SCREENSHOTS) {
		try {
			console.log(`Capturing ${shot.description} (${shot.name})...`);
			const context = await browser.newContext({
				viewport: shot.viewport,
				deviceScaleFactor: 2,
				locale: 'ja-JP',
			});
			const page = await context.newPage();
			await page.goto(`${BASE_URL}${shot.url}`, {
				waitUntil: 'networkidle',
				timeout: 15000,
			});
			// Wait for animations to settle
			await page.waitForTimeout(1500);

			// Scroll to specific element if specified
			if (shot.scrollTo) {
				try {
					await page.locator(shot.scrollTo).first().scrollIntoViewIfNeeded();
					await page.waitForTimeout(500);
				} catch {
					// Element not found, take screenshot from current position
				}
			}

			const pngPath = path.join(OUTPUT_DIR, `${shot.name}.png`);
			await page.screenshot({
				path: pngPath,
				fullPage: false,
			});
			const stat = fs.statSync(pngPath);
			console.log(
				`  -> Saved: ${shot.name}.png (${(stat.size / 1024).toFixed(0)} KB, ${shot.viewport.width}x${shot.viewport.height}@2x)`,
			);
			successCount++;
			await context.close();
		} catch (error) {
			console.error(`  Error capturing ${shot.name}:`, error.message);
		}
	}

	await browser.close();
	console.log(`\n完了: ${successCount}/${SCREENSHOTS.length} スクリーンショット撮影`);
	console.log(`\n次のステップ: WebP変換`);
	console.log(`  npx sharp-cli --input "site/screenshots/*.png" --output site/screenshots/ --format webp --quality 80`);
	console.log(`  または手動で WebP に変換してください`);
}

captureScreenshots();
