/**
 * tests/unit/architecture/ci-unit-test-path-filter-closure.test.ts (#4007)
 *
 * 「実行されなかった検証」を「実行されて通った検証」と同じ green として扱う class の gate。
 * 同 class 3 例目 (#3969 junction で gate が無言 exit 0 / #3983 `--labels ""` の沈黙 fail-open)。
 *
 * ## 何が起きていたか
 *
 * `ci.yml` の `unit-test` job は `if: changes.app == 'true' || changes.deps == 'true'` で発火する。
 * 一方 `tests/unit/**` には repo 内の **コード以外のファイルを実行時に読む** fitness test が実在する
 * (`docs/design/dsql-data-model.md` / `docs/operations/stripe-dashboard-runbook.md` /
 * `site/index.html` / `.github/labeler.yml` / `drizzle/pglite/meta/_journal.json` 等)。
 *
 * これらの root が `app` / `deps` filter に列挙されていないと、その root だけを変更した PR で
 * `unit-test` が **job ごと skip** される。さらに `ci-gate` は skipped を failure として数えない
 * (`ci.yml` の `so skipped jobs (via path filter) don't block merges`) ため、**守っている test が
 * 1 本も走らないまま ci-gate が green になる**。
 *
 * ## 本 test が固定すること
 *
 * `tests/unit/**` + `tests/integration/**` が参照する repo 相対パスが、すべて `app` または `deps`
 * filter でカバーされていること。今日の穴を塞ぐ (= filter に列挙する) だけでは、**次に doc を読む
 * test が増えた時点で同じ乖離が再発する**ため、対応関係そのものを機械検証する (#3978 と同思想)。
 *
 * ## 走査方針: 意図的な過大近似 (over-approximation)
 *
 * 「実行時に本当に読むか」を静的に完全判定することはできない (`loadHtml('site/index.html')` のような
 * ローカル helper 経由もあれば、`join(process.cwd(), 'drizzle', 'pglite')` のような分割リテラルもある)。
 * そこで本 scanner は **「git 追跡ファイルを指す文字列リテラル」を全部拾う**。
 *
 * - 誤検出 (読んでいないのに拾う) の影響は「filter を広げる」方向にしか働かない = 安全側
 * - 検出漏れの影響は「gate が発火しない」= 本 test が塞ぎたい事故そのもの
 *
 * したがって迷った場合は拾う。分割リテラル (`join(cwd, 'a', 'b')`) も連結して評価する。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

/** 走査対象 (GQ-QA 走査は tests/unit のみだったので tests/integration も含める — #4007 技術メモ) */
const SCAN_DIRS = ['tests/unit', 'tests/integration'];

/**
 * git 追跡ファイルの集合 (repo 相対、`/` 区切り)。
 *
 * 「実在するか」の判定に `existsSync` を使うと、`node_modules/` / `tmp/` / `.svelte-kit/` /
 * `coverage/` のような **その時たまたま生成されていたファイル**を拾い、実行タイミングで結論が
 * 変わる (実際に `npm ci` 直後だけ `node_modules/tsx/dist/cli.mjs` を拾って fail した)。
 * paths-filter が判定するのは **PR の diff に現れるファイル** = git 追跡ファイルだけなので、
 * 判定材料も git 追跡ファイルに揃える。gate が実行環境で揺れないことを優先する。
 */
const TRACKED_FILES: ReadonlySet<string> = new Set(
	execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64e6 })
		.split('\0')
		.filter(Boolean),
);

// ---------------------------------------------------------------------------
// ci.yml paths-filter parser
// ---------------------------------------------------------------------------

/**
 * `filters: |` block scalar 内の 1 named filter からパスパターンを抜く。
 * 完全な YAML parse はしない (依存を増やさない)。名前行より深い字下げの `- '...'` を拾い、
 * 字下げが名前行以下に戻った時点で終端する。
 * (`tests/unit/scripts/cli-entry-guard.test.ts` の同名 helper と同じ方針)
 */
