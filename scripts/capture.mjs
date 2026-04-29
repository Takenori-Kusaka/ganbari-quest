#!/usr/bin/env node

/**
 * scripts/capture.mjs (#1424)
 *
 * 汎用スクリーンショット / フロースタンプシート生成 CLI。
 *
 * 使用例（基本）:
 *   node scripts/capture.mjs --url /demo/admin --out tmp/screenshots/
 *   node scripts/capture.mjs --url /demo/admin --presets mobile,desktop
 *   node scripts/capture.mjs --url /admin --storage-state storageState.json
 *
 * 使用例（QA レビュー用 — --pr で全部自動化）:
 *   node scripts/capture.mjs --pr 123 --url /demo/admin/activities
 *   node scripts/capture.mjs --pr 123 --server-mode cognito --url /admin/children
 *   node scripts/capture.mjs --pr 123 --server-mode lp --url /index.html
 *   node scripts/capture.mjs --pr 123 --config scripts/capture-specs/admin.mjs
 *
 * --pr を使うと:
 *   - 出力先が tmp/screenshots/pr-<N>/ に自動設定される
 *   - presets が mobile,desktop にデフォルト設定される
 *   - サーバーが未起動なら自動起動・撮影後自動停止される
 *   - 撮影後に PR body 用 Markdown スニペットが標準出力に表示される
 *
 * フロースタンプシート:
 *   node scripts/capture.mjs --flow add-activity --url /demo/admin/activities \
 *     --actions scripts/capture-specs/flows/add-activity.mjs --out tmp/screenshots/
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
		// --- QA / PR スクリーンショット用オプション ---
		pr: { type: 'string' }, // PR 番号 → 出力先自動化 + Markdown 生成
		'start-server': { type: 'boolean' }, // 未起動なら自動起動（--pr 時デフォルト true）
		'server-mode': { type: 'string', default: 'dev' }, // dev | cognito | lp
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

QA レビュー用（--pr で全自動）:
  node scripts/capture.mjs --pr 123 --url /demo/admin
  node scripts/capture.mjs --pr 123 --server-mode cognito --url /admin/children
  node scripts/capture.mjs --pr 123 --server-mode lp --url /index.html
  node scripts/capture.mjs --pr 123 --config scripts/capture-specs/admin.mjs

フロースタンプシート（操作スクリプト付き）:
  node scripts/capture.mjs --flow add-activity \\
    --url /demo/admin/activities \\
    --actions scripts/capture-specs/flows/add-activity.mjs \\
    --out tmp/screenshots/

オプション:
  --url             撮影対象パス（BASE_URL が自動付与）
  --out             出力ディレクトリ（デフォルト: tmp/screenshots）
  --presets         mobile/desktop/tablet のコンマ区切り（デフォルト: desktop）
  --config          複数 URL 設定ファイルパス
  --flow            フロー名（フロースタンプシートモード）
  --actions         フロー操作スクリプト
  --base-url        サーバー URL（BASE_URL 環境変数でも指定可、デフォルト: http://localhost:5173）
  --storage-state   認証済みセッションの storageState ファイルパス
  --full-page       フルページキャプチャ（デフォルト: false）
  --format          png / webp / jpeg（デフォルト: png）
  --quality         WebP 品質 0-100（デフォルト: 85）
  --max-steps       フローの最大ステップ数（デフォルト: 12）
  --grid-cols       グリッド列数（デフォルト: 2）
  --cell-width      グリッド 1 セルの幅 px（デフォルト: 400）
  --cell-height     グリッド 1 セルの高さ px（デフォルト: 300）

QA / PR 用オプション:
  --pr <N>          PR 番号。tmp/screenshots/pr-N/ に出力 + サーバー自動起動 + Markdown 表示
  --start-server    サーバーが未起動なら自動起動（--pr 時デフォルト: true）
  --no-start-server サーバー自動起動を無効化
  --server-mode     起動するサーバー種別（デフォルト: dev）
                      dev      → npm run dev (port 5173)  デモ・一般画面用
                      cognito  → npm run dev:cognito (port 5174)  認証が必要な画面用
                      lp       → npx serve site (port 5280)  LP (site/) 用

  --help            このヘルプを表示

トラブルシュート:
  撮影に失敗した / 期待した画面が撮れない場合は KB を参照:
    docs/troubleshoot/screenshot_capture.md (SC-NNN)
  既知の罠: MSYS_NO_PATHCONV 不在 / フル URL 二重結合 / /demo/* 不可 /
            DB seed redirect / port 5173 衝突 / waitForTimeout flaky 等
`);
	process.exit(0);
}

// ============================================================
// 引数解決 — --pr で各フラグのデフォルトを上書き
// ============================================================

const prNumber = values.pr ?? null;
const serverMode = values['server-mode'];

/** ユーザーがフラグを明示的に指定したか判定 */
function wasProvided(flag) {
	return process.argv.slice(2).some((a) => a === `--${flag}` || a.startsWith(`--${flag}=`));
}

