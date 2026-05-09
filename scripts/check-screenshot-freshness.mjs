#!/usr/bin/env node
/**
 * scripts/check-screenshot-freshness.mjs (#1893, PO-4-7、8 回目指摘)
 *
 * site/screenshots/*.webp の生成時刻が「期待される撮影タイミング」より古くないかを検証する。
 * pages.yml の撮影直後に呼び出すことで「撮影が黙ってスキップされた」事故を検出する。
 *
 * 設計意図 (Issue #1893):
 *   LP 配信 SS が本番 NUC ユーザの実画面と乖離する事故が PO 直接指摘 8 回連続で再発した。
 *   根本原因の一つが「pages.yml が SS 撮影を skip しても fail せず、古い WebP がそのまま
 *   GitHub Pages に配信される」構造的問題。本スクリプトは撮影直後に「全 WebP の mtime が
 *   N 分以内」を機械的に検証することで、撮影スキップ事故を CI fail として検出する。
 *
 * 判定ロジック:
 *   - site/screenshots/*.webp 全ファイルの mtime を取得
 *   - 各 mtime が `Date.now() - --max-age-minutes` より古い場合 fail
 *   - default `--max-age-minutes 30` (pages.yml が 30 分以内に撮影完了する想定)
 *
 * 使用法:
 *   node scripts/check-screenshot-freshness.mjs
 *   node scripts/check-screenshot-freshness.mjs --max-age-minutes 60
 *   node scripts/check-screenshot-freshness.mjs --site-dir site
 *
 * Exit code:
 *   0 — 全 WebP が新しい / または site/screenshots/ が空 (撮影前の段階)
 *   1 — 少なくとも 1 件の WebP が古い (撮影スキップ疑い)
 *
 * 設計選定 (OSS 先調査 — ADR-0014 / #1350):
 *   - 採用: Node.js 標準 `fs.statSync` のみ (依存ゼロ、Pre-PMF 最適 — ADR-0010)
 *   - 不採用: `chokidar` 等 watch ライブラリ (本ユースケースは one-shot チェック)
 *
 * 関連:
 *   - .github/workflows/pages.yml (撮影直後に呼び出す)
 *   - scripts/capture-hp-screenshots.mjs (#1783 撮影失敗 1 件で exit 1 と相補)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * CLI 引数を parse する。
 *
 * @param {string[]} argv - process.argv.slice(2) 相当
 * @returns {{ maxAgeMinutes: number; siteDir: string; verbose: boolean }}
 */
export function parseArgs(argv) {
	let maxAgeMinutes = 30;
	let siteDir = 'site';
	let verbose = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--max-age-minutes') {
			const v = Number(argv[i + 1]);
			if (!Number.isFinite(v) || v <= 0) {
				throw new Error(`--max-age-minutes は正数を指定してください (got: ${argv[i + 1]})`);
			}
			maxAgeMinutes = v;
			i++;
		} else if (arg === '--site-dir') {
			siteDir = argv[i + 1];
			if (!siteDir) {
				throw new Error('--site-dir には値を指定してください');
			}
			i++;
		} else if (arg === '--verbose') {
			verbose = true;
		} else if (arg === '--help' || arg === '-h') {
			console.log(
				`Usage: node scripts/check-screenshot-freshness.mjs [--max-age-minutes N] [--site-dir DIR] [--verbose]\n\n` +
					`  --max-age-minutes N  各 webp の mtime がこの分数より古ければ fail (default: 30)\n` +
					`  --site-dir DIR       site ディレクトリパス (default: site)\n` +
					`  --verbose            詳細ログ\n`,
			);
			process.exit(0);
		}
	}

	return { maxAgeMinutes, siteDir, verbose };
}

/**
 * site/screenshots/ 配下の WebP ファイル一覧を取得する。
 *
 * @param {string} siteDir
 * @returns {string[]} 絶対パス配列
 */
