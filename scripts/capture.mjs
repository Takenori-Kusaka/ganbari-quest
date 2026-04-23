#!/usr/bin/env node

/**
 * scripts/capture.mjs (#1424)
 *
 * 汎用スクリーンショット / フロースタンプシート生成 CLI。
 *
 * 使用例:
 *   node scripts/capture.mjs --url /demo/admin --out tmp/screenshots/
 *   node scripts/capture.mjs --url /demo/admin --presets mobile,desktop
 *   node scripts/capture.mjs --flow add-activity --url /demo/admin/activities \
 *     --actions scripts/capture-specs/flows/add-activity.mjs --out tmp/screenshots/
 */

import path from 'node:path';
import { parseArgs } from 'node:util';
import { FlowRecorder, resolvePreset, ScreenshotCapture } from './lib/screenshot-helpers.mjs';

// ============================================================
// CLI オプション定義
// ============================================================

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		url: { type: 'string' },
		out: { type: 'string', default: 'tmp/screenshots' },
		presets: { type: 'string', default: 'desktop' },
		config: { type: 'string' },
		flow: { type: 'string' },
		actions: { type: 'string' },
		'base-url': { type: 'string', default: process.env.BASE_URL || 'http://localhost:5173' },
		'storage-state': { type: 'string' },
		'full-page': { type: 'boolean', default: false },
		format: { type: 'string', default: 'png' },
		quality: { type: 'string', default: '85' },
		'max-steps': { type: 'string', default: '12' },
		'grid-cols': { type: 'string', default: '2' },
		'cell-width': { type: 'string', default: '400' },
		'cell-height': { type: 'string', default: '300' },
		help: { type: 'boolean', default: false },
	},
});

// ============================================================
// ヘルプ
// ============================================================

if (values.help || positionals.includes('--help')) {
	console.log(`
使用法: node scripts/capture.mjs [オプション]

スクリーンショット（単発 URL）:
  node scripts/capture.mjs --url /demo/admin --out tmp/screenshots/
  node scripts/capture.mjs --url /demo/admin --presets mobile,desktop
  node scripts/capture.mjs --url /admin --storage-state storageState.json

フロースタンプシート（操作スクリプト付き）:
  node scripts/capture.mjs --flow add-activity \\
    --url /demo/admin/activities \\
    --actions scripts/capture-specs/flows/add-activity.mjs \\
    --out tmp/screenshots/

オプション:
  --url           撮影対象パス（BASE_URL が自動付与）
  --out           出力ディレクトリ（デフォルト: tmp/screenshots）
  --presets       mobile/desktop/tablet のコンマ区切り（デフォルト: desktop）
  --config        複数 URL 設定ファイルパス
  --flow          フロー名（フロースタンプシートモード）
  --actions       フロー操作スクリプト
  --base-url      サーバー URL（BASE_URL 環境変数でも指定可、デフォルト: http://localhost:5173）
  --storage-state 認証済みセッションの storageState ファイルパス
  --full-page     フルページキャプチャ（デフォルト: false）
  --format        png / webp / jpeg（デフォルト: png）
  --quality       WebP 品質 0-100（デフォルト: 85）
  --max-steps     フローの最大ステップ数（デフォルト: 12）
  --grid-cols     グリッド列数（デフォルト: 2）
  --cell-width    グリッド 1 セルの幅 px（デフォルト: 400）
  --cell-height   グリッド 1 セルの高さ px（デフォルト: 300）
  --help          このヘルプを表示
`);
	process.exit(0);
}

// ============================================================
// 引数検証・変換
// ============================================================

const baseUrl = values['base-url'];
const outputDir = values.out;
const format = values.format;
const fullPage = values['full-page'];
const quality = Number(values.quality);
const maxSteps = Number(values['max-steps']);
const gridCols = Number(values['grid-cols']);
const cellWidth = Number(values['cell-width']);
const cellHeight = Number(values['cell-height']);
const storageState = values['storage-state'];
const presetNames = values.presets.split(',').map((s) => s.trim());

// プリセット検証（早期エラー）
for (const name of presetNames) {
	try {
		resolvePreset(name);
	} catch (err) {
		console.error(`エラー: ${err.message}`);
		process.exit(1);
	}
}

// ============================================================
// フロースタンプシートモード
// ============================================================

