#!/usr/bin/env node

// scripts/capture-hp-screenshots.mjs
// HP (site/index.html) 用のプロダクトスクリーンショットを自動取得
// 使用法:
//   node scripts/capture-hp-screenshots.mjs [--webp] [--only <group|name>]
// 前提: preview server を AUTH_MODE=anonymous + DATA_SOURCE=demo で起動していること
//   (`.github/workflows/pages.yml` の preview 起動 step と同じ構成)
//   ローカル検証は `AUTH_MODE=anonymous DATA_SOURCE=demo npx vite dev --port 5173` で OK
//
// オプション:
//   --webp        PNG撮影後にWebPへ自動変換（sharp Node API を使用）
//   --only X      撮影対象を絞り込む。X はグループ名 (carousel, feature, age, growth)
//                 もしくは個別の screenshot 名 (例: feature-belongings-checklist)
//                 #1783: 個別撮り直し (`npm run capture:feature -- <name>`) で利用
//
// #2097 EPIC PR-B1 (2026-05-17):
//   従来 `/demo/<legacyMode>/<path>` (LEGACY_UI_MODE_MAP 経由) で撮影していたが、
//   `src/routes/demo/(child)/[mode]/home/+page.svelte` (DashboardView) を経由するため
//   「きょうのミッション」セクション等の demo 固有 UI が映り込み、本番 `ProdDashboardSections`
//   から乖離していた (ADR-0013 LP truth 違反 + LP 訴求毀損)。
//
//   本リファクタでは Multi-Lambda demo deployment (ADR-0048) と同型の env (AUTH_MODE=anonymous +
//   DATA_SOURCE=demo) で preview server を起動し、本番ルート `/(child)/[uiMode]/home` 等を
//   demo fixture data で描画した状態を撮影する。`selectedChildId` cookie を `?screenshot=all` と
//   合わせて pre-set することで `/(child)/+layout.server.ts` の `/switch` redirect をバイパスする。

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
// Demo fixture child IDs (SSOT: src/lib/server/demo/demo-data.ts)
// ============================================================
//
// #2097 EPIC PR-B1: 本番ルート `/(child)/[uiMode]/home` 等を撮影するため、
// uiMode と一致する `selectedChildId` cookie を pre-set する必要がある。
// demo fixture の 5 子供 (901-906) はそれぞれ uiMode が固定されており、
// child の uiMode と URL `[uiMode]` が一致しない場合は `(child)/+layout.server.ts`
// が `/(child)/${effectiveMode}/home` に redirect する。
//
// uiMode → childId 対応 (demo fixture から抽出、`/switch` HTML 検証済):
//   baby (1歳)        → 901 たろうくん
//   preschool (5歳)   → 902 ひなちゃん
//   elementary (8歳)  → 903 けんたくん
//   junior (14歳)     → 904 さくらちゃん
//   senior (17歳)     → 906 けいすけくん
const CHILD_ID_BY_UI_MODE = {
	baby: '901',
	preschool: '902',
	elementary: '903',
	junior: '904',
	senior: '906',
};

/**
 * URL から uiMode を判定し、対応する selectedChildId cookie 仕様を返す。
 * URL 例:
 *   `/preschool/home` → preschool → child 902
 *   `/elementary/home?...` → elementary → child 903
 *   `/admin/...` → null (admin は全 child 横断)
 *   `/checklist?childId=N` → childId クエリパラメータがあれば優先
 */
function deriveChildIdCookieFromUrl(urlPath) {
	// `?childId=N` クエリパラメータが明示されていればそれを優先
	const queryMatch = urlPath.match(/[?&]childId=(\d+)/);
	if (queryMatch) {
		return [{ name: 'selectedChildId', value: queryMatch[1] }];
	}

	// path 先頭 segment が uiMode の場合は対応 child を選択
	const segMatch = urlPath.match(/^\/?([a-z]+)\b/);
	if (segMatch) {
		const seg = segMatch[1];
		const childId = CHILD_ID_BY_UI_MODE[seg];
		if (childId) {
			return [{ name: 'selectedChildId', value: childId }];
		}
	}

	// admin / checklist (子供共通) 等は cookie 不要
	return undefined;
}

// ============================================================
// Screenshot definitions
// ============================================================