function extractFilterPaths(yaml: string, name: string): string[] {
	const lines = yaml.split(/\r?\n/);
	const start = lines.findIndex((l) => new RegExp(`^(\\s+)${name}:\\s*$`).test(l));
	if (start < 0) return [];
	const baseIndent = (lines[start]?.match(/^\s*/)?.[0] ?? '').length;
	const paths: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (line.trim() === '') continue;
		const indent = (line.match(/^\s*/)?.[0] ?? '').length;
		if (indent <= baseIndent) break;
		const m = line.trim().match(/^-\s*'([^']+)'\s*$/);
		if (m?.[1]) paths.push(m[1]);
	}
	return paths;
}

/**
 * paths-filter の 1 パターンが repo 相対パスをカバーするか判定する。
 *
 * 対応するのは実在パターンの形だけ (`a/**` / `a/b.ts` / `playwright*.config.*` / `Dockerfile*`)。
 * glob エンジンは導入しない (依存増を避ける + 判定を読んで追えるようにする)。
 */
function matchesFilterPattern(relPath: string, pattern: string): boolean {
	if (pattern.endsWith('/**')) {
		const prefix = pattern.slice(0, -3);
		return relPath === prefix || relPath.startsWith(`${prefix}/`);
	}
	if (pattern.startsWith('**/')) {
		const tail = pattern.slice(3);
		return relPath === tail || relPath.endsWith(`/${tail}`);
	}
	if (pattern.includes('*')) {
		// `*` は path separator を跨がない (paths-filter / picomatch 既定と同じ)
		const rx = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('[^/]*')}$`);
		return rx.test(relPath);
	}
	return relPath === pattern;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCoveredByFilters(relPath: string, patterns: string[]): boolean {
	return patterns.some((p) => matchesFilterPattern(relPath, p));
}

// ---------------------------------------------------------------------------
// test 側 scanner
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (/\.(ts|mts|js|mjs)$/.test(e.name)) out.push(p);
	}
	return out;
}

/**
 * 1 ソースから「repo 内に実在するファイルを指す」文字列リテラルを抽出し、repo 相対パスで返す。
 *
 * 拾う形:
 *   1. 単独リテラル      `'docs/design/dsql-data-model.md'` / `'../../../docs/...'`
 *   2. 連結リテラル列    `join(process.cwd(), 'drizzle', 'pglite')` → `drizzle/pglite`
 *      (segment 分割で書かれると 1 の正規表現では拾えず検出漏れになる)
 */
/** literal が「明らかに repo パスではない」形かを判定する (URL / alias / 絶対パス)。 */
function isNonRepoLiteral(literal: string): boolean {
	if (literal.length < 3 || literal.length > 200) return true;
	if (/^[a-z][a-z0-9+.-]*:/i.test(literal)) return true; // URL / スキーム
	return literal.startsWith('$lib') || literal.startsWith('@') || literal.startsWith('/');
}

/** literal が指す git 追跡ファイルを repo 相対で返す (無ければ null)。 */
function resolveRepoFile(literal: string, fileDir: string, root: string): string | null {
	const candidates = literal.startsWith('.')
		? [path.resolve(fileDir, literal)]
		: [path.resolve(root, literal), path.resolve(fileDir, literal)];
	for (const abs of candidates) {
		if (!abs.startsWith(root)) continue;
		const rel = path.relative(root, abs).split(path.sep).join('/');
		if (TRACKED_FILES.has(rel)) return rel;
	}
	return null;
}

function collectRepoPathsFrom(sourcePath: string, source: string, root: string): string[] {
	const fileDir = path.dirname(sourcePath);
	const found = new Set<string>();

	const consider = (literal: string) => {
		if (isNonRepoLiteral(literal)) return;
		const rel = resolveRepoFile(literal, fileDir, root);
		if (rel) found.add(rel);
	};

	// 1. 単独リテラル
	for (const m of source.matchAll(/['"`]([^'"`\n]{3,200})['"`]/g)) {
		const lit = m[1];
		if (lit?.includes('/')) consider(lit);
	}

	// 2. 連結リテラル列 (join(a, 'b', 'c') 形式)。2 個以上連続する quoted 引数を結合する。
	for (const m of source.matchAll(
		/((?:['"]([^'"\n]{1,80})['"]\s*,\s*){1,6}['"]([^'"\n]{1,80})['"])/g,
	)) {
		const segments = [...(m[1] ?? '').matchAll(/['"]([^'"\n]{1,80})['"]/g)].map((x) => x[1] ?? '');
		for (let start = 0; start < segments.length; start++) {
			for (let end = start + 2; end <= segments.length; end++) {
				consider(segments.slice(start, end).join('/'));
			}
		}
	}

	return [...found];
}

