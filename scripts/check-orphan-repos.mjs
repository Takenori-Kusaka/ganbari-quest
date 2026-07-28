#!/usr/bin/env node
/**
 * scripts/check-orphan-repos.mjs (EPIC #2362 follow-up)
 *
 * src/lib/server/db/ 配下の各 backend layer の repo 実装ファイルについて、
 * facade (`src/lib/server/db/<name>.ts`) または factory (`src/lib/server/db/factory.ts`)
 * のいずれからも参照されていないものを検出する。
 *
 * 構造的予防の目的:
 *   - backend layer の追加忘れ / 削除忘れを可視化
 *   - 機能撤去で実装ファイルだけ残った dead repo を block
 *
 * #4030 A-1: layer の母数は **実 FS から導出**する。旧実装は
 * `const REPO_LAYER_DIRS = ['sqlite', 'demo', 'dynamodb']` の literal 固定で、
 * `dynamodb` は #3438 で撤去済 (dir 不在) の一方、現行アーキの中心である `dsql/`
 * (repo 34 本) と `pglite/` が**一度も検査されていなかった**。
 * 「3 layer の追加忘れ / 削除忘れを可視化する」と自称しながら、layer の増減自体に
 * 追随できていない状態だったため、母数の導出を FS に変え、repo layer でない dir は
 * 理由付きで明示除外する (no-silent-gap)。
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
import { escapeRegExp } from './lib/ci/escape-regexp.mjs';
import {
	loadBaseline,
	parseArgs,
	REPO_ROOT,
	reportFindings,
	walkDir,
} from './lib/ci/orphan-utils.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';

const DB_DIR = path.join(REPO_ROOT, 'src', 'lib', 'server', 'db');

/**
 * `src/lib/server/db/` 直下にあるが backend repo layer **ではない** dir と、その理由 (#4030 A-1)。
 *
 * ここに無い dir は自動的に repo layer として検査対象になる。新しい dir を足したのに
 * 検査したくない場合、**理由を書かないと母数から外せない**。理由の非空は
 * `tests/unit/scripts/check-orphan-repos-population.test.ts` が assert する。
 *
 * @type {Record<string, string>}
 */
export const NON_REPO_LAYER_DIRS = {
	interfaces:
		'repo が実装する interface 定義。実装ではなく caller 側として扱う (下の callerSources に含めている)',
	types: 'backend 非依存の型定義のみ。repo 実装を持たない',
	migration: 'schema migration の runner / pipeline / transformer。backend 別の repo 層ではない',
};

/**
 * repo layer dir を実 FS から導出する (#4030 A-1)。
 *
 * @returns {string[]} layer dir 名 (辞書順)
 */
export function resolveRepoLayerDirs(dbDir = DB_DIR) {
	return fs
		.readdirSync(dbDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => !(name in NON_REPO_LAYER_DIRS))
		.sort();
}

function main() {
	const REPO_LAYER_DIRS = resolveRepoLayerDirs();
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

	// tier 2 の caller 候補: repo 全体 (#4030 A-1)。
	// layer 配下には repo 本体 (*-repo.ts) 以外に helper が同居しており (occ-retry / pg-uuid /
	// dsql-errors 等)、これらは兄弟 repo から import されるのが正常で **facade から呼ばれない**。
	// facade 到達性を helper にも要求すると 22 件の偽陽性が出て guard が使い物にならなくなるため、
	// helper には「repo のどこからも import されていない = dead」だけを要求する。
	// tier 1 (*-repo.ts の facade 到達性) は従来と同じ強さのまま維持する。
	const repoWideSources = [];
	for (const root of ['src', 'tests', 'scripts', 'infra']) {
		const rootDir = path.join(REPO_ROOT, root);
		if (!fs.existsSync(rootDir)) continue;
		for (const f of walkDir(rootDir, { extensions: ['.ts', '.mjs', '.js', '.cjs'] })) {
			repoWideSources.push({ file: f, text: fs.readFileSync(f, 'utf8') });
		}
	}

	const findings = repoFiles
		.map((repoFile) => {
			const rel = path.relative(REPO_ROOT, repoFile).replace(/\\/g, '/');
			const base = path.basename(repoFile, '.ts');

			// tier 2: repo 本体でない helper は「どこからも import されていない」だけを検出する
			if (!base.endsWith('-repo')) {
				const importers = repoWideSources.filter(
					(s) =>
						s.file !== repoFile &&
						new RegExp(`from\\s+['"][^'"]*\\b${base}(\\.js)?['"]`).test(s.text),
				);
				if (importers.length > 0) return null;
				return {
					name: rel,
					reason: `layer helper "${rel}" は repo 全体 (src / tests / scripts / infra) のどこからも import されていません (dead code の疑い)。`,
					locations: [],
					allowlisted: baseline.allowed.includes(rel),
				};
			}
			// import path として現れる形式: `./sqlite/<base>` `./dynamodb/<base>` `./demo/<base>`
			// または `from './sqlite/<base>'` の boundary 一致
			let found = false;
			const locations = [];
			const layer = path.basename(path.dirname(repoFile));
			const importNeedle = `${layer}/${base}`;
			// #4030: 素の includes() だと `sqlite/activity-repo` が
			// `sqlite/activity-repo-archive` の import にも一致し、結線が切れているのに
			// 「結線済」と誤判定する。末尾に単語文字 / ハイフンが続かないことを要求する。
			const needleRe = new RegExp(`${escapeRegExp(importNeedle)}(\\.js)?(?![\\w-])`);
			for (const src of callerSources) {
				// 自分自身は除く
				if (src.file === repoFile) continue;
				if (!needleRe.test(src.text)) continue;
				const lines = src.text.split(/\r?\n/);
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (!/\b(import|from|require)\b/.test(line)) continue;
					if (needleRe.test(line)) {
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

const isMain = isMainModule(import.meta.url);
if (isMain) {
	main();
}
