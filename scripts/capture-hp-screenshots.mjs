#!/usr/bin/env node

// scripts/capture-hp-screenshots.mjs
// HP (site/index.html) 用のプロダクトスクリーンショットを自動取得
// 使用法: node scripts/capture-hp-screenshots.mjs [--webp] [--only carousel|feature|age]
// 前提: npm run dev でローカルサーバーが起動していること
//
// オプション:
//   --webp    PNG撮影後にWebPへ自動変換（sharp Node API を使用）
//   --only X  指定グループのみ撮影 (carousel, feature, age)

import fs from 'node:fs';
import path from 'node:path';
import {
	convertToWebP,
	ScreenshotCapture,
	withScreenshotParam,
} from './lib/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const OUTPUT_DIR = path.resolve('site/screenshots');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Parse CLI args
const VALID_GROUPS = new Set(['carousel', 'feature', 'age']);
const args = process.argv.slice(2);
const doWebp = args.includes('--webp');
const onlyIdx = args.indexOf('--only');
let onlyGroup = null;
if (onlyIdx >= 0) {
	const nextArg = args[onlyIdx + 1];
	if (!nextArg || !VALID_GROUPS.has(nextArg)) {
		console.error(`Error: --only requires a valid group name: ${[...VALID_GROUPS].join(', ')}`);
		console.error(
			'Usage: node scripts/capture-hp-screenshots.mjs [--webp] [--only carousel|feature|age]',
		);
		process.exit(1);
	}
	onlyGroup = nextArg;
}

// ============================================================
// Viewport definitions
// ============================================================

const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2 };
const TABLET = { width: 768, height: 1024, deviceScaleFactor: 2 };
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 };

// ============================================================
// Screenshot definitions
// ============================================================

const CAROUSEL_SCREENSHOTS = [
	{
		name: 'carousel-1-child-home',
		url: '/demo/lower/home',
		description: 'Carousel 1: 子供ホーム画面（冒険スタートモード）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		mobileSuffix: '-mobile',
	},
	{
		name: 'carousel-2-child-status',
		url: '/demo/lower/status',
		description: 'Carousel 2: 成長レーダーチャート',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		mobileSuffix: '-mobile',
	},
	{
		name: 'carousel-3-admin-main',
		url: '/demo/admin',
		description: 'Carousel 3: 親の管理ダッシュボード',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		mobileSuffix: '-mobile',
	},
	{
		name: 'carousel-4-admin-sub',
		url: '/demo/admin/activities',
		description: 'Carousel 4: 活動管理画面（プリセット活動表示）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		mobileSuffix: '-mobile',
	},
];