// --pr が指定された場合の自動デフォルト
let outputDir = values.out;
let presetNames = values.presets.split(',').map((s) => s.trim());
let baseUrl = values['base-url'];

if (prNumber !== null) {
	if (!wasProvided('out')) outputDir = `tmp/screenshots/pr-${prNumber}`;
	if (!wasProvided('presets')) presetNames = ['mobile', 'desktop'];
	if (!wasProvided('base-url') && serverMode === 'cognito') baseUrl = 'http://localhost:5174';
	if (!wasProvided('base-url') && serverMode === 'lp') baseUrl = 'http://localhost:5280';
	console.log(
		'[capture] 生成した画像は GitHub PR コメント / PR 本文にドラッグ＆ドロップして CDN URL を使用してください',
	);
}

// --server-mode だけ指定して --pr なしの場合も base-url を自動解決
if (prNumber === null) {
	if (!wasProvided('base-url') && serverMode === 'cognito') baseUrl = 'http://localhost:5174';
	if (!wasProvided('base-url') && serverMode === 'lp') baseUrl = 'http://localhost:5280';
}

const format = values.format;
const fullPage = values['full-page'];
const quality = Number(values.quality);
const maxSteps = Number(values['max-steps']);
const gridCols = Number(values['grid-cols']);
const cellWidth = Number(values['cell-width']);
const cellHeight = Number(values['cell-height']);
const storageState = values['storage-state'];

// --start-server: --pr 指定時はデフォルト true、それ以外は false
const shouldAutoStart = values['start-server'] ?? prNumber !== null;

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
// サーバー管理ユーティリティ
// ============================================================

/** ポートが使用中か確認 */
function checkPort(port) {
	return new Promise((resolve) => {
		const client = createConnection({ host: '127.0.0.1', port }, () => {
			client.destroy();
			resolve(true);
		});
		client.on('error', () => resolve(false));
		client.setTimeout(1500, () => {
			client.destroy();
			resolve(false);
		});
	});
}

/** baseUrl からポート番号を取得 */
function extractPort(url) {
	try {
		const parsed = new URL(url);
		return Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
	} catch {
		return 5173;
	}
}

/** スポーンしたプロセスを停止（クロスプラットフォーム対応） */
function killProcess(child) {
	if (!child || child.exitCode !== null) return;
	try {
		if (process.platform === 'win32') {
			spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
				stdio: 'ignore',
				shell: false,
				windowsHide: true,
			});
		} else {
			process.kill(-child.pid, 'SIGTERM');
		}
	} catch {
		try {
			child.kill('SIGTERM');
		} catch {
			/* ignore */
		}
	}
}

/**
 * サーバーを起動し、ポートが応答するまで待つ。
 * @param {'dev'|'cognito'|'lp'} mode
 * @param {number} port
 * @returns {Promise<import('node:child_process').ChildProcess>}
 */
async function startServer(mode, port) {
	let args;
	const opts = { stdio: 'ignore', windowsHide: true };

	if (mode === 'lp') {
		// site/ を静的ファイルサーバーで配信
		args = ['exec', 'serve', 'site', '-l', String(port), '--no-clipboard'];
		opts.shell = process.platform === 'win32';
	} else {
		const script = mode === 'cognito' ? 'dev:cognito' : 'dev';
		args = ['run', script];
		opts.shell = process.platform === 'win32';
	}

	console.log(`[server] 起動中: npm ${args.join(' ')} (port ${port})...`);
	const child = spawn('npm', args, { ...opts, detached: process.platform !== 'win32' });

	// 最大 40 秒待機（500ms × 80 回）
	for (let i = 0; i < 80; i++) {
		await new Promise((r) => setTimeout(r, 500));
		if (await checkPort(port)) {
			console.log(`[server] 起動完了 (${((i + 1) * 0.5).toFixed(1)}s)`);
			return child;
		}
	}

	killProcess(child);
	throw new Error(`サーバーが 40 秒以内に起動しませんでした (port ${port})`);
}

// ============================================================
// PR Markdown スニペット生成
// ============================================================

function getCurrentBranch() {
	try {
		return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
	} catch {
		return '<branch>';
	}
}

// ============================================================
// screenshots orphan branch 管理
// ============================================================

