/**
 * scripts/audit/generate-coverage-gap-map.mjs (#2874 / EPIC #2861 D 系)
 *
 * カバレッジ未計測領域マップ生成 (warn-only、閾値判定なし — ratchet 判定は
 * 既存の vite.config.ts thresholds + scripts/check-coverage-threshold.js が担う)。
 *
 * 入力: vitest `--coverage.reporter=json-summary` が出力する coverage/coverage-summary.json
 * 出力:
 *   1. ディレクトリ単位 (src/lib/<area> 粒度) の lines カバレッジ集計表
 *   2. lines 0% のファイル一覧 (テストが一切届いていない箇所)
 *   3. vitest coverage 対象外 (= coverage-summary に現れない) src/lib/** ファイル一覧
 *      — vite.config.ts coverage.include は src/lib 配下の *.ts / *.svelte のため、
 *        summary 不在 = どの unit/integration test からも参照されていない疑い
 *
 * 統合 PR の §3.5 マージ判定エビデンス (audit-team.md) の入力 (gap-list G-COV-MAP)。
 *
 * pure function (buildCoverageGapMap) は副作用なし。
 * vitest: tests/unit/audit/generate-coverage-gap-map.test.ts
 *
 * Usage:
 *   node scripts/audit/generate-coverage-gap-map.mjs [--coverage <path>] [--json]
 *
 * exit: 常に 0 (warn-only)。coverage-summary.json 不在時はその旨を出力して 0 終了
 *       (artifact 欠落時に evidence job 全体を fail させないため)。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * coverage-summary.json のファイルパス key をリポジトリ相対 (src/...) に正規化する (pure)。
 * v8 provider は絶対パス key で出力するため、`src/` 以降を切り出す。
 * @param {string} key
 * @returns {string | null} src/ 配下でなければ null
 */
export function normalizeCoverageKey(key) {
	const normalized = key.replace(/\\/g, '/');
	const idx = normalized.lastIndexOf('/src/');
	if (idx !== -1) return normalized.slice(idx + 1);
	if (normalized.startsWith('src/')) return normalized;
	return null;
}

/**
 * src/ 相対パスから集計ディレクトリ key を返す (pure)。
 * 粒度: src/lib/<area> (例 src/lib/server) / src/routes / src/<その他>。
 * @param {string} relPath 例: 'src/lib/server/services/foo.ts'
 * @returns {string}
 */
export function dirKeyOf(relPath) {
	const segments = relPath.split('/');
	if (segments[1] === 'lib' && segments.length > 3) return segments.slice(0, 3).join('/');
	return segments.slice(0, 2).join('/');
}

/**
 * coverage-summary.json (parse 済) + src ファイル一覧から gap map を構築する (pure)。
 *
 * @param {Record<string, { lines?: { total: number, covered: number, pct: number } }>} coverageSummary
 *   istanbul json-summary 形式 ("total" key + per-file key)
 * @param {string[]} srcFiles リポジトリ内の src/lib/** 対象ファイル一覧 (src/ 相対)
 * @returns {{
 *   total: { lines: { total: number, covered: number, pct: number } } | null,
 *   dirs: Array<{ dir: string, files: number, linesTotal: number, linesCovered: number, pct: number }>,
 *   zeroCoverageFiles: string[],
 *   untrackedSrcFiles: string[],
 * }}
 */