const FEATURE_SCREENSHOTS = [
	{
		name: 'feature-point-level',
		url: '/demo/lower/home',
		description: 'Features: ポイント＆レベルアップ',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'feature-combo-mission',
		url: '/demo/lower/home',
		description: 'Features: コンボ＆デイリーミッション',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		scrollTo: '.combo-counter, [data-testid="daily-missions"]',
	},
	{
		name: 'feature-radar-chart',
		url: '/demo/lower/status',
		description: 'Features: 成長レーダーチャート',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'feature-titles',
		url: '/demo/lower/achievements',
		description: 'Features: 称号＆実績コレクション',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'feature-belongings-checklist',
		url: '/demo/checklist?childId=904',
		description: 'Features: 持ち物チェックリスト (子供画面)',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		scrollTo: '[data-testid="checklist-group-item"]',
	},
	{
		name: 'feature-growth-record-admin',
		url: '/demo/admin/status',
		description: 'Features: 成長記録・管理画面',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
];

const AGE_SCREENSHOTS = [
	{
		name: 'age-baby',
		url: '/demo/baby/home',
		description: 'Age Modes: はじめの一歩（0-2歳）',
		viewports: { mobile: MOBILE, tablet: TABLET, desktop: DESKTOP },
	},
	{
		name: 'age-kinder',
		url: '/demo/kinder/home',
		description: 'Age Modes: じぶんでタップ（3-5歳）',
		viewports: { mobile: MOBILE, tablet: TABLET, desktop: DESKTOP },
	},
	{
		name: 'age-lower',
		url: '/demo/lower/home',
		description: 'Age Modes: 冒険スタート（6-9歳）',
		viewports: { mobile: MOBILE, tablet: TABLET, desktop: DESKTOP },
	},
	{
		name: 'age-upper',
		url: '/demo/upper/home',
		description: 'Age Modes: チャレンジ（10-14歳）',
		viewports: { mobile: MOBILE, tablet: TABLET, desktop: DESKTOP },
	},
	{
		name: 'age-teen',
		url: '/demo/teen/home',
		description: 'Age Modes: みらい設計（15-18歳）',
		viewports: { mobile: MOBILE, tablet: TABLET, desktop: DESKTOP },
	},
];

const ALL_SCREENSHOTS = [];
if (!onlyGroup || onlyGroup === 'carousel') ALL_SCREENSHOTS.push(...CAROUSEL_SCREENSHOTS);
if (!onlyGroup || onlyGroup === 'feature') ALL_SCREENSHOTS.push(...FEATURE_SCREENSHOTS);
if (!onlyGroup || onlyGroup === 'age') ALL_SCREENSHOTS.push(...AGE_SCREENSHOTS);

// ============================================================
// Main capture function
// ============================================================

async function captureScreenshots() {
	console.log('=== HP用スクリーンショット撮影 ===');
	console.log(`Base URL: ${BASE_URL}`);
	console.log(`Output: ${OUTPUT_DIR}`);
	if (onlyGroup) console.log(`Group filter: ${onlyGroup}`);
	if (doWebp) console.log('WebP conversion: enabled');
	console.log('');

	const capturer = new ScreenshotCapture({ baseUrl: BASE_URL, outputDir: OUTPUT_DIR });
	await capturer.setup();

	let successCount = 0;
	let totalFiles = 0;
	const pngFiles = [];

	for (const shot of ALL_SCREENSHOTS) {
		for (const [sizeName, viewport] of Object.entries(shot.viewports)) {
			totalFiles++;
			const suffix = sizeName === 'mobile' ? (shot.mobileSuffix ?? '') : `-${sizeName}`;
			const filename = `${shot.name}${suffix}`;

			console.log(`Capturing ${shot.description} [${sizeName}] ...`);

			// For scrollTo, we use a custom selector option
			const result = await capturer.capture({
				url: withScreenshotParam(shot.url),
				name: filename,
				viewport,
				fullPage: false,
				format: 'png',
				selector: shot.scrollTo,
			});

			if (result.ok) {
				console.log(
					`  -> ${filename}.png (${(result.size / 1024).toFixed(0)} KB, ${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor ?? 2}x)`,
				);
				pngFiles.push(result.filePath);
				successCount++;
			} else {
				console.error(`  Error capturing ${filename}:`, result.error.message);
			}
		}
	}

	await capturer.teardown();
	console.log(`\n撮影完了: ${successCount}/${totalFiles} ファイル`);

	// WebP conversion
	if (doWebp && pngFiles.length > 0) {
		console.log('\n=== WebP変換 ===');
		let convertCount = 0;
		for (const pngPath of pngFiles) {
			const webpPath = pngPath.replace(/\.png$/, '.webp');
			const result = await convertToWebP(pngPath, { quality: 80, outPath: webpPath });
			if (result.ok) {
				const { size } = await import('node:fs').then((m) => ({ size: m.statSync(webpPath).size }));
				console.log(`  -> ${path.basename(webpPath)} (${(size / 1024).toFixed(0)} KB)`);
				convertCount++;
			} else {
				console.error(`  WebP変換失敗: ${path.basename(pngPath)}`);
				console.error(`    原因: ${result.error.message}`);
			}
		}
		console.log(`変換完了: ${convertCount}/${pngFiles.length} ファイル`);
	} else if (!doWebp) {
		console.log('\n次のステップ: WebP変換');
		console.log('  node scripts/capture-hp-screenshots.mjs --webp');
	}
}

captureScreenshots();
