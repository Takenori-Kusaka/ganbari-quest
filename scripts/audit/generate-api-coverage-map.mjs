/**
 * scripts/audit/generate-api-coverage-map.mjs (#2874 / EPIC #2861 D 系)
 *
 * API カバレッジマップ生成 (warn-only、閾値判定なし)。
 *
 * `docs/design/07-API設計書.md` のエンドポイント表 (`| METHOD | /api/... |` 行) を抽出し、
 * tests/integration/ + tests/e2e/ のテストソースと突合して covered / uncovered 表 +
 * カバー率を出力する。統合 PR の §3.5 マージ判定エビデンス (audit-team.md) の入力。
 *
 * gap-list G-API-COV (docs/research/2026-06-11-audit-infra-gap-list.md):
 * tests/integration/api/ は 3 spec のみで API 全体に対し極小。本 script は
 * 「どこが未カバーか」を毎統合 PR で機械可視化する (カバレッジ拡充自体は別 feature issue)。
 *
 * pure function (extractApiEndpoints / matchEndpointCoverage) は副作用なし。
 * vitest: tests/unit/audit/generate-api-coverage-map.test.ts
 *
 * Usage:
 *   node scripts/audit/generate-api-coverage-map.mjs [--design-doc <path>] [--json]
 *
 * exit: 常に 0 (warn-only。uncovered があっても fail させない)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 設計書 markdown からエンドポイント表の行を抽出する (pure)。
 *
 * 対象: `| GET | /api/... |` 形式の表行。`POST/GET` のような複合メソッドは分解する。
 * `/api/` で始まらないパス (例: /auth/callback) は対象外 (API 契約表の主対象が /api/* のため)。
 *
 * @param {string} designDocText 07-API設計書.md の全文
 * @returns {Array<{ method: string, path: string }>}
 */
export function extractApiEndpoints(designDocText) {
	/** @type {Array<{ method: string, path: string }>} */
	const endpoints = [];
	const seen = new Set();
	const rowRe =
		/^\|\s*((?:GET|POST|PUT|PATCH|DELETE)(?:\/(?:GET|POST|PUT|PATCH|DELETE))*)\s*\|\s*(\/api\/[^\s|]+)\s*\|/;
	for (const line of designDocText.split('\n')) {
		const m = line.match(rowRe);
		if (!m) continue;
		const methods = m[1] ?? '';
		const path = m[2] ?? '';
		if (!methods || !path) continue;
		for (const method of methods.split('/')) {
			const key = `${method} ${path}`;
			if (seen.has(key)) continue;
			seen.add(key);
			endpoints.push({ method, path });
		}
	}
	return endpoints;
}

/**
 * エンドポイント path をテストソース検索用の正規表現に変換する (pure)。
 * `[id]` / `[childId]` 等のパラメータセグメントは任意セグメントにマッチさせる。
 * `?/action` (SvelteKit form action) は `?` を literal 扱いにする。
 *
 * @param {string} path 例: '/api/v1/activities/[id]/visibility'
 * @returns {RegExp}
 */
export function endpointToPattern(path) {
	const escaped = path
		.split('/')
		.map((seg) => {
			if (/^\[.+\]$/.test(seg)) return '[^/\'"`\\s?]+';
			return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		})
		.join('/');
	return new RegExp(escaped);
}

/**
 * エンドポイント一覧 × テストソース全文の突合 (pure)。
 *
 * @param {Array<{ method: string, path: string }>} endpoints
 * @param {string} testSourceText tests/integration/ + tests/e2e/ の連結ソース
 * @returns {{
 *   covered: Array<{ method: string, path: string }>,
 *   uncovered: Array<{ method: string, path: string }>,
 *   total: number,
 *   coverageRate: number,
 * }}
 */
export function matchEndpointCoverage(endpoints, testSourceText) {
	/** @type {Array<{ method: string, path: string }>} */
	const covered = [];
	/** @type {Array<{ method: string, path: string }>} */
	const uncovered = [];
	for (const ep of endpoints) {
		if (endpointToPattern(ep.path).test(testSourceText)) {
			covered.push(ep);
		} else {
			uncovered.push(ep);
		}
	}
	const total = endpoints.length;
	const coverageRate = total === 0 ? 0 : Math.round((covered.length / total) * 1000) / 10;
	return { covered, uncovered, total, coverageRate };
}

/**
 * markdown 表に整形する (pure)。
 * @param {ReturnType<typeof matchEndpointCoverage>} result
 * @returns {string}
 */
export function formatApiCoverageMarkdown(result) {
	const lines = [
		'### API カバレッジマップ (設計書 × tests/integration + tests/e2e 突合、warn-only)',
		'',
		`- 設計書エンドポイント総数: ${result.total}`,
		`- テスト参照あり (covered): ${result.covered.length}`,
		`- テスト参照なし (uncovered): ${result.uncovered.length}`,
		`- カバー率: ${result.coverageRate}%`,
		'',
		'| 状態 | メソッド | パス |',
		'|---|---|---|',
	];
	for (const ep of result.covered) lines.push(`| covered | ${ep.method} | ${ep.path} |`);
	for (const ep of result.uncovered) lines.push(`| **uncovered** | ${ep.method} | ${ep.path} |`);
	return lines.join('\n');
}

/**
 * ディレクトリ配下の .ts ファイルを再帰列挙する (CLI 用、副作用 = fs read)。
 * @param {string} dir
 * @returns {string[]}
 */
function listTestFiles(dir) {
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
			out.push(...listTestFiles(full));
		} else if (entry.endsWith('.ts')) {
			out.push(full);
		}
	}
	return out;
}

/** CLI 本体
 * @param {string[]} argv
 */
export function runCli(argv = process.argv.slice(2)) {
	const designDocIdx = argv.indexOf('--design-doc');
	const designDocPath =
		(designDocIdx !== -1 ? argv[designDocIdx + 1] : undefined) ?? 'docs/design/07-API設計書.md';
	const designDocText = readFileSync(designDocPath, 'utf8');
	const endpoints = extractApiEndpoints(designDocText);

	const testFiles = [...listTestFiles('tests/integration'), ...listTestFiles('tests/e2e')];
	const testSourceText = testFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

	const result = matchEndpointCoverage(endpoints, testSourceText);
	if (argv.includes('--json')) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(formatApiCoverageMarkdown(result));
	}
	return result;
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
	process.exit(0); // warn-only: uncovered があっても fail しない (#2874)
}