export function buildCoverageGapMap(coverageSummary, srcFiles) {
	/** @type {Map<string, { files: number, linesTotal: number, linesCovered: number }>} */
	const byDir = new Map();
	/** @type {string[]} */
	const zeroCoverageFiles = [];
	const coveredKeys = new Set();

	for (const [key, value] of Object.entries(coverageSummary)) {
		if (key === 'total') continue;
		const rel = normalizeCoverageKey(key);
		if (!rel) continue;
		coveredKeys.add(rel);
		const lines = value?.lines ?? { total: 0, covered: 0, pct: 0 };
		const dir = dirKeyOf(rel);
		const agg = byDir.get(dir) ?? { files: 0, linesTotal: 0, linesCovered: 0 };
		agg.files += 1;
		agg.linesTotal += lines.total;
		agg.linesCovered += lines.covered;
		byDir.set(dir, agg);
		if (lines.total > 0 && lines.covered === 0) zeroCoverageFiles.push(rel);
	}

	const dirs = [...byDir.entries()]
		.map(([dir, agg]) => ({
			dir,
			files: agg.files,
			linesTotal: agg.linesTotal,
			linesCovered: agg.linesCovered,
			pct: agg.linesTotal === 0 ? 0 : Math.round((agg.linesCovered / agg.linesTotal) * 1000) / 10,
		}))
		.sort((a, b) => a.pct - b.pct);

	const untrackedSrcFiles = srcFiles.filter((f) => !coveredKeys.has(f)).sort();

	const totalEntry = coverageSummary.total;
	const total = totalEntry?.lines ? { lines: totalEntry.lines } : null;

	return { total, dirs, zeroCoverageFiles: zeroCoverageFiles.sort(), untrackedSrcFiles };
}

/**
 * markdown 整形 (pure)。
 * @param {ReturnType<typeof buildCoverageGapMap>} map
 * @returns {string}
 */
export function formatCoverageGapMarkdown(map) {
	const lines = ['### カバレッジ未計測領域マップ (warn-only)', ''];
	if (map.total) {
		lines.push(
			`- 全体 lines: ${map.total.lines.covered}/${map.total.lines.total} (${map.total.lines.pct}%)`,
		);
	} else {
		lines.push('- 全体 lines: (total エントリなし)');
	}
	lines.push('', '| ディレクトリ | files | lines pct |', '|---|---|---|');
	for (const d of map.dirs) lines.push(`| ${d.dir} | ${d.files} | ${d.pct}% |`);
	lines.push('', `#### lines 0% ファイル (${map.zeroCoverageFiles.length} 件)`, '');
	for (const f of map.zeroCoverageFiles) lines.push(`- ${f}`);
	lines.push(
		'',
		`#### vitest coverage 対象外 src/lib ファイル (${map.untrackedSrcFiles.length} 件)`,
		'',
	);
	for (const f of map.untrackedSrcFiles) lines.push(`- ${f}`);
	return lines.join('\n');
}

/**
 * src/lib/** の coverage 対象ファイル (.ts / .svelte、.d.ts と index.ts 除外 =
 * vite.config.ts coverage.include/exclude と同基準) を列挙する (CLI 用)。
 * @param {string} dir
 * @returns {string[]} src/ 相対 (posix 区切り)
 */
function listCoverageTargetFiles(dir) {
	/** @type {string[]} */
	const out = [];
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			out.push(...listCoverageTargetFiles(full));
		} else if (
			(entry.endsWith('.ts') || entry.endsWith('.svelte')) &&
			!entry.endsWith('.d.ts') &&
			entry !== 'index.ts'
		) {
			out.push(full.replace(/\\/g, '/'));
		}
	}
	return out;
}

/** CLI 本体
 * @param {string[]} argv
 */
export function runCli(argv = process.argv.slice(2)) {
	const covIdx = argv.indexOf('--coverage');
	const covPath =
		(covIdx !== -1 ? argv[covIdx + 1] : undefined) ?? 'coverage/coverage-summary.json';
	if (!existsSync(covPath)) {
		console.log(
			`coverage-summary.json not found at ${covPath} — skip (warn-only)。` +
				'unit-test-merge job の artifact download を確認してください (#2874)',
		);
		return null;
	}
	const summary = JSON.parse(readFileSync(covPath, 'utf8'));
	const srcFiles = listCoverageTargetFiles('src/lib');
	const map = buildCoverageGapMap(summary, srcFiles);
	if (argv.includes('--json')) {
		console.log(JSON.stringify(map, null, 2));
	} else {
		console.log(formatCoverageGapMarkdown(map));
	}
	return map;
}

const isMain = (() => {
	try {
		return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	runCli();
	process.exit(0); // warn-only (#2874)
}
