#!/usr/bin/env node
/**
 * scripts/check-orphan-tables.mjs (EPIC #2362 follow-up)
 *
 * Drizzle ORM schema.ts で定義された全 sqliteTable() について、
 * production code (src/lib/server/services / src/routes) からの参照を集計し、
 * seed / test fixture からしか参照されない "orphan table" を検出する。
 *
 * 構造的予防の目的:
 *   - EPIC #2362 で activities 等の orphan が累積していた事故を二度と起こさない
 *   - 新規 table 追加時に「services 経由参照ゼロ」のまま merge されることを CI で block
 *
 * 使用法:
 *   node scripts/check-orphan-tables.mjs              # CI mode (新規 orphan 1+ で exit 1)
 *   node scripts/check-orphan-tables.mjs --report     # 詳細 report
 *   node scripts/check-orphan-tables.mjs --update-baseline  # baseline 更新 (PO レビュー前提)
 *
 * baseline: scripts/orphan-baselines/tables.json
 *
 * 検出ロジック:
 *   1. src/lib/server/db/schema.ts を read し `export const <name> = sqliteTable('<table>', ...)` を抽出
 *   2. 各 table について src/lib/server/services/ + src/routes/ + src/lib/features/ + src/hooks.server.ts
 *      配下から `schema.<exportName>` または `<exportName>` を含む参照を集計
 *   3. production 参照 0 件 = orphan candidate
 *   4. baseline に含まれていなければ exit 1
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	collectReferences,
	loadBaseline,
	parseArgs,
	REPO_ROOT,
	reportFindings,
	walkDir,
} from './lib/orphan-utils.mjs';

const SCHEMA_FILE = path.join(REPO_ROOT, 'src', 'lib', 'server', 'db', 'schema.ts');
const PRODUCTION_DIRS = [
	'src/lib/server/services',
	'src/routes',
	'src/lib/features',
	'src/lib/server/cron',
	// repo 層も production usage path の一部
	'src/lib/server/db/sqlite',
	'src/lib/server/db/dynamodb',
	'src/lib/server/db/demo',
];
const PRODUCTION_FILES = [
	'src/hooks.server.ts',
	// db/ 直下の facade も production
	'src/lib/server/db/factory.ts',
];

// schema.ts 自身と seed.ts は exclude (seed-only usage は orphan 判定の対象)
const EXCLUDE_FILE_PATTERNS = [
	/src[\\/]lib[\\/]server[\\/]db[\\/]schema\.ts$/,
	/src[\\/]lib[\\/]server[\\/]db[\\/]seed\.ts$/,
	/src[\\/]lib[\\/]server[\\/]db[\\/]migrations[\\/]/,
];

function applyExcludes(files) {
	return files.filter((f) => {
		const rel = path.relative(REPO_ROOT, f).replace(/\\/g, '/');
		return !EXCLUDE_FILE_PATTERNS.some((p) => p.test(rel));
	});
}

/**
 * schema.ts から sqliteTable export を抽出する。
 * Returns: Array<{ exportName, tableName }>
 */
export function extractTables(schemaText) {
	const tables = [];
	// e.g. `export const activities = sqliteTable('activities', ...)`
	//      `export const childActivities = sqliteTable(\n  'child_activities',\n  ...)`
	const lines = schemaText.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const m = line.match(/^export\s+const\s+(\w+)\s*=\s*sqliteTable\s*\(\s*$/);
		if (m) {
			// 次行に table 名がある
			const nextLine = lines[i + 1] || '';
			const tn = nextLine.match(/^\s*['"`]([\w_]+)['"`]/);
			if (tn) {
				tables.push({ exportName: m[1], tableName: tn[1] });
				continue;
			}
		}
		const m2 = line.match(/^export\s+const\s+(\w+)\s*=\s*sqliteTable\s*\(\s*['"`]([\w_]+)['"`]/);
		if (m2) {
			tables.push({ exportName: m2[1], tableName: m2[2] });
		}
	}
	return tables;
}

function main() {
	const args = parseArgs(process.argv);
	const mode = args.updateBaseline ? 'update-baseline' : args.report ? 'report' : 'check';
	const baseline = loadBaseline('tables');

	if (!fs.existsSync(SCHEMA_FILE)) {
		process.stderr.write(`[check-orphan-tables] schema.ts not found: ${SCHEMA_FILE}\n`);
		process.exit(1);
	}
	const schemaText = fs.readFileSync(SCHEMA_FILE, 'utf8');
	const tables = extractTables(schemaText);

	if (tables.length === 0) {
		process.stderr.write('[check-orphan-tables] no tables found in schema.ts (parse error?)\n');
		process.exit(1);
	}

	// production code を収集
	const rawFiles = [];
	for (const d of PRODUCTION_DIRS) {
		rawFiles.push(...walkDir(path.join(REPO_ROOT, d), { extensions: ['.ts', '.svelte'] }));
	}
	for (const f of PRODUCTION_FILES) {
		const p = path.join(REPO_ROOT, f);
		if (fs.existsSync(p)) rawFiles.push(p);
	}
	const files = applyExcludes(rawFiles);

	// 各 table の exportName 参照を集計
	const needles = tables.map((t) => t.exportName);
	const refs = collectReferences(needles, files, { boundary: true });

	const findings = tables
		.map((t) => {
			const r = refs.get(t.exportName) || [];
			if (r.length === 0) {
				return {
					name: t.tableName,
					reason: `schema export "${t.exportName}" (table "${t.tableName}") は production code 経路 (services / routes / features / hooks.server.ts / repo 層) から参照されていません。seed.ts / tests / migrations のみで使われている可能性があります。`,
					locations: [],
					allowlisted: baseline.allowed.includes(t.tableName),
				};
			}
			return null;
		})
		.filter(Boolean);

	const exit = reportFindings('tables', findings, { mode, baseline });
	process.exit(exit);
}

// CLI エントリ
const isMain =
	import.meta.url === `file://${(process.argv[1] || '').replace(/\\/g, '/')}` ||
	(process.argv[1] || '').endsWith('check-orphan-tables.mjs');
if (isMain) {
	main();
}
