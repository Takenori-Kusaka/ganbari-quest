#!/usr/bin/env node

// scripts/check-lp-visual-regression.mjs
// LP visual regression CI gate (#2401 / #1893 Phase 2)
//
// 目的:
//   `site/screenshots/*.webp` (capture-hp-screenshots.mjs が生成する CI 撮影 SS) と
//   `scripts/lp-screenshot-baseline/*.webp` (git tracked baseline) を pixelmatch で比較し、
//   diff > 10% (THRESHOLD_PCT) で exit 1 する。
//
//   PR #1893 (Phase 1) で baseline ディレクトリ + pixelmatch dev 依存を整備したが、
//   CI gate が未実装だった。本 script + .github/workflows/lp-visual-regression.yml で
//   「意図しない LP visual 変更」「demo 固有 UI 映り込み regression」「dialog auto-open 干渉」を
//   自動検出する。
//
// 設計:
//   - pixelmatch + pngjs + sharp。pixelmatch は PNG diff の業界標準 (stars 6k、MIT)。
//   - baseline / current の dimension が異なる場合は sharp で baseline 解像度に揃える
//     (capture script の viewport は固定だが、playwright バージョン更新で微差が出る可能性)。
//   - WebP → PNG decode は sharp 経由 (`sharp(input).toFormat('png').toBuffer()`)。
//   - 1 image ごとに diff PNG (`tmp/visual-regression-diffs/<name>.png`) を出力 (CI artifact 用)。
//   - per-image diff % を集計し JSON report (`lp-visual-regression.json`) に出力。
//
// CLI:
//   node scripts/check-lp-visual-regression.mjs           # baseline 比較、diff > 10% で exit 1
//   node scripts/check-lp-visual-regression.mjs --json    # JSON のみ出力 (exit code 0 強制)
//   node scripts/check-lp-visual-regression.mjs --update-baseline
//                                                         # current SS を baseline に上書き
//   node scripts/check-lp-visual-regression.mjs --threshold 5
//                                                         # 閾値 % を上書き (default 10)
//   node scripts/check-lp-visual-regression.mjs --baseline-dir <path>
//   node scripts/check-lp-visual-regression.mjs --current-dir <path>
//
// 関連:
//   - scripts/capture-hp-screenshots.mjs (current SS 生成)
//   - .github/workflows/lp-visual-regression.yml (本 script の CI 統合)
//   - Issue #2401 (本 CI gate 実装) / PR #1893 (Phase 1: baseline dir + dep 導入)
//   - ADR-0013 (LP truth: visual も「実装の事実」の一部)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_BASELINE_DIR = path.join(REPO_ROOT, 'scripts/lp-screenshot-baseline');
const DEFAULT_CURRENT_DIR = path.join(REPO_ROOT, 'site/screenshots');
const DEFAULT_DIFF_DIR = path.join(REPO_ROOT, 'tmp/visual-regression-diffs');

// Issue #2401 AC: diff > 10% で fail。閾値緩和は ADR 必須 (Pre-PMF 段階の妥協ライン)。
const DEFAULT_THRESHOLD_PCT = 10;

// pixelmatch 内部 threshold (0-1)。色差感度。0.1 で「人間が知覚できる程度」(pixelmatch README 推奨)。
const PIXELMATCH_THRESHOLD = 0.1;

// ============================================================
// CLI args
// ============================================================

function parseArgs(argv) {
	const args = {
		json: false,
		updateBaseline: false,
		baselineDir: DEFAULT_BASELINE_DIR,
		currentDir: DEFAULT_CURRENT_DIR,
		diffDir: DEFAULT_DIFF_DIR,
		thresholdPct: DEFAULT_THRESHOLD_PCT,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--json') args.json = true;
		else if (arg === '--update-baseline') args.updateBaseline = true;
		else if (arg === '--baseline-dir') args.baselineDir = path.resolve(argv[++i]);
		else if (arg === '--current-dir') args.currentDir = path.resolve(argv[++i]);
		else if (arg === '--diff-dir') args.diffDir = path.resolve(argv[++i]);
		else if (arg === '--threshold') args.thresholdPct = Number(argv[++i]);
		else if (arg === '--help' || arg === '-h') {
			printHelp();
			process.exit(0);
		}
	}
	if (!Number.isFinite(args.thresholdPct) || args.thresholdPct < 0 || args.thresholdPct > 100) {
		console.error(`Error: --threshold must be 0-100, got ${args.thresholdPct}`);
		process.exit(2);
	}
	return args;
}