/**
 * origin に screenshots ブランチが存在しない場合は orphan ブランチを作成して push する。
 */
function ensureScreenshotsBranch() {
	try {
		const result = execSync('git ls-remote origin screenshots', { encoding: 'utf8' }).trim();
		if (!result) {
			// 存在しない場合は一時ディレクトリで orphan ブランチを作成して push
			const tmpDir = path.join(process.cwd(), 'tmp', 'screenshots-orphan-init');
			try {
				execSync(`git init "${tmpDir}"`, { stdio: 'pipe' });
				execSync('git checkout --orphan screenshots', { cwd: tmpDir, stdio: 'pipe' });
				execSync('git commit --allow-empty -m "init: screenshots orphan branch"', {
					cwd: tmpDir,
					stdio: 'pipe',
				});
				execSync('git remote add origin https://github.com/Takenori-Kusaka/ganbari-quest.git', {
					cwd: tmpDir,
					stdio: 'pipe',
				});
				execSync('git push origin screenshots', { cwd: tmpDir, stdio: 'pipe' });
				console.log('[screenshots] orphan branch を origin に作成しました');
			} finally {
				try {
					fs.rmSync(tmpDir, { recursive: true, force: true });
				} catch {
					/* ignore */
				}
			}
		} else {
			console.log('[screenshots] origin に screenshots ブランチが存在します');
		}
	} catch (e) {
		console.warn('[screenshots] branch 確認/作成に失敗:', e.message);
	}
}

/**
 * 撮影した画像を screenshots ブランチの pr-<N>/ ディレクトリに push する。
 * @param {string} prNum - PR 番号
 * @param {string[]} filePaths - 撮影されたファイルの絶対パス
 * @returns {boolean} push が成功した場合 true
 */
function pushToScreenshotsBranch(prNum, filePaths) {
	if (filePaths.length === 0) return false;

	const worktreePath = path.join(process.cwd(), 'tmp', 'screenshots-push-worktree');

	try {
		// 既存の worktree を削除（残っている場合）
		try {
			execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'pipe' });
		} catch {
			/* ignore */
		}

		// screenshots ブランチを worktree としてチェックアウト
		execSync(`git worktree add "${worktreePath}" screenshots`, { stdio: 'pipe' });

		// pr-<N>/ ディレクトリを作成してファイルをコピー
		const destDir = path.join(worktreePath, `pr-${prNum}`);
		fs.mkdirSync(destDir, { recursive: true });
		for (const fp of filePaths) {
			const dest = path.join(destDir, path.basename(fp));
			fs.copyFileSync(fp, dest);
		}

		// コミットして push
		execSync('git add .', { cwd: worktreePath, stdio: 'pipe' });
		const dateStr = new Date().toISOString().slice(0, 10);
		execSync(`git commit -m "screenshots: PR #${prNum} (${dateStr})"`, {
			cwd: worktreePath,
			stdio: 'pipe',
		});
		execSync('git push origin screenshots', { cwd: worktreePath, stdio: 'pipe' });

		console.log(`[screenshots] PR #${prNum} の画像を screenshots ブランチに push しました`);
		return true;
	} catch (e) {
		console.warn('[screenshots] push に失敗:', e.message);
		return false;
	} finally {
		try {
			execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'pipe' });
		} catch {
			/* ignore */
		}
	}
}

/**
 * @param {string} prNumber
 * @param {string[]} filePaths - 撮影されたファイルの絶対パス
 * @param {boolean} pushedToScreenshots - screenshots ブランチへの push が成功したか
 */
function printPrMarkdown(prNumber, filePaths, pushedToScreenshots) {
	if (filePaths.length === 0) return;

	const screenshotsBase = `https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-${prNumber}`;
	const branch = getCurrentBranch();
	const fallbackBase = `https://github.com/Takenori-Kusaka/ganbari-quest/raw/${branch}`;

	// push が成功した場合は raw.githubusercontent.com URL を使用、失敗時はフォールバック
	const repoBase = pushedToScreenshots ? screenshotsBase : fallbackBase;

	const sep = '='.repeat(60);
	console.log(`\n${sep}`);
	console.log(`PR #${prNumber} — PR body 用 Markdown スニペット（コピーして貼り付けてください）`);
	console.log(sep);
	console.log('\n## スクリーンショット / ビジュアルデモ\n');

	// ファイルをプリセット別にグループ化して表示
	const grouped = new Map();
	for (const fp of filePaths) {
		const name = path.basename(fp, path.extname(fp));
		// push 成功時はファイル名のみ、失敗時は相対パス
		const urlPath = pushedToScreenshots
			? path.basename(fp)
			: path.relative(process.cwd(), fp).replace(/\\/g, '/');
		// preset サフィックス（-mobile / -desktop / -tablet）を検出
		const presetMatch = name.match(/-(mobile|desktop|tablet)$/);
		const label = presetMatch
			? presetMatch[1].charAt(0).toUpperCase() + presetMatch[1].slice(1)
			: name;
		const key = presetMatch ? presetMatch[1] : name;
		grouped.set(key, { label, urlPath, name });
	}

	// desktop → mobile の順で表示
	const order = ['desktop', 'tablet', 'mobile'];
	const sorted = [
		...order.map((k) => grouped.get(k)).filter(Boolean),
		...[...grouped.entries()].filter(([k]) => !order.includes(k)).map(([, v]) => v),
	];

	for (const { label, urlPath, name } of sorted) {
		console.log(`### ${label}`);
		console.log(`![${name}](${repoBase}/${urlPath})\n`);
	}

	console.log(`${sep}\n`);
}

