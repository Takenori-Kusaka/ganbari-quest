#!/usr/bin/env node
/**
 * scripts/check-no-demo-route-duplication.mjs
 *
 * ADR-0048 / #2097 AC13: `src/routes/demo/**` 別ツリーの再発を完全ブロックする CI 禁則。
 *
 * ADR-0039 で「`?mode=demo` 駆動で本番ルートに統合」した運用が ADR-0048 (Multi-Lambda Demo
 * Deployment) に進化し、PR-B3 (#2188) で `src/routes/demo/**` 48 ファイルを全削除済。
 * AUTH_MODE=anonymous + DATA_SOURCE=demo の env で起動する demo Lambda が本番ルートを直接
 * host する設計となったため、`src/routes/demo/**` 配下の物理ファイル増加 = アーキテクチャ違反。
 *
 * **strict モード** (#2097 AC13 で昇格、2026-05):
 *   - `src/routes/demo/**` 配下にファイルが 1 件でも存在すれば即 fail
 *   - baseline 比較なし (`scripts/no-demo-route-baseline.txt` は git 履歴として保全のみ)
 *   - 旧 baseline ファイルが存在しても無視 (完全 0 件強制)
 *
 * 使用法:
 *   node scripts/check-no-demo-route-duplication.mjs
 *
 * 失敗条件:
 *   src/routes/demo/ 配下にファイルが 1 件でも存在する場合。
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '../..');
const DEMO_DIR = join(REPO_ROOT, 'src', 'routes', 'demo');

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

function main() {
	const current = listAllFiles(DEMO_DIR);

	if (current.length === 0) {
		console.log(
			'[OK] src/routes/demo/** にファイルなし（ADR-0048 strict モード、#2097 AC13 遵守）',
		);
		process.exit(0);
	}

	console.error(
		`[FAIL] src/routes/demo/** に ${current.length} 件のファイルが検出されました (strict モード違反)。`,
	);
	console.error(
		'       ADR-0048 (Multi-Lambda Demo Deployment) により demo Lambda は AUTH_MODE=anonymous +',
	);
	console.error(
		'       DATA_SOURCE=demo の env で本番ルート (`src/routes/(child)/[uiMode]/**`) を直接 host する。',
	);
	console.error('       `src/routes/demo/**` 配下の物理ファイル増加 = アーキテクチャ違反。');
	console.error('');
	for (const f of current) {
		console.error(`  + ${f}`);
	}
	console.error('');
	console.error(
		'どうしても必要な場合は ADR-0048 を supersede する新 ADR を先に起票してください (#2097 AC13)。',
	);
	process.exit(1);
}

main();
