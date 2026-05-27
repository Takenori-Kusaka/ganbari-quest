#!/usr/bin/env node
/**
 * scripts/check-orphan-fixtures.mjs (EPIC #2362 follow-up)
 *
 * src/lib/server/demo/demo-data.ts (および demo/fixtures) の `export const DEMO_*`
 * fixture について、production code / 他 demo / tests からの参照を集計し、
 * 参照ゼロ = dead fixture を検出する。
 *
 * 構造的予防の目的:
 *   - demo fixture が機能撤去で取り残されるのを可視化
 *   - LP SS 撮影で新たに必要となる fixture 追加時に対称的に削除忘れを検出
 *
 * 使用法:
 *   node scripts/check-orphan-fixtures.mjs              # CI mode
 *   node scripts/check-orphan-fixtures.mjs --report     # 詳細 report
 *   node scripts/check-orphan-fixtures.mjs --update-baseline
 *
 * baseline: scripts/orphan-baselines/fixtures.json
 *
 * 検出ロジック:
 *   1. src/lib/server/demo/ の *.ts から `export const <UPPER_NAME>` を抽出
 *   2. 各 export について src/ / tests/ 全体から identifier 参照を集計
 *   3. 自分自身のファイルを除き、参照 0 件 = orphan candidate
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

const DEMO_DIRS = [path.join(REPO_ROOT, 'src', 'lib', 'server', 'demo')];
const SEARCH_DIRS = ['src', 'tests/unit', 'tests/integration', 'tests/e2e', 'scripts'];

function extractExports(text) {
	// `export const NAME = ...` / `export function NAME(...)`
	const re = /^export\s+(?:const|let|function|class)\s+([A-Z][A-Z0-9_]*)\b/gm;
	const out = [];
	for (const m of text.matchAll(re)) {
		out.push(m[1]);
	}
	return out;
}

function main() {
	const args = parseArgs(process.argv);
	const mode = args.updateBaseline ? 'update-baseline' : args.report ? 'report' : 'check';
	const baseline = loadBaseline('fixtures');

	// fixture exports を抽出
	const exportsByFile = new Map(); // exportName -> sourceFile
	for (const d of DEMO_DIRS) {
		if (!fs.existsSync(d)) continue;
		for (const f of walkDir(d, { extensions: ['.ts'] })) {
			if (f.endsWith('.test.ts') || f.endsWith('.spec.ts')) continue;
			const text = fs.readFileSync(f, 'utf8');
			for (const name of extractExports(text)) {
				if (!exportsByFile.has(name)) exportsByFile.set(name, []);
				exportsByFile.get(name).push(path.relative(REPO_ROOT, f).replace(/\\/g, '/'));
			}
		}
	}

	const allExports = [...exportsByFile.keys()];

	if (allExports.length === 0) {
		process.stdout.write(
			'[check-orphan-fixtures] OK — no UPPER_CASE exports found in demo/ (nothing to check)\n',
		);
		process.exit(0);
	}

	// 検索対象を収集 (orphan-baselines / orphan-audit ドキュメントは self-reference 除外)
	const EXCLUDE_PATTERNS = [
		/scripts[\\/]orphan-baselines[\\/]/,
		/docs[\\/]operations[\\/]orphan-audit-/,
	];
	const searchFiles = [];
	for (const d of SEARCH_DIRS) {
		const full = path.join(REPO_ROOT, d);
		if (fs.existsSync(full)) {
			searchFiles.push(
				...walkDir(full, {
					extensions: ['.ts', '.svelte', '.mjs', '.js'],
					excludePatterns: EXCLUDE_PATTERNS,
				}),
			);
		}
	}

	const refs = collectReferences(allExports, searchFiles, { boundary: true });

	const findings = allExports
		.map((name) => {
			const r = refs.get(name) || [];
			const sourceFiles = new Set(exportsByFile.get(name) || []);
			// 自分自身の定義ファイルからの参照は除外
			const external = r.filter((ref) => !sourceFiles.has(ref.file));
			if (external.length === 0) {
				return {
					name,
					reason: `demo fixture "${name}" は外部から参照されていません (定義元: ${[...sourceFiles].join(', ')})。機能撤去で取り残された可能性。`,
					locations: [],
					allowlisted: baseline.allowed.includes(name),
				};
			}
			return null;
		})
		.filter(Boolean);

	const exit = reportFindings('fixtures', findings, { mode, baseline });
	process.exit(exit);
}

const isMain =
	import.meta.url === `file://${(process.argv[1] || '').replace(/\\/g, '/')}` ||
	(process.argv[1] || '').endsWith('check-orphan-fixtures.mjs');
if (isMain) {
	main();
}