export function listWebpFiles(siteDir) {
	const screenshotsDir = path.join(REPO_ROOT, siteDir, 'screenshots');
	if (!fs.existsSync(screenshotsDir)) return [];
	const entries = fs.readdirSync(screenshotsDir);
	return entries
		.filter((name) => name.endsWith('.webp'))
		.map((name) => path.join(screenshotsDir, name));
}

/**
 * ファイル mtime と現在時刻の差分(分)を返す。
 *
 * @param {string} filePath
 * @param {Date} [now=new Date()]
 * @returns {number} 差分(分)
 */
export function getFileAgeMinutes(filePath, now = new Date()) {
	const stat = fs.statSync(filePath);
	const ageMs = now.getTime() - stat.mtime.getTime();
	return ageMs / (60 * 1000);
}

/**
 * チェックを実行し、結果を返す。
 *
 * @param {object} options
 * @param {number} options.maxAgeMinutes
 * @param {string} options.siteDir
 * @param {boolean} [options.verbose]
 * @param {Date} [options.now=new Date()] - テスト用
 * @returns {{
 *   ok: boolean;
 *   total: number;
 *   stale: Array<{ path: string; ageMinutes: number }>;
 *   fresh: Array<{ path: string; ageMinutes: number }>;
 *   skipped: boolean;
 * }}
 */
export function checkFreshness({ maxAgeMinutes, siteDir, verbose = false, now = new Date() }) {
	const files = listWebpFiles(siteDir);
	if (files.length === 0) {
		return { ok: true, total: 0, stale: [], fresh: [], skipped: true };
	}

	const stale = [];
	const fresh = [];

	for (const filePath of files) {
		const ageMinutes = getFileAgeMinutes(filePath, now);
		const entry = {
			path: path.relative(REPO_ROOT, filePath).split(path.sep).join('/'),
			ageMinutes,
		};
		if (ageMinutes > maxAgeMinutes) {
			stale.push(entry);
		} else {
			fresh.push(entry);
		}
		if (verbose) {
			console.log(
				`  ${ageMinutes > maxAgeMinutes ? 'STALE' : 'fresh'}: ${entry.path} (${ageMinutes.toFixed(1)} 分前)`,
			);
		}
	}

	return {
		ok: stale.length === 0,
		total: files.length,
		stale,
		fresh,
		skipped: false,
	};
}

/**
 * チェック結果をコンソールに出力する。
 *
 * @param {ReturnType<typeof checkFreshness>} result
 * @param {{ maxAgeMinutes: number }} options
 */
export function printResult(result, { maxAgeMinutes }) {
	if (result.skipped) {
		console.log('[check-screenshot-freshness] site/screenshots/ が空のためスキップ (撮影前段階)');
		return;
	}
	if (result.ok) {
		console.log(
			`[check-screenshot-freshness] OK: 全 ${result.total} 件の WebP が ${maxAgeMinutes} 分以内に生成されています`,
		);
		return;
	}
	console.error(
		`[check-screenshot-freshness] FAIL: ${result.stale.length}/${result.total} 件の WebP が ${maxAgeMinutes} 分より古い`,
	);
	console.error('  → pages.yml の撮影 step がスキップされた疑いがあります (Issue #1893)');
	console.error('  古い WebP 一覧 (mtime 古い順、上位 10 件):');
	const sorted = [...result.stale].sort((a, b) => b.ageMinutes - a.ageMinutes);
	for (const entry of sorted.slice(0, 10)) {
		const ageHours = (entry.ageMinutes / 60).toFixed(1);
		console.error(`    - ${entry.path} (${ageHours} 時間前)`);
	}
	if (result.stale.length > 10) {
		console.error(`    ... and ${result.stale.length - 10} more`);
	}
}

function main() {
	const { maxAgeMinutes, siteDir, verbose } = parseArgs(process.argv.slice(2));
	const result = checkFreshness({ maxAgeMinutes, siteDir, verbose });
	printResult(result, { maxAgeMinutes });
	process.exit(result.ok ? 0 : 1);
}

// CLI 実行時のみ main() を呼ぶ。テストから import される場合は副作用なし
const invokedAsCli = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedAsCli) {
	main();
}
