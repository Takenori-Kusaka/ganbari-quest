#!/usr/bin/env node
/**
 * scripts/check-orphan-services.mjs (EPIC #2362 follow-up)
 *
 * src/lib/server/services/*.ts に存在する service module について、
 * caller (`from .../<service-name>` の import 元) が 0 件のものを検出する。
 *
 * 構造的予防の目的:
 *   - 機能撤去 / scope 変更で実装ファイルだけ残った dead code を可視化
 *   - 新規 service 追加時に「どこからも import されていない」状態の merge を block
 *
 * 使用法:
 *   node scripts/check-orphan-services.mjs              # CI mode
 *   node scripts/check-orphan-services.mjs --report     # 詳細 report
 *   node scripts/check-orphan-services.mjs --update-baseline
 *
 * baseline: scripts/orphan-baselines/services.json
 *
 * 検出ロジック:
 *   1. src/lib/server/services/ 配下の *.ts (含む subdir) を列挙
 *   2. 各 service について `src/` 全体から basename を含む import 行を探す
 *   3. 自分自身 + 同名 *.test.ts / *.spec.ts を除外し、参照 0 件 = orphan
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	collectFileImports,
	loadBaseline,
	parseArgs,
	REPO_ROOT,
	reportFindings,
	walkDir,
} from './lib/orphan-utils.mjs';

const SERVICES_DIR = path.join(REPO_ROOT, 'src', 'lib', 'server', 'services');
const SEARCH_DIRS = ['src', 'tests/unit', 'tests/integration', 'tests/e2e'];

function main() {
	const args = parseArgs(process.argv);
	const mode = args.updateBaseline ? 'update-baseline' : args.report ? 'report' : 'check';
	const baseline = loadBaseline('services');

	if (!fs.existsSync(SERVICES_DIR)) {
		process.stderr.write(`[check-orphan-services] services dir not found: ${SERVICES_DIR}\n`);
		process.exit(1);
	}

	const services = walkDir(SERVICES_DIR, { extensions: ['.ts'] })
		.filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'))
		.map((f) => path.relative(REPO_ROOT, f).replace(/\\/g, '/'));

	// 検索対象 (caller 候補): src/ 全体 + tests/
	const searchFiles = [];
	for (const d of SEARCH_DIRS) {
		const full = path.join(REPO_ROOT, d);
		if (fs.existsSync(full)) {
			searchFiles.push(...walkDir(full, { extensions: ['.ts', '.svelte', '.mjs', '.js'] }));
		}
	}

	const refs = collectFileImports(services, searchFiles);

	const findings = services
		.map((s) => {
			const r = refs.get(s) || [];
			// 自分自身からの import (再 export 等) は collectFileImports で除外済
			// 同名 test / spec からのみ参照は orphan 扱い (production 経路ゼロ)
			const productionRefs = r.filter((ref) => {
				const rf = ref.file;
				if (rf.endsWith('.test.ts') || rf.endsWith('.spec.ts') || rf.endsWith('.test.mjs'))
					return false;
				if (rf.startsWith('tests/')) return false;
				return true;
			});
			if (productionRefs.length === 0) {
				return {
					name: s,
					reason: `service "${path.basename(s, '.ts')}" は production code (test 外) から import されていません。test 専用なら tests/ 配下に移すか、未使用なら削除候補です。`,
					locations: r.slice(0, 5).map((ref) => `${ref.file}:${ref.line}`),
					allowlisted: baseline.allowed.includes(s),
				};
			}
			return null;
		})
		.filter(Boolean);

	const exit = reportFindings('services', findings, { mode, baseline });
	process.exit(exit);
}

const isMain =
	import.meta.url === `file://${(process.argv[1] || '').replace(/\\/g, '/')}` ||
	(process.argv[1] || '').endsWith('check-orphan-services.mjs');
if (isMain) {
	main();
}