async function runFlowMode() {
	const { flow, actions: actionsPath, url } = values;

	if (!actionsPath) {
		console.error('エラー: --flow には --actions が必要です。');
		process.exit(1);
	}
	if (!url) {
		console.error('エラー: --url が必要です。');
		process.exit(1);
	}

	const actionsAbsPath = path.resolve(actionsPath);
	let actionsModule;
	try {
		actionsModule = await import(actionsAbsPath);
	} catch (err) {
		console.error(`エラー: actions スクリプトを読み込めません: ${actionsAbsPath}`);
		console.error(err.message);
		process.exit(1);
	}

	const actionsFn = actionsModule.default;
	if (typeof actionsFn !== 'function') {
		console.error(
			'エラー: actions スクリプトは `export default async (page, capture) => {...}` 形式である必要があります。',
		);
		process.exit(1);
	}

	const recorder = new FlowRecorder({
		baseUrl,
		outputDir,
		maxSteps,
		gridColumns: gridCols,
		cellWidth,
		cellHeight,
	});

	console.log(`=== フロースタンプシート生成: ${flow} ===`);
	console.log(`URL: ${baseUrl}${url}`);
	console.log(`出力: ${outputDir}\n`);

	try {
		const result = await recorder.record({
			url,
			flowName: flow,
			actions: actionsFn,
			preset: presetNames[0] ?? 'desktop',
			storageState,
		});
		console.log(`\n完了: ${result.stepCount} ステップ`);
		if (result.compositePath) {
			console.log(`合成 WebP: ${result.compositePath}`);
			console.log(`Markdown: ${path.join(outputDir, `${flow}-flow.md`)}`);
		}
	} catch (err) {
		console.error(`\nエラー: ${err.message}`);
		process.exit(1);
	}
}

// ============================================================
// 設定ファイルモード
// ============================================================

async function runConfigMode() {
	const configAbsPath = path.resolve(values.config);
	let configModule;
	try {
		configModule = await import(configAbsPath);
	} catch (err) {
		console.error(`エラー: 設定ファイルを読み込めません: ${configAbsPath}`);
		console.error(err.message);
		process.exit(1);
	}

	const pages = configModule.default ?? configModule.pages;
	if (!Array.isArray(pages)) {
		console.error(
			'エラー: 設定ファイルは `export default [{ url, name, presets? }]` 形式である必要があります。',
		);
		process.exit(1);
	}

	const capturer = new ScreenshotCapture({ baseUrl, outputDir, locale: 'ja-JP' });
	await capturer.setup();

	let success = 0;
	let total = 0;
	for (const page of pages) {
		const pagePresets = page.presets ?? presetNames;
		for (const presetName of pagePresets) {
			total++;
			const viewport = resolvePreset(presetName);
			const name = pagePresets.length > 1 ? `${page.name}-${presetName}` : page.name;
			console.log(`Capturing ${page.name} [${presetName}] ...`);
			const result = await capturer.capture({
				url: page.url,
				name,
				viewport,
				fullPage: page.fullPage ?? fullPage,
				format: page.format ?? format,
				quality,
				selector: page.selector,
				storageState,
			});
			if (result.ok) {
				console.log(`  -> ${result.filePath} (${(result.size / 1024).toFixed(0)} KB)`);
				success++;
			} else {
				console.error(`  エラー: ${result.error.message}`);
			}
		}
	}

	await capturer.teardown();
	console.log(`\n完了: ${success}/${total} キャプチャ`);
}

// ============================================================
// 単発 URL モード
// ============================================================

async function runUrlMode() {
	const { url } = values;
	if (!url) {
		console.error('エラー: --url または --config が必要です。\n  node scripts/capture.mjs --help');
		process.exit(1);
	}

	const capturer = new ScreenshotCapture({ baseUrl, outputDir, locale: 'ja-JP' });
	await capturer.setup();

	const baseName = url.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-+|-+$/g, '') || 'screenshot';
	let success = 0;

	for (const presetName of presetNames) {
		const viewport = resolvePreset(presetName);
		const name = presetNames.length > 1 ? `${baseName}-${presetName}` : baseName;
		console.log(`Capturing ${url} [${presetName}] ...`);
		const result = await capturer.capture({
			url,
			name,
			viewport,
			fullPage,
			format,
			quality,
			storageState,
		});
		if (result.ok) {
			console.log(`  -> ${result.filePath} (${(result.size / 1024).toFixed(0)} KB)`);
			success++;
		} else {
			console.error(`  エラー: ${result.error.message}`);
		}
	}

	await capturer.teardown();
	console.log(`\n完了: ${success}/${presetNames.length} キャプチャ`);
}

// ============================================================
// エントリーポイント
// ============================================================

if (values.flow) {
	await runFlowMode();
} else if (values.config) {
	await runConfigMode();
} else {
	await runUrlMode();
}
