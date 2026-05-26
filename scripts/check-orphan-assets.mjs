#!/usr/bin/env node
/**
 * scripts/check-orphan-assets.mjs (EPIC #2362 follow-up)
 *
 * static/assets/ + site/assets/ 配下の画像 / SVG / WebP について、
 * src/ / site/ / scripts/ / docs/ から参照ゼロのものを検出する。
 *
 * 使用法:
 *   node scripts/check-orphan-assets.mjs            # CI mode
 *   node scripts/check-orphan-assets.mjs --report   # 詳細 report
 *   node scripts/check-orphan-assets.mjs --update-baseline
 *
 * baseline: scripts/orphan-baselines/assets.json
 *
 * 検出ロジック:
 *   1. static/assets/ + site/assets/ 配下の画像/SVG/WebP を列挙
 *   2. 各 file basename について src/ / site/ / scripts/ / docs/ 全体 grep
 *   3. 参照ゼロ = orphan
 *
 * NOTE: site/screenshots/ は .gitignore で git 外管理。本 script では対象外。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	loadBaseline,
	parseArgs,
	REPO_ROOT,
	reportFindings,
	walkDir,
} from './lib/orphan-utils.mjs';

const ASSET_ROOTS = [
	{ root: path.join(REPO_ROOT, 'static', 'assets'), relPrefix: 'static/assets' },
	{ root: path.join(REPO_ROOT, 'site', 'assets'), relPrefix: 'site/assets' },
];
const ASSET_EXTENSIONS = ['.png', '.svg', '.jpg', '.jpeg', '.webp', '.gif', '.ico'];

const SEARCH_DIRS = ['src', 'site', 'scripts', 'docs', 'tests'];
const SEARCH_EXTENSIONS = ['.ts', '.svelte', '.mjs', '.js', '.html', '.css', '.md', '.json'];

function main() {
	const args = parseArgs(process.argv);
	const mode = args.updateBaseline ? 'update-baseline' : args.report ? 'report' : 'check';
	const baseline = loadBaseline('assets');

	// asset を列挙
	const assets = [];
	for (const { root } of ASSET_ROOTS) {
		if (!fs.existsSync(root)) continue;
		for (const f of walkDir(root, { extensions: ASSET_EXTENSIONS })) {
			assets.push(path.relative(REPO_ROOT, f).replace(/\\/g, '/'));
		}
	}

	if (assets.length === 0) {
		process.stdout.write('[check-orphan-assets] no assets found\n');
		process.exit(0);
	}

	// 検索対象 source code
	// NOTE: scripts/orphan-baselines/ + docs/operations/orphan-audit-*.md は self-reference を含むため除外
	const EXCLUDE_PATTERNS = [
		/scripts[\\/]orphan-baselines[\\/]/,
		/docs[\\/]operations[\\/]orphan-audit-/,
	];
	const searchFiles = [];
	for (const d of SEARCH_DIRS) {
		const full = path.join(REPO_ROOT, d);
		if (fs.existsSync(full)) {
			searchFiles.push(
				...walkDir(full, { extensions: SEARCH_EXTENSIONS, excludePatterns: EXCLUDE_PATTERNS }),
			);
		}
	}

	// 各 asset の basename 出現を 1 pass scan で集計
	const refCount = new Map();
	for (const a of assets) refCount.set(a, 0);
	const basenameMap = new Map(); // basename -> asset[]
	for (const a of assets) {
		const bn = path.basename(a);
		if (!basenameMap.has(bn)) basenameMap.set(bn, []);
		basenameMap.get(bn).push(a);
	}

	for (const file of searchFiles) {
		let text;
		try {
			text = fs.readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		for (const [bn, candidates] of basenameMap) {
			if (text.includes(bn)) {
				for (const a of candidates) refCount.set(a, (refCount.get(a) || 0) + 1);
			}
		}
	}

	const findings = assets
		.map((a) => {
			if ((refCount.get(a) || 0) === 0) {
				return {
					name: a,
					reason: `asset "${a}" はリポジトリ内 source code から参照されていません。dead asset の可能性。`,
					locations: [],
					allowlisted: baseline.allowed.includes(a),
				};
			}
			return null;
		})
		.filter(Boolean);

	const exit = reportFindings('assets', findings, { mode, baseline });
	process.exit(exit);
}

const isMain =
	import.meta.url === `file://${(process.argv[1] || '').replace(/\\/g, '/')}` ||
	(process.argv[1] || '').endsWith('check-orphan-assets.mjs');
if (isMain) {
	main();
}
