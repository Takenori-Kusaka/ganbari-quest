#!/usr/bin/env node
/**
 * scripts/check-no-demo-route-duplication.mjs
 *
 * ADR-0039 Phase 2 完遂 CI gate (Issue #2097, 2026-05-15)
 *
 * `src/routes/demo/` 配下にファイルが再生成されていないか strict mode で検証する。
 *
 * Phase 2 で `src/routes/demo/**` 48 ファイルを全削除済。デモは本番ルート
 * (`src/routes/(child)/**` / `src/routes/(parent)/**`) を `?mode=demo` クエリ +
 * `event.locals.isDemo` フラグで駆動する。
 *
 * 例外: `src/routes/api/demo/` 配下は API エンドポイント (cookie 削除等) として
 *       残存可能。本 script は `src/routes/demo/` のみを対象とし、
 *       `src/routes/api/demo/` は対象外。
 *
 * Phase 1 までの baseline 機構は撤廃。`src/routes/demo/` 配下に 1 ファイルでも
 * あれば exit 1 (ADR-0039 Phase 2 strict mode)。
 *
 * 使用法:
 *   node scripts/check-no-demo-route-duplication.mjs
 *
 * Exit codes:
 *   0: OK (src/routes/demo/ にファイルなし)
 *   1: FAIL (再生成された route が検出された)
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
	if (!existsSync(DEMO_DIR)) {
		console.log(
			'[check-no-demo-route-duplication] OK — src/routes/demo/ ディレクトリなし (ADR-0039 Phase 2 完遂)',
		);
		process.exit(0);
	}

	const files = listAllFiles(DEMO_DIR);
	if (files.length === 0) {
		console.log(
			'[check-no-demo-route-duplication] OK — src/routes/demo/ 配下にファイルなし (ADR-0039 Phase 2 完遂)',
		);
		process.exit(0);
	}

	console.error(
		`[check-no-demo-route-duplication] FAIL: src/routes/demo/ 配下に ${files.length} 件のファイルが再生成されている`,
	);
	console.error('');
	console.error('ADR-0039 Phase 2 で /demo/** は完全削除済。本番ルートで ?mode=demo 駆動が正解。');
	console.error('再生成された file 一覧:');
	for (const f of files) {
		console.error(`  - ${f}`);
	}
	console.error('');
	console.error('対応:');
	console.error('  1. 本番ルート (src/routes/(child)/** / (parent)/**) で同等機能を実装する');
	console.error('  2. `+layout.server.ts` / `+page.server.ts` で `if (locals.isDemo) ...` 分岐を入れる');
	console.error('  3. 詳細は docs/decisions/0039-demo-mode-app-execution-mode.md を参照');
	console.error('');
	console.error(
		'どうしても必要な場合は ADR-0039 を supersede する新 ADR を先に起票してください。',
	);

	process.exit(1);
}

main();
