#!/usr/bin/env node
/**
 * scripts/check-orphan-repos.mjs (EPIC #2362 follow-up)
 *
 * src/lib/server/db/{sqlite,demo,dynamodb}/ 配下の repo 実装ファイルについて、
 * facade (`src/lib/server/db/<name>.ts`) または factory (`src/lib/server/db/factory.ts`)
 * のいずれからも参照されていないものを検出する。
 *
 * 構造的予防の目的:
 *   - 3 layer (sqlite / demo / dynamodb) の追加忘れ / 削除忘れを可視化
 *   - 機能撤去で実装ファイルだけ残った dead repo を block
 *
 * 使用法:
 *   node scripts/check-orphan-repos.mjs              # CI mode
 *   node scripts/check-orphan-repos.mjs --report     # 詳細 report
 *   node scripts/check-orphan-repos.mjs --update-baseline
 *
 * baseline: scripts/orphan-baselines/repos.json
 *
 * 検出ロジック:
 *   1. src/lib/server/db/sqlite/ 等の各 *-repo.ts / その他 helper を列挙
 *   2. facade (`db/<name>.ts`) と factory.ts から basename を含む import を確認
 *   3. 両者とも 0 件 = orphan candidate
 *
 * 既知の例外 (baseline 候補):
 *   - usage-log-repo (Pre-PMF Bucket B、SQLite-only)
 *   - dynamodb helper 系 (auth-keys / bulk-delete / client / counter / keys / repo-helpers)
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

const DB_DIR = path.join(REPO_ROOT, 'src', 'lib', 'server', 'db');
const REPO_LAYER_DIRS = ['sqlite', 'demo', 'dynamodb'];

function main() {
	const args = parseArgs(process.argv);
	const mode = args.updateBaseline ? 'update-baseline' : args.report ? 'report' : 'check';
	const baseline = loadBaseline('repos');

	// 各 repo 実装ファイルを列挙
	const repoFiles = [];
	for (const layer of REPO_LAYER_DIRS) {
		const layerDir = path.join(DB_DIR, layer);
		if (!fs.existsSync(layerDir)) continue;
		for (const f of walkDir(layerDir, { extensions: ['.ts'] })) {
			if (f.endsWith('.test.ts') || f.endsWith('.spec.ts')) continue;
			repoFiles.push(f);
		}
	}

	// caller 候補: db/ 直下 (facade + factory + interfaces) を読み込み 1 つの大文字列に結合
	const callerSources = [];
	for (const entry of fs.readdirSync(DB_DIR, { withFileTypes: true })) {
		const full = path.join(DB_DIR, entry.name);
		if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
			callerSources.push({ file: full, text: fs.readFileSync(full, 'utf8') });
		}
		// interfaces/ 配下も facade 経路として扱う
		if (entry.isDirectory() && entry.name === 'interfaces') {
			for (const f of walkDir(full, { extensions: ['.ts'] })) {
				callerSources.push({ file: f, text: fs.readFileSync(f, 'utf8') });
			}
		}
	}

	const findings = repoFiles
		.map((repoFile) => {
			const rel = path.relative(REPO_ROOT, repoFile).replace(/\\/g, '/');
			const base = path.basename(repoFile, '.ts');
			// import path として現れる形式: `./sqlite/<base>` `./dynamodb/<base>` `./demo/<base>`
			// または `from './sqlite/<base>'` の boundary 一致
			let found = false;
			const locations = [];
			const layer = path.basename(path.dirname(repoFile));
			const importNeedle = `${layer}/${base}`;
			for (const src of callerSources) {
				// 自分自身は除く
				if (src.file === repoFile) continue;
				if (!src.text.includes(importNeedle)) continue;
				const lines = src.text.split(/\r?\n/);
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (!/\b(import|from|require)\b/.test(line)) continue;
					if (line.includes(importNeedle)) {
						found = true;
						locations.push(`${path.relative(REPO_ROOT, src.file).replace(/\\/g, '/')}:${i + 1}`);
					}
				}
			}
			if (!found) {
				return {
					name: rel,
					reason: `repo file "${rel}" は db facade / factory / interfaces から import されていません。facade (db/<name>.ts) 経由 OR factory.ts 登録のいずれもありません。`,
					locations: [],
					allowlisted: baseline.allowed.includes(rel),
				};
			}
			return null;
		})
		.filter(Boolean);

	const exit = reportFindings('repos', findings, { mode, baseline });
	process.exit(exit);
}

const isMain =
	import.meta.url === `file://${(process.argv[1] || '').replace(/\\/g, '/')}` ||
	(process.argv[1] || '').endsWith('check-orphan-repos.mjs');
if (isMain) {
	main();
}
