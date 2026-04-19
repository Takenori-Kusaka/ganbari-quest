#!/usr/bin/env node
/**
 * scripts/check-no-demo-route-duplication.mjs
 *
 * ADR-0039 / #1180: `src/routes/demo/**` 別ツリーの再発を防ぐ CI 禁則。
 *
 * 本 ADR により、デモは `?mode=demo` → cookie → `locals.isDemo` で本番ルート上で
 * 駆動する「実行モード」に統合された。
 *
 * Phase 1 の本 PR では `src/routes/demo/**` を維持している（移行期）。
 * Phase 2 で削除後は本スクリプトを `mode='strict'` に切り替え、新規ファイル作成を
 * 完全ブロックする運用に移行する。
 *
 * 現状は **baseline 比較** で「新規追加ファイルがあれば fail、既存ファイルは通す」運用。
 *
 * 使用法:
 *   node scripts/check-no-demo-route-duplication.mjs
 *
 * 失敗条件:
 *   baseline list (scripts/no-demo-route-baseline.txt) に無いファイルが
 *   src/routes/demo/ 配下に存在する場合。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '../..');
const DEMO_DIR = join(REPO_ROOT, 'src', 'routes', 'demo');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'no-demo-route-baseline.txt');

function listAllFiles(dir) {
	if (!existsSync(dir)) return [];
	const results = [];
	function walk(current) {
		for (const entry of readdirSync(current)) {
			const fullPath = join(current, entry);
			const rel = relative(REPO_ROOT, fullPath).replaceAll('\\', '/');
			if (statSync(fullPath).isDirectory()) {
				walk(fullPath);
			} else {
				results.push(rel);
			}
		}
	}
	walk(dir);
	return results.sort();
}

function readBaseline() {
	if (!existsSync(BASELINE_PATH)) {
		return new Set();
	}
	return new Set(
		readFileSync(BASELINE_PATH, 'utf8')
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.filter((l) => !l.startsWith('#')),
	);
}

function main() {
	const baseline = readBaseline();
	const current = listAllFiles(DEMO_DIR);
	const newFiles = current.filter((f) => !baseline.has(f));

	if (newFiles.length === 0) {
		console.log('[OK] src/routes/demo/** に新規ファイルなし（ADR-0039 遵守）');
		process.exit(0);
	}

	console.error(`[FAIL] src/routes/demo/** への新規追加が検出されました (${newFiles.length} 件)。`);
	console.error('       ADR-0039 によりデモは本番ルート上で ?mode=demo 駆動に統合済み。');
	console.error('       新規ファイルを追加するのではなく、本番ルート側に実装してください。');
	console.error('');
	for (const f of newFiles) {
		console.error(`  + ${f}`);
	}
	console.error('');
	console.error('どうしても必要な場合は ADR-0039 を supersede する新 ADR を先に起票してください。');
	process.exit(1);
}

main();
