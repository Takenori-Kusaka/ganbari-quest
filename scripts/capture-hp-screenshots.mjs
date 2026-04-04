#!/usr/bin/env node
// scripts/capture-hp-screenshots.mjs
// HP (site/index.html) 用のプロダクトスクリーンショットを自動取得
// 使用法: node scripts/capture-hp-screenshots.mjs [--webp] [--only carousel|feature|age]
// 前提: npm run dev でローカルサーバーが起動していること
//
// オプション:
//   --webp    PNG撮影後にWebPへ自動変換（sharp CLI が必要）
//   --only X  指定グループのみ撮影 (carousel, feature, age)

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const OUTPUT_DIR = path.resolve('site/screenshots');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Parse CLI args
const args = process.argv.slice(2);
const doWebp = args.includes('--webp');
const onlyIdx = args.indexOf('--only');
const onlyGroup = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

// ============================================================
// Viewport definitions
// ============================================================

const MOBILE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };
const DESKTOP = { width: 1440, height: 900 };

// ============================================================
// Screenshot definitions
// ============================================================

// Carousel uses "-mobile" suffix for mobile viewport (unlike feature/age which use no suffix)
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
		name: 'feature-checklist',
		url: '/demo/admin/checklists',
		description: 'Features: やることリスト',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
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

// Merge all screenshots with group filtering
let ALL_SCREENSHOTS = [];
if (!onlyGroup || onlyGroup === 'carousel') ALL_SCREENSHOTS.push(...CAROUSEL_SCREENSHOTS);
if (!onlyGroup || onlyGroup === 'feature') ALL_SCREENSHOTS.push(...FEATURE_SCREENSHOTS);
if (!onlyGroup || onlyGroup === 'age') ALL_SCREENSHOTS.push(...AGE_SCREENSHOTS);

// ============================================================
// Helper: hide demo banner & guide bar for clean screenshots
// ============================================================

async function hideDemoOverlays(page) {
	// Inject CSS to hide all demo overlays — more reliable than DOM manipulation
	await page.addStyleTag({
		content: `
			/* Hide demo banner at top (fixed amber/orange gradient bar) */
			.fixed.top-0.left-0.right-0.z-50 { display: none !important; }

			/* Remove top padding added for demo banner (.pt-10 = padding-top: 2.5rem) */
			.pt-10 { padding-top: 0 !important; }

			/* Hide DemoGuideBar at bottom */
			.fixed.bottom-0.left-0.right-0.z-40 { display: none !important; }

			/* Hide floating CTA card */
			.fixed.bottom-20 { display: none !important; }

			/* Hide any safe-area-bottom overlay */
			.safe-area-bottom.fixed { display: none !important; }
		`,
	});
}

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

	const browser = await chromium.launch({ headless: true });
	let successCount = 0;
	let totalFiles = 0;
	const pngFiles = [];

	for (const shot of ALL_SCREENSHOTS) {
		for (const [sizeName, viewport] of Object.entries(shot.viewports)) {
			totalFiles++;
			// Carousel uses "-mobile" suffix; feature/age use no suffix for mobile
			const suffix =
				sizeName === 'mobile' ? (shot.mobileSuffix ?? '') : `-${sizeName}`;
			const filename = `${shot.name}${suffix}`;

			try {
				console.log(`Capturing ${shot.description} [${sizeName}] ...`);
				const context = await browser.newContext({
					viewport,
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

				// Hide demo overlays (banner, guide bar, floating CTA)
				await hideDemoOverlays(page);
				await page.waitForTimeout(300);

				// Scroll to specific element if specified
				if (shot.scrollTo) {
					try {
						await page.locator(shot.scrollTo).first().scrollIntoViewIfNeeded();
						await page.waitForTimeout(500);
						// Re-hide overlays after scroll (in case new ones appeared)
						await hideDemoOverlays(page);
					} catch {
						// Element not found, take screenshot from current position
					}
				}

				const pngPath = path.join(OUTPUT_DIR, `${filename}.png`);
				await page.screenshot({
					path: pngPath,
					fullPage: false,
				});

				const stat = fs.statSync(pngPath);
				console.log(
					`  -> ${filename}.png (${(stat.size / 1024).toFixed(0)} KB, ${viewport.width}x${viewport.height}@2x)`,
				);
				pngFiles.push(pngPath);
				successCount++;
				await context.close();
			} catch (error) {
				console.error(`  Error capturing ${filename}:`, error.message);
			}
		}
	}

	await browser.close();
	console.log(`\n撮影完了: ${successCount}/${totalFiles} ファイル`);

	// WebP conversion
	if (doWebp && pngFiles.length > 0) {
		console.log('\n=== WebP変換 ===');
		let convertCount = 0;
		for (const pngPath of pngFiles) {
			const webpPath = pngPath.replace(/\.png$/, '.webp');
			try {
				execSync(
					`npx sharp-cli --input "${pngPath}" --output "${webpPath}" --format webp --quality 80`,
					{ stdio: 'pipe' },
				);
				const stat = fs.statSync(webpPath);
				console.log(`  -> ${path.basename(webpPath)} (${(stat.size / 1024).toFixed(0)} KB)`);
				convertCount++;
			} catch {
				console.error(`  WebP変換失敗: ${path.basename(pngPath)}`);
			}
		}
		console.log(`変換完了: ${convertCount}/${pngFiles.length} ファイル`);
	} else if (!doWebp) {
		console.log('\n次のステップ: WebP変換');
		console.log('  node scripts/capture-hp-screenshots.mjs --webp');
		console.log('  または手動で WebP に変換してください');
	}
}

captureScreenshots();
