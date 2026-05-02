#!/usr/bin/env node

// scripts/capture-hp-screenshots.mjs
// HP (site/index.html) 用のプロダクトスクリーンショットを自動取得
// 使用法:
//   node scripts/capture-hp-screenshots.mjs [--webp] [--only <group|name>]
// 前提: npm run dev でローカルサーバーが起動していること
//
// オプション:
//   --webp        PNG撮影後にWebPへ自動変換（sharp Node API を使用）
//   --only X      撮影対象を絞り込む。X はグループ名 (carousel, feature, age, growth)
//                 もしくは個別の screenshot 名 (例: feature-belongings-checklist)
//                 #1783: 個別撮り直し (`npm run capture:feature -- <name>`) で利用

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
const VALID_GROUPS = new Set(['carousel', 'feature', 'age', 'growth']);
const args = process.argv.slice(2);
const doWebp = args.includes('--webp');
const onlyIdx = args.indexOf('--only');
let onlyGroup = null;
let onlyName = null;
if (onlyIdx >= 0) {
	const nextArg = args[onlyIdx + 1];
	if (!nextArg) {
		console.error('Error: --only requires a value (group name or screenshot name)');
		console.error(
			'Usage: node scripts/capture-hp-screenshots.mjs [--webp] [--only carousel|feature|age|growth|<name>]',
		);
		process.exit(1);
	}
	if (VALID_GROUPS.has(nextArg)) {
		onlyGroup = nextArg;
	} else {
		// 個別 screenshot 名 (#1783): `--only feature-belongings-checklist` 等
		onlyName = nextArg;
	}
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
		scrollTo: '[data-testid="category-header-1"]',
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
		// #1783: kind 削除 (#1755 #1709-A) で旧 [data-testid="checklist-group-item"] が消滅し
		// waitForSelector がタイムアウトしていた。現行 DOM の demo-checklist-item-* に追従する。
		scrollTo: '[data-testid^="demo-checklist-item-"]',
	},
	{
		name: 'feature-growth-record-admin',
		url: '/demo/admin/status',
		description: 'Features: 成長記録・管理画面',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	// #1707 R2: machine-tour ③ ルーティンチェックリスト（朝夜の習慣化）
	// #1783: 旧 testid 廃止に伴い demo-checklist-item-* に追従。
	{
		name: 'feature-routine-checklist',
		url: '/demo/checklist?childId=904',
		description: 'Features: ルーティンチェックリスト (子供画面)',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		scrollTo: '[data-testid^="demo-checklist-item-"]',
	},
	// #1707 R2: machine-tour ④ RPG バトル（冒険のクライマックス）
	{
		name: 'feature-rpg-battle',
		url: '/demo/lower/battle',
		description: 'Features: RPG バトル画面（累積した努力でボスに挑戦）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	// #1707 R2: soft-features 月次レポート（成長の記録）
	{
		name: 'feature-monthly-report',
		url: '/demo/admin/status',
		description: 'Features: 月次レポート（活動・ポイント推移）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	// #1707 R2: soft-features 自動スリープ（時間管理・使いすぎ防止）
	{
		name: 'feature-auto-sleep',
		url: '/demo/admin',
		description: 'Features: 時間管理（自動スリープ設定）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	// #1707 R2: soft-features おうえんメッセージ
	{
		name: 'feature-cheer-message',
		url: '/demo/lower/home',
		description: 'Features: おうえんメッセージ受信',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	// #1707 R2: soft-features 設定の自由度
	{
		name: 'feature-settings',
		url: '/demo/admin/activities',
		description: 'Features: 親管理の設定一覧',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
];

// #1707 R2 / #1712 R5: 成長 stage サムネ 5 枚（5 stage 各々のホーム画面）
// 撮影元 URL は /demo/<legacyMode>/home（legacyMode は LEGACY_UI_MODE_MAP で正規化される）。
// graduate stage は卒業マイルストーン画面（実装上は achievements に集約されているため代替）。
const GROWTH_STAGE_SCREENSHOTS = [
	{
		name: 'growth-stage-preschool',
		url: '/demo/kinder/home',
		description: 'Growth Stage: 幼児（preschool）— 大きな絵文字ボタンと達成スタンプ',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'growth-stage-elementary',
		url: '/demo/lower/home',
		description: 'Growth Stage: 小学生（elementary）— 称号コレクションとデイリーミッション',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'growth-stage-junior',
		url: '/demo/upper/home',
		description: 'Growth Stage: 中学生（junior）— 月次レポートと自己ペース可視化',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'growth-stage-senior',
		url: '/demo/teen/home',
		description: 'Growth Stage: 高校生（senior）— 15 年分のログと進路素材',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'growth-stage-graduate',
		url: '/demo/lower/achievements',
		description: 'Growth Stage: 卒業（graduate）— 履歴エクスポートと家族の手元に残す記録',
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
if (onlyName) {
	// #1783: 個別 screenshot 名指定。全 spec を平坦化して name で完全一致検索。
	const allSpecs = [
		...CAROUSEL_SCREENSHOTS,
		...FEATURE_SCREENSHOTS,
		...AGE_SCREENSHOTS,
		...GROWTH_STAGE_SCREENSHOTS,
	];
	const found = allSpecs.find((s) => s.name === onlyName);
	if (!found) {
		const names = allSpecs.map((s) => s.name).sort();
		console.error(`Error: --only ${onlyName} not found. Valid names:\n  ${names.join('\n  ')}`);
		process.exit(1);
	}
	ALL_SCREENSHOTS.push(found);
} else {
	if (!onlyGroup || onlyGroup === 'carousel') ALL_SCREENSHOTS.push(...CAROUSEL_SCREENSHOTS);
	if (!onlyGroup || onlyGroup === 'feature') ALL_SCREENSHOTS.push(...FEATURE_SCREENSHOTS);
	if (!onlyGroup || onlyGroup === 'age') ALL_SCREENSHOTS.push(...AGE_SCREENSHOTS);
	if (!onlyGroup || onlyGroup === 'growth') ALL_SCREENSHOTS.push(...GROWTH_STAGE_SCREENSHOTS);
}

// ============================================================
// Main capture function
// ============================================================

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
async function captureScreenshots() {
	console.log('=== HP用スクリーンショット撮影 ===');
	console.log(`Base URL: ${BASE_URL}`);
	console.log(`Output: ${OUTPUT_DIR}`);
	if (onlyGroup) console.log(`Group filter: ${onlyGroup}`);
	if (onlyName) console.log(`Name filter: ${onlyName}`);
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

			// #1825: carousel-* shots は LP /demo 画面ではあるが、index.html の hero carousel と同じ
			// Splide.js を使う場合に SS が黒ブロック化する問題への対策として全 LP shot で waitSplide を有効化。
			// Splide が存在しないページでは silent skip するため副作用なし。
			const isCarouselShot = shot.name.startsWith('carousel-');
			const result = await capturer.capture({
				url: withScreenshotParam(shot.url),
				name: filename,
				viewport,
				fullPage: false,
				format: 'png',
				selector: shot.scrollTo,
				waitSplide: isCarouselShot,
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

	// #1783: 撮影失敗ゼロ容認 — 1 件でも失敗したら exit 1（古い画像を黙って残さない / ADR-0029）
	const failedCount = totalFiles - successCount;
	if (failedCount > 0) {
		console.error(`\n[FAIL] 撮影失敗 ${failedCount}/${totalFiles} 件`);
		console.error(
			'  → CI が無言で古い画像を残すのを防ぐため、失敗 1 件でも exit 1 します (ADR-0029 / #1783)',
		);
		process.exit(1);
	}

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