// #1900 (UIUX-C-1): hero carousel 4 枚を年齢帯 3 系統 + 管理画面に再構成。
//   旧構成は 4 枚すべて /demo/lower/* 固定で alt「3〜18 歳の代表」と実体が乖離していた
//   (ADR-0013 LP truth 違反)。本リファクタで以下の 4 枚に組み替えた:
//     carousel-1 = 幼児 (preschool) ホーム
//     carousel-2 = 小学生 (elementary) ホーム
//     carousel-3 = 中高生 (junior) ホーム
//     carousel-4 = ご家族の見守り画面 (管理画面)
//   `name` は HTML 側 <img src="screenshots/<name>-mobile.webp"> と一致するため後方互換維持。
//   alt / data-label の SSOT は `LP_INDEX_PHASEB_LABELS.carouselSlide{1..4}Alt` (#1900 で追加)。
//
// #2097 EPIC PR-B1: 撮影元 URL を `/demo/<legacyMode>/...` から `/<uiMode>/...` (本番ルート)
//   に切替。`ProdDashboardSections.svelte` 経由で「きょうのミッション」セクション等が
//   映り込まない正しい本番 UI が撮影される。
const CAROUSEL_SCREENSHOTS = [
	{
		name: 'carousel-1-child-home',
		url: '/preschool/home',
		description: 'Carousel 1: 幼児（3-5 歳代表）ホーム画面 — ひらがな・大きなボタン',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		mobileSuffix: '-mobile',
	},
	{
		name: 'carousel-2-child-status',
		url: '/elementary/home',
		description: 'Carousel 2: 小学生（6-12 歳代表）ホーム画面 — 活動記録とポイント獲得',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		mobileSuffix: '-mobile',
	},
	{
		name: 'carousel-3-admin-main',
		url: '/junior/home',
		description: 'Carousel 3: 中高生（13-18 歳代表）ホーム画面 — 自己管理ダッシュボード',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		mobileSuffix: '-mobile',
	},
	// #1900 (UIUX-C-1) + #1901 統合: hero carousel 4 枚を年齢帯 3 系統 + 管理画面に再構成する文脈で、
	//   slide 4 = ご家族の見守り (管理画面) を担う。main #1901 の物理重複解消 (旧 /admin/activities は
	//   feature-settings と URL/ETag 完全一致だった) を尊重し URL は /admin/children を採用、
	//   ADR-0013 LP truth 整合のため alt / data-label も「子供管理 — 家族メンバーの登録と切替」で統一する。
	{
		name: 'carousel-4-admin-sub',
		url: '/admin/children',
		description: 'Carousel 4: 子供管理画面（家族メンバーの登録と切替）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		mobileSuffix: '-mobile',
	},
];