function printHelp() {
	console.log(`Usage: node scripts/check-lp-visual-regression.mjs [options]

LP visual regression CI gate (#2401 / #1893 Phase 2).

Compares site/screenshots/*.webp (current) with scripts/lp-screenshot-baseline/*.webp (baseline)
using pixelmatch. Fails (exit 1) when any image's diff exceeds the threshold (default 10%).

Options:
  --json                 Output JSON report only, force exit 0 (CI artifact mode).
  --update-baseline      Overwrite baseline/ with current/ contents.
  --baseline-dir <path>  Baseline directory (default: ${DEFAULT_BASELINE_DIR}).
  --current-dir <path>   Current SS directory (default: ${DEFAULT_CURRENT_DIR}).
  --diff-dir <path>      Per-image diff PNG output (default: ${DEFAULT_DIFF_DIR}).
  --threshold <pct>      Diff % threshold for fail (default: ${DEFAULT_THRESHOLD_PCT}).
  -h, --help             Show this help.

Examples:
  node scripts/check-lp-visual-regression.mjs
  node scripts/check-lp-visual-regression.mjs --json > lp-visual-regression.json
  node scripts/check-lp-visual-regression.mjs --update-baseline
`);
}

// ============================================================
// Image decode (.webp → PNG buffer → PNG object)
// ============================================================

/**
 * WebP / PNG ファイルを PNG buffer に decode し、PNG object として返す。
 * baseline と current の dimension が異なる場合は targetWidth/Height にリサイズする。
 *
 * @param {string} filePath
 * @param {{ targetWidth?: number, targetHeight?: number }} [opts]
 * @returns {Promise<PNG>}
 */
async function decodeImage(filePath, opts = {}) {
	let pipeline = sharp(filePath);
	if (opts.targetWidth && opts.targetHeight) {
		pipeline = pipeline.resize(opts.targetWidth, opts.targetHeight, { fit: 'fill' });
	}
	const pngBuffer = await pipeline.toFormat('png').toBuffer();
	return PNG.sync.read(pngBuffer);
}

// ============================================================
// Main compare
// ============================================================

async function listWebpFiles(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.webp'))
		.sort();
}

async function compareOne({ baselinePath, currentPath, diffPath }) {
	// baseline 寸法を先に取得し、current を baseline 寸法にリサイズする
	// (capture script の viewport は固定だが、playwright バージョン更新等で微差が出る可能性)
	const baselineMeta = await sharp(baselinePath).metadata();
	const baselineImg = await decodeImage(baselinePath);
	const currentImg = await decodeImage(currentPath, {
		targetWidth: baselineMeta.width,
		targetHeight: baselineMeta.height,
	});
	const { width, height } = baselineImg;
	const diff = new PNG({ width, height });
	const diffPixels = pixelmatch(baselineImg.data, currentImg.data, diff.data, width, height, {
		threshold: PIXELMATCH_THRESHOLD,
	});
	const totalPixels = width * height;
	const diffPct = (diffPixels / totalPixels) * 100;
	if (diffPath && diffPixels > 0) {
		fs.mkdirSync(path.dirname(diffPath), { recursive: true });
		fs.writeFileSync(diffPath, PNG.sync.write(diff));
	}
	return { diffPixels, totalPixels, diffPct, width, height };
}

async function updateBaselineCmd(args) {
	fs.mkdirSync(args.baselineDir, { recursive: true });
	const currentFiles = await listWebpFiles(args.currentDir);
	if (currentFiles.length === 0) {
		console.error(`Error: ${args.currentDir} に webp ファイルがありません。`);
		console.error('  先に `node scripts/capture-hp-screenshots.mjs --webp` を実行してください。');
		process.exit(2);
	}
	let copied = 0;
	for (const f of currentFiles) {
		fs.copyFileSync(path.join(args.currentDir, f), path.join(args.baselineDir, f));
		copied++;
	}
	console.log(`✅ baseline 更新完了: ${copied} 件 → ${args.baselineDir}`);
	console.log('   commit して PR に同梱してください (visual baseline は git tracked です)。');
}

