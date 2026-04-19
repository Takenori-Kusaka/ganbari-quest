#!/usr/bin/env node

// scripts/capture-screenshots.mjs
// Playwright でアプリのスクリーンショットを撮影（マーケティング素材用）
// 使用法: node scripts/capture-screenshots.mjs
// 前提: npm run dev でローカルサーバーが起動していること

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { waitForStablePage } from './lib/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const OUTPUT_DIR = path.resolve('static/assets/marketing/screenshots');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const PAGES = [
	{
		name: 'child-home-mobile',
		url: '/demo/lower/home',
		viewport: { width: 390, height: 844 },
		description: '子供ホーム画面（モバイル）',
	},
	{
		name: 'child-home-tablet',
		url: '/demo/lower/home',
		viewport: { width: 768, height: 1024 },
		description: '子供ホーム画面（タブレット）',
	},
	{
		name: 'child-kinder-mobile',
		url: '/demo/kinder/home',
		viewport: { width: 390, height: 844 },
		description: '幼児モード（モバイル）',
	},
	{
		name: 'child-teen-mobile',
		url: '/demo/teen/home',
		viewport: { width: 390, height: 844 },
		description: 'ティーンモード（モバイル）',
	},
	{
		name: 'admin-dashboard-desktop',
		url: '/demo/admin',
		viewport: { width: 1280, height: 800 },
		description: '管理画面ダッシュボード（デスクトップ）',
	},
];

async function captureScreenshots() {
	console.log('=== マーケティング用スクリーンショット撮影 ===');
	console.log(`Base URL: ${BASE_URL}`);
	console.log(`Output: ${OUTPUT_DIR}\n`);

	const browser = await chromium.launch({ headless: true });

	let successCount = 0;
	for (const page of PAGES) {
		try {
			console.log(`Capturing ${page.description} (${page.name})...`);
			const context = await browser.newContext({
				viewport: page.viewport,
				deviceScaleFactor: 2, // Retina quality
				locale: 'ja-JP',
			});
			const tab = await context.newPage();
			await tab.goto(`${BASE_URL}${page.url}`, {
				waitUntil: 'networkidle',
				timeout: 15000,
			});
			await waitForStablePage(tab);

			const outputPath = path.join(OUTPUT_DIR, `${page.name}.png`);
			await tab.screenshot({
				path: outputPath,
				fullPage: false,
			});
			const stat = fs.statSync(outputPath);
			console.log(
				`  -> Saved: ${outputPath} (${(stat.size / 1024).toFixed(0)} KB, ${page.viewport.width}x${page.viewport.height}@2x)`,
			);
			successCount++;
			await context.close();
		} catch (error) {
			console.error(`  Error capturing ${page.name}:`, error.message);
		}
	}

	await browser.close();
	console.log(`\n完了: ${successCount}/${PAGES.length} スクリーンショット撮影`);
}

captureScreenshots();