const FEATURE_SCREENSHOTS = [
	{
		name: 'feature-point-level',
		url: '/elementary/home',
		description: 'Features: ポイント＆レベルアップ',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'feature-combo-mission',
		url: '/elementary/home',
		description: 'Features: コンボ＆デイリーミッション',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		scrollTo: '[data-testid="category-header-1"]',
	},
	{
		name: 'feature-radar-chart',
		url: '/elementary/status',
		description: 'Features: 成長レーダーチャート',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	// #1901: feature-titles は LP HTML から参照削除済 (#1708 / #1755 で machine-tour ② の称号セクション撤去)。
	//        撮影定義のみ残存し growth-stage-graduate と URL/ETag が完全一致していたため削除。
	{
		name: 'feature-belongings-checklist',
		url: '/checklist?childId=903',
		description: 'Features: 持ち物チェックリスト (子供画面)',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		// #1783: kind 削除 (#1755 #1709-A) で旧 [data-testid="checklist-group-item"] が消滅し
		// waitForSelector がタイムアウトしていた。現行 DOM の demo-checklist-item-* に追従する。
		// #2097 EPIC PR-B1: childId=904 → 903 (elementary fixture) に振り替え。
		//   旧 904 (demo fixture では junior=14歳) では本番ルートの `(child)/+layout` が
		//   uiMode=junior に redirect してしまうため。checklist は uiMode 配下ではないが
		//   selectedChildId cookie の整合のため elementary 子を選択。
		scrollTo: '[data-testid^="demo-checklist-item-"]',
	},
	{
		name: 'feature-growth-record-admin',
		url: '/admin/status',
		description: 'Features: 成長記録・管理画面',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	// #1901: feature-routine-checklist は LP HTML から参照削除済 (#1708 で machine-tour ③ ルーティン
	//        セクション撤去)。撮影定義のみ残存し feature-belongings-checklist と URL/ETag が完全一致して
	//        いたため削除。
	// #1707 R2: machine-tour ④ RPG バトル（冒険のクライマックス）
	{
		name: 'feature-rpg-battle',
		url: '/elementary/battle',
		description: 'Features: RPG バトル画面（累積した努力でボスに挑戦）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	// #1707 R2: soft-features 月次レポート（成長の記録）
	{
		name: 'feature-monthly-report',
		url: '/admin/status',
		description: 'Features: 月次レポート（活動・ポイント推移）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	// #1707 R2 / #1901: soft-features 自動スリープ（時間管理・使いすぎ防止）
	// #1901: 旧 /demo/admin (top) は carousel-3-admin-main と URL/ETag 完全一致だったため
	//        /admin/settings (auto-sleep + おうえんメッセージ設定画面) に変更。
	{
		name: 'feature-auto-sleep',
		url: '/admin/settings',
		description: 'Features: 時間管理（自動スリープ設定 + おうえんメッセージ設定）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	// #1707 R2 / #1901: soft-features おうえんメッセージ受信（子供ホーム画面下部）
	// #1901: growth-stage-elementary と URL が同じ /elementary/home のため、scrollTo で
	//        画面下部の activity-card 領域を撮影し物理的に異なる SS を生成する。
	{
		name: 'feature-cheer-message',
		url: '/elementary/home',
		description: 'Features: おうえんメッセージ受信（子供ホーム下部）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
		scrollTo: '[data-testid^="activity-card-"]',
	},
	// #1707 R2: soft-features 設定の自由度（活動・ポイント・ごほうびのカスタマイズ）
	// #1901: carousel-4-admin-sub が /admin/children に振り替えられたため、本撮影は
	//        /admin/activities を維持しても URL 重複しない。
	{
		name: 'feature-settings',
		url: '/admin/activities',
		description: 'Features: 親管理の設定一覧（活動・ポイント・ごほうびのカスタマイズ）',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
];

// #1707 R2 / #1712 R5: 成長 stage サムネ 5 枚（5 stage 各々のホーム画面）
// #2097 EPIC PR-B1: 撮影元 URL を本番ルート `/<uiMode>/home` に変更。
//   旧 `/demo/<legacyMode>/home` (LEGACY_UI_MODE_MAP 経由) は demo (child)/[mode] DashboardView 経由で
//   「きょうのミッション」等 demo 固有 UI が映り込んでいた。
// graduate stage は卒業マイルストーン画面（実装上は achievements に集約されているため代替）。
const GROWTH_STAGE_SCREENSHOTS = [
	{
		name: 'growth-stage-preschool',
		url: '/preschool/home',
		description: 'Growth Stage: 幼児（preschool）— 大きな絵文字ボタンと達成スタンプ',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'growth-stage-elementary',
		url: '/elementary/home',
		description: 'Growth Stage: 小学生（elementary）— 称号コレクションとデイリーミッション',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'growth-stage-junior',
		url: '/junior/home',
		description: 'Growth Stage: 中学生（junior）— 月次レポートと自己ペース可視化',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'growth-stage-senior',
		url: '/senior/home',
		description: 'Growth Stage: 高校生（senior）— 15 年分のログと進路素材',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
	{
		name: 'growth-stage-graduate',
		url: '/elementary/achievements',
		description: 'Growth Stage: 卒業（graduate）— 履歴エクスポートと家族の手元に残す記録',
		viewports: { mobile: MOBILE, desktop: DESKTOP },
	},
];

// #2097 EPIC PR-B1: age-* も本番ルート `/<uiMode>/home` に同期切替。
//   `LEGACY_UI_MODE_MAP` 経由 (kinder→preschool, lower→elementary, upper→junior, teen→senior)
//   と等価な撮影結果を本番ルート直結で得る。baby は legacy/本番ともに `baby` 同一。
const AGE_SCREENSHOTS = [
	{
		name: 'age-baby',
		url: '/baby/home',
		description: 'Age Modes: はじめの一歩（0-2歳）',
		viewports: { mobile: MOBILE, tablet: TABLET, desktop: DESKTOP },
	},
	{
		name: 'age-kinder',
		url: '/preschool/home',
		description: 'Age Modes: じぶんでタップ（3-5歳）',
		viewports: { mobile: MOBILE, tablet: TABLET, desktop: DESKTOP },
	},
	{
		name: 'age-lower',
		url: '/elementary/home',
		description: 'Age Modes: 冒険スタート（6-9歳）',
		viewports: { mobile: MOBILE, tablet: TABLET, desktop: DESKTOP },
	},
	{
		name: 'age-upper',
		url: '/junior/home',
		description: 'Age Modes: チャレンジ（10-14歳）',
		viewports: { mobile: MOBILE, tablet: TABLET, desktop: DESKTOP },
	},
	{
		name: 'age-teen',
		url: '/senior/home',
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
		// #2097 EPIC PR-B1: 本番ルート `/(child)/[uiMode]/home` 等を撮影するため、
		// `selectedChildId` cookie を URL の uiMode に対応する child fixture id で pre-set する。
		// admin / checklist (childId クエリ明示) などは null を返す → cookie 未設定。
		const cookies = deriveChildIdCookieFromUrl(shot.url);

		for (const [sizeName, viewport] of Object.entries(shot.viewports)) {
			totalFiles++;
			const suffix = sizeName === 'mobile' ? (shot.mobileSuffix ?? '') : `-${sizeName}`;
			const filename = `${shot.name}${suffix}`;

			console.log(`Capturing ${shot.description} [${sizeName}] ...`);

			// #1825: carousel-* shots は本番ルートではあるが、index.html の hero carousel と同じ
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
				cookies,
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