async function buildReport(args, baselineFiles, currentFiles) {
	const baselineSet = new Set(baselineFiles);
	const currentSet = new Set(currentFiles);
	const report = {
		threshold: args.thresholdPct,
		pixelmatchThreshold: PIXELMATCH_THRESHOLD,
		baselineDir: path.relative(REPO_ROOT, args.baselineDir),
		currentDir: path.relative(REPO_ROOT, args.currentDir),
		images: [],
		missing: baselineFiles.filter((f) => !currentSet.has(f)),
		extra: currentFiles.filter((f) => !baselineSet.has(f)),
		failed: [],
	};
	const common = baselineFiles.filter((f) => currentSet.has(f));
	for (const f of common) {
		const baselinePath = path.join(args.baselineDir, f);
		const currentPath = path.join(args.currentDir, f);
		const diffPath = path.join(args.diffDir, f.replace(/\.webp$/, '.png'));
		try {
			const result = await compareOne({ baselinePath, currentPath, diffPath });
			const entry = {
				name: f,
				diffPct: Number(result.diffPct.toFixed(3)),
				diffPixels: result.diffPixels,
				totalPixels: result.totalPixels,
				width: result.width,
				height: result.height,
				exceeded: result.diffPct > args.thresholdPct,
			};
			report.images.push(entry);
			if (entry.exceeded) report.failed.push(entry);
		} catch (err) {
			const entry = { name: f, error: err.message, exceeded: true };
			report.images.push(entry);
			report.failed.push(entry);
		}
	}
	return report;
}

function printHumanReport(args, report, baselineFiles, currentFiles) {
	console.log('=== LP Visual Regression Check (#2401) ===');
	console.log(`baseline: ${report.baselineDir} (${baselineFiles.length} files)`);
	console.log(`current : ${report.currentDir} (${currentFiles.length} files)`);
	console.log(`threshold: diff > ${args.thresholdPct}% でfail`);
	console.log('');
	if (report.missing.length > 0) {
		console.error(
			`[FAIL] baseline にあるが current にない (撮影漏れ): ${report.missing.length} 件`,
		);
		for (const f of report.missing) console.error(`  - ${f}`);
	}
	if (report.extra.length > 0) {
		console.warn(
			`[WARN] current にあるが baseline にない (新規 SS、要 --update-baseline): ${report.extra.length} 件`,
		);
		for (const f of report.extra) console.warn(`  - ${f}`);
	}
	console.log('');
	console.log('per-image diff:');
	for (const entry of report.images) {
		if (entry.error) {
			console.error(`  [ERROR] ${entry.name}: ${entry.error}`);
		} else {
			const mark = entry.exceeded ? '[FAIL]' : '[OK]  ';
			console.log(
				`  ${mark} ${entry.name.padEnd(50)} diff: ${entry.diffPct.toFixed(3).padStart(7)}%`,
			);
		}
	}
	console.log('');
}

function failWithHint(args, report) {
	console.error(
		`\n[FAIL] visual regression: ${report.failed.length} image(s) exceed ${args.thresholdPct}% diff`,
	);
	console.error('  baseline 差分を確認したうえで:');
	console.error(
		'    - 意図的な変更なら `node scripts/check-lp-visual-regression.mjs --update-baseline`',
	);
	console.error('    - 意図しない regression なら実装を見直してください');
	console.error(`  diff PNG: ${path.relative(REPO_ROOT, args.diffDir)}/`);
	process.exit(1);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.updateBaseline) {
		await updateBaselineCmd(args);
		return;
	}
	const baselineFiles = await listWebpFiles(args.baselineDir);
	const currentFiles = await listWebpFiles(args.currentDir);
	if (baselineFiles.length === 0) {
		console.error(`Error: baseline directory が空: ${args.baselineDir}`);
		console.error('  初回設定: `node scripts/check-lp-visual-regression.mjs --update-baseline`');
		process.exit(2);
	}
	const report = await buildReport(args, baselineFiles, currentFiles);
	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	printHumanReport(args, report, baselineFiles, currentFiles);
	if (report.failed.length > 0 || report.missing.length > 0) {
		failWithHint(args, report);
	}
	console.log('✅ visual regression check PASS');
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(2);
});