function collectAll(root: string): Map<string, string[]> {
	const result = new Map<string, string[]>();
	for (const dir of SCAN_DIRS) {
		for (const file of walk(path.join(root, dir))) {
			const rel = path.relative(root, file).split(path.sep).join('/');
			for (const p of collectRepoPathsFrom(file, readFileSync(file, 'utf8'), root)) {
				if (!result.has(p)) result.set(p, []);
				const refs = result.get(p);
				if (refs && !refs.includes(rel)) refs.push(rel);
			}
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

const CI_YML = readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const appPaths = extractFilterPaths(CI_YML, 'app');
const depsPaths = extractFilterPaths(CI_YML, 'deps');
const unitTestPatterns = [...appPaths, ...depsPaths];

describe('unit-test 発火条件の閉包 (#4007 AC2)', () => {
	// 陽性対照: parser / scanner が空を返しているだけの偽 PASS を防ぐ (proposal 005 / #3979)。
	it('[PC1] app / deps filter を抽出できている (parser の健全性)', () => {
		expect(appPaths.length).toBeGreaterThan(5);
		expect(appPaths).toContain('src/**');
		expect(depsPaths).toContain('package.json');
	});

	it('[PC2] scanner が実在パス参照を拾えている (scanner の健全性)', () => {
		// git ls-files が空を返すと「参照 0 件 → 未カバー 0 件」で FC1 が空振り PASS する。
		// 判定材料そのものが空でないことを先に固定する (#3979 と同じ陽性対照の考え方)。
		expect(TRACKED_FILES.size).toBeGreaterThan(500);
		expect(TRACKED_FILES.has('.github/workflows/ci.yml')).toBe(true);
		const refs = collectAll(REPO_ROOT);
		expect(refs.size).toBeGreaterThan(50);
		// #4007 で穴として特定された 4 本の実読先が拾えていること
		expect([...refs.keys()]).toContain('docs/design/dsql-data-model.md');
		expect([...refs.keys()]).toContain('docs/operations/stripe-dashboard-runbook.md');
		expect([...refs.keys()]).toContain('site/index.html');
	});

	it('[PC3] matcher が非カバーを非カバーと判定する (matcher の健全性)', () => {
		expect(isCoveredByFilters('docs/design/x.md', ['src/**', 'package.json'])).toBe(false);
		expect(isCoveredByFilters('docs/design/x.md', ['docs/**'])).toBe(true);
		expect(isCoveredByFilters('CLAUDE.md', ['**/CLAUDE.md'])).toBe(true);
		expect(isCoveredByFilters('playwright.config.ts', ['playwright*.config.*'])).toBe(true);
		expect(isCoveredByFilters('docs/x/CLAUDE.md', ['docs/**'])).toBe(true);
	});

	it('[FC1] tests/unit + tests/integration が参照する repo パスが app / deps filter に含まれる', () => {
		const refs = collectAll(REPO_ROOT);
		const uncovered: string[] = [];
		for (const [target, sources] of refs) {
			if (isCoveredByFilters(target, unitTestPatterns)) continue;
			uncovered.push(`  ${target}  ← ${sources.slice(0, 3).join(', ')}`);
		}
		expect(
			uncovered,
			'tests/unit + tests/integration が参照する以下のパスが ci.yml paths-filter の app / deps に\n' +
				'含まれていません。これらだけを変更した PR では unit-test job ごと skip され、\n' +
				'ci-gate は skipped を failure として数えないため「守っている test が 1 本も走らないまま green」\n' +
				'になります (#4007 root class)。ci.yml の app filter に該当 root を追加してください。\n' +
				`未カバー:\n${uncovered.join('\n')}\n`,
		).toEqual([]);
	});
});
