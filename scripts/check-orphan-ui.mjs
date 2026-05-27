#!/usr/bin/env node
/**
 * scripts/check-orphan-ui.mjs (EPIC #2362 follow-up)
 *
 * src/lib/ui/{primitives,components,features}/**.svelte について、
 * import 元 0 件のものを検出する。Storybook stories (`*.stories.svelte`) は
 * 純粋な視覚検証用途なので、stories からのみ参照される component は orphan 扱いする。
 *
 * 使用法:
 *   node scripts/check-orphan-ui.mjs                # CI mode
 *   node scripts/check-orphan-ui.mjs --report       # 詳細 report
 *   node scripts/check-orphan-ui.mjs --update-baseline
 *
 * baseline: scripts/orphan-baselines/ui.json
 *
 * 検出ロジック:
 *   1. src/lib/ui/ 配下の *.svelte (excl. *.stories.svelte) を列挙
 *   2. 各 component basename について src/ / tests/ 全体から import 文を探す
 *   3. 自分自身 + 同名 stories からのみ参照 = orphan
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

const UI_DIRS = [
	path.join(REPO_ROOT, 'src', 'lib', 'ui', 'primitives'),
	path.join(REPO_ROOT, 'src', 'lib', 'ui', 'components'),
	path.join(REPO_ROOT, 'src', 'lib', 'ui', 'features'),
];
const SEARCH_DIRS = ['src', 'tests/unit', 'tests/integration', 'tests/e2e'];

function main() {
	const args = parseArgs(process.argv);
	const mode = args.updateBaseline ? 'update-baseline' : args.report ? 'report' : 'check';
	const baseline = loadBaseline('ui');

	const components = [];
	for (const d of UI_DIRS) {
		if (!fs.existsSync(d)) continue;
		for (const f of walkDir(d, { extensions: ['.svelte'] })) {
			if (f.endsWith('.stories.svelte')) continue;
			components.push(path.relative(REPO_ROOT, f).replace(/\\/g, '/'));
		}
	}

	const searchFiles = [];
	for (const d of SEARCH_DIRS) {
		const full = path.join(REPO_ROOT, d);
		if (fs.existsSync(full)) {
			searchFiles.push(...walkDir(full, { extensions: ['.ts', '.svelte', '.mjs', '.js'] }));
		}
	}

	const refs = collectFileImports(components, searchFiles);

	const findings = components
		.map((c) => {
			const r = refs.get(c) || [];
			// stories からの参照は production 経路ではないので除外
			const production = r.filter((ref) => !ref.file.endsWith('.stories.svelte'));
			if (production.length === 0) {
				return {
					name: c,
					reason: `UI component "${path.basename(c, '.svelte')}" は production code から import されていません (stories からのみ or 完全 dead)。`,
					locations: r.slice(0, 5).map((ref) => `${ref.file}:${ref.line}`),
					allowlisted: baseline.allowed.includes(c),
				};
			}
			return null;
		})
		.filter(Boolean);

	const exit = reportFindings('ui', findings, { mode, baseline });
	process.exit(exit);
}

const isMain =
	import.meta.url === `file://${(process.argv[1] || '').replace(/\\/g, '/')}` ||
	(process.argv[1] || '').endsWith('check-orphan-ui.mjs');
if (isMain) {
	main();
}
