#!/usr/bin/env node
/**
 * scripts/check-orphan-labels.mjs (EPIC #2362 follow-up)
 *
 * src/lib/domain/labels.ts の `LABELS` namespace export (compound) と
 * src/lib/domain/terms.ts の `TERMS` namespace export (atom) について、
 * src/ / site/ / scripts/ / tests/ から参照されていないものを検出する。
 *
 * 構造的予防の目的:
 *   - 機能撤去で labels.ts の namespace が取り残されるのを可視化
 *   - ADR-0045 SSOT (atom → compound → 表示) の最末端 dead constant を block
 *
 * 使用法:
 *   node scripts/check-orphan-labels.mjs              # CI mode
 *   node scripts/check-orphan-labels.mjs --report     # 詳細 report
 *   node scripts/check-orphan-labels.mjs --update-baseline
 *
 * baseline: scripts/orphan-baselines/labels.json
 *
 * 検出ロジック:
 *   1. labels.ts / terms.ts から `export const <UPPER_CASE>` を抽出
 *   2. 各 export について src/ / site/ / tests/ / scripts/ 全体から参照を集計
 *   3. site/shared-labels.js (自動生成) は SEARCH_DIRS から除外
 *   4. 自分自身ファイルからの参照は除外、boundary match
 *   5. 参照 0 件 = orphan
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

const LABELS_FILE = path.join(REPO_ROOT, 'src', 'lib', 'domain', 'labels.ts');
const TERMS_FILE = path.join(REPO_ROOT, 'src', 'lib', 'domain', 'terms.ts');
const SEARCH_DIRS = ['src', 'tests/unit', 'tests/integration', 'tests/e2e', 'scripts'];

// site/ は LP 経路 (shared-labels.js 経由) なので special-case で取り扱う:
//   - shared-labels.js は自動生成 (scripts/generate-lp-labels.mjs) なので参照源としては不適
//   - site/*.html の `data-label-key="..."` 経由参照を別途検出する必要
// 簡易方針: site/ 全体を search に含め、shared-labels.js のみ exclude
const SITE_DIR = path.join(REPO_ROOT, 'site');
const SITE_EXCLUDE = [/site[\\/]shared-labels\.js$/];

function extractExports(text) {
	const re =
		/^export\s+(?:const|let|function|class|type|interface)\s+([A-Z][A-Z0-9_]+|[A-Z]\w+)\b/gm;
	const out = [];
	let m;
	while ((m = re.exec(text)) !== null) {
		out.push(m[1]);
	}
	return out;
}

function main() {
	const args = parseArgs(process.argv);
	const mode = args.updateBaseline ? 'update-baseline' : args.report ? 'report' : 'check';
	const baseline = loadBaseline('labels');

	const exports = [];
	const sources = new Map(); // name -> file

	for (const f of [LABELS_FILE, TERMS_FILE]) {
		if (!fs.existsSync(f)) {
			process.stderr.write(`[check-orphan-labels] file not found: ${f}\n`);
			process.exit(1);
		}
		const text = fs.readFileSync(f, 'utf8');
		const rel = path.relative(REPO_ROOT, f).replace(/\\/g, '/');
		for (const name of extractExports(text)) {
			exports.push(name);
			sources.set(name, rel);
		}
	}

	// search 対象を収集 (orphan-baselines / orphan-audit ドキュメントは self-reference 除外)
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
	// site/ も含める (LP HTML 内の data-label-key 等で参照されるかもしれないが、
	//   shared-labels.js auto-generated 経由が主経路。HTML / JS / CSS を walk)
	if (fs.existsSync(SITE_DIR)) {
		const siteFiles = walkDir(SITE_DIR, {
			extensions: ['.html', '.js', '.mjs', '.css'],
			excludePatterns: SITE_EXCLUDE,
		});
		searchFiles.push(...siteFiles);
	}

	const refs = collectReferences(exports, searchFiles, { boundary: true });

	const findings = exports
		.map((name) => {
			const r = refs.get(name) || [];
			const sourceFile = sources.get(name);
			const external = r.filter((ref) => ref.file !== sourceFile);
			if (external.length === 0) {
				return {
					name,
					reason: `label/term export "${name}" は外部から参照されていません (定義元: ${sourceFile})。機能撤去で取り残された可能性、または ADR-0045 SSOT 経由参照 (terms ↔ labels) のみ。`,
					locations: [],
					allowlisted: baseline.allowed.includes(name),
				};
			}
			return null;
		})
		.filter(Boolean);

	const exit = reportFindings('labels', findings, { mode, baseline });
	process.exit(exit);
}

const isMain =
	import.meta.url === `file://${(process.argv[1] || '').replace(/\\/g, '/')}` ||
	(process.argv[1] || '').endsWith('check-orphan-labels.mjs');
if (isMain) {
	main();
}