// ============================================================
// フロースタンプシートモード
// ============================================================

async function runFlowMode() {
	const { actions: actionsPath, url } = values;

	if (!actionsPath) {
		console.error('エラー: --flow には --actions が必要です。');
		process.exit(1);
	}
	if (!url) {
		console.error('エラー: --url が必要です。');
		process.exit(1);
	}

	const actionsAbsPath = path.resolve(actionsPath);
	const actionsFileUrl = pathToFileURL(actionsAbsPath).href;
	let actionsModule;
	try {
		actionsModule = await import(actionsFileUrl);
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

	const normalizedUrl = `/${url.replace(/^\/+/, '').replace(/^[A-Za-z]:\/.*Git\//, '')}`;
	console.log(`=== フロースタンプシート生成: ${values.flow} ===`);
	console.log(`URL: ${baseUrl}${normalizedUrl}`);
	console.log(`出力: ${outputDir}\n`);

	try {
		const result = await recorder.record({
			url: normalizedUrl,
			flowName: values.flow,
			actions: actionsFn,
			preset: presetNames[0] ?? 'desktop',
			storageState,
		});
		console.log(`\n完了: ${result.stepCount} ステップ`);
		if (result.compositePath) {
			console.log(`合成 WebP: ${result.compositePath}`);
			console.log(`Markdown: ${path.join(outputDir, `${values.flow}-flow.md`)}`);
			return [result.compositePath];
		}
	} catch (err) {
		console.error(`\nエラー: ${err.message}`);
		process.exit(1);
	}
	return [];
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

	const capturedFiles = [];
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
				capturedFiles.push(result.filePath);
				success++;
			} else {
				console.error(`  エラー: ${result.error.message}`);
			}
		}
	}

	await capturer.teardown();
	console.log(`\n完了: ${success}/${total} キャプチャ`);
	return capturedFiles;
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
	const capturedFiles = [];

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
			capturedFiles.push(result.filePath);
		} else {
			console.error(`  エラー: ${result.error.message}`);
		}
	}

	await capturer.teardown();
	console.log(`\n完了: ${capturedFiles.length}/${presetNames.length} キャプチャ`);
	return capturedFiles;
}

// ============================================================
// エントリーポイント
// ============================================================

let serverChild = null;

// サーバー自動起動
if (shouldAutoStart) {
	const port = extractPort(baseUrl);
	const running = await checkPort(port);
	if (running) {
		console.log(`[server] port ${port} は既に使用中 — サーバー起動をスキップ`);
	} else {
		serverChild = await startServer(serverMode, port);
	}
}

// クリーンアップ登録（自動起動したサーバーのみ停止）
if (serverChild) {
	process.on('exit', () => killProcess(serverChild));
	process.on('SIGINT', () => {
		killProcess(serverChild);
		process.exit(130);
	});
}

try {
	let capturedFiles = [];

	if (values.flow) {
		capturedFiles = await runFlowMode();
	} else if (values.config) {
		capturedFiles = await runConfigMode();
	} else {
		capturedFiles = await runUrlMode();
	}

	// --pr 指定時: screenshots ブランチに push してから PR body 用 Markdown スニペットを出力
	if (prNumber !== null && capturedFiles.length > 0) {
		ensureScreenshotsBranch();
		const pushed = pushToScreenshotsBranch(prNumber, capturedFiles);
		printPrMarkdown(prNumber, capturedFiles, pushed);
	}
} finally {
	// 自動起動したサーバーを確実に停止
	if (serverChild) {
		console.log('[server] 停止します...');
		killProcess(serverChild);
	}
}
