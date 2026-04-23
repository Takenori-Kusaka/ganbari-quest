#!/usr/bin/env node

// scripts/capture-screenshots.mjs
// Playwright でアプリのスクリーンショットを撮影（マーケティング素材用）
// 使用法: node scripts/capture-screenshots.mjs
// 前提: npm run dev でローカルサーバーが起動していること

import path from 'node:path';
import { ScreenshotCapture } from './lib/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const OUTPUT_DIR = path.resolve('static/assets/marketing/screenshots');

const PAGES = [
	{
		name: 'child-home-mobile',
		url: '/demo/lower/home',
		viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
		description: '子供ホーム画面（モバイル）',
	},
	{
		name: 'child-home-tablet',
		url: '/demo/lower/home',
		viewport: { width: 768, height: 1024, deviceScaleFactor: 2 },
		description: '子供ホーム画面（タブレット）',
	},
	{
		name: 'child-kinder-mobile',
		url: '/demo/kinder/home',
		viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
		description: '幼児モード（モバイル）',
	},
	{
		name: 'child-teen-mobile',
		url: '/demo/teen/home',
		viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
		description: 'ティーンモード（モバイル）',
	},
	{
		name: 'admin-dashboard-desktop',
		url: '/demo/admin',
		viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
		description: '管理画面ダッシュボード（デスクトップ）',
	},
];

async function captureScreenshots() {
	console.log('=== マーケティング用スクリーンショット撮影 ===');
	console.log(`Base URL: ${BASE_URL}`);
	console.log(`Output: ${OUTPUT_DIR}\n`);

	const capturer = new ScreenshotCapture({ baseUrl: BASE_URL, outputDir: OUTPUT_DIR });
	await capturer.setup();

	let successCount = 0;
	for (const page of PAGES) {
		console.log(`Capturing ${page.description} (${page.name})...`);
		const result = await capturer.capture({
			url: page.url,
			name: page.name,
			viewport: page.viewport,
			fullPage: false,
		});
		if (result.ok) {
			console.log(`  -> Saved: ${result.filePath} (${(result.size / 1024).toFixed(0)} KB)`);
			successCount++;
		} else {
			console.error(`  Error capturing ${page.name}:`, result.error.message);
		}
	}

	await capturer.teardown();
	console.log(`\n完了: ${successCount}/${PAGES.length} スクリーンショット撮影`);
}

captureScreenshots();
