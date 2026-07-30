#!/usr/bin/env node
/**
 * scripts/check-repo-scan-test-declaration.mjs (#4085)
 *
 * 「repo 走査 test」の区分宣言を機械強制する gate。
 *
 * ## 背景
 *
 * repo 全体の file を実読する test は実行時間が入力サイズに比例する。既定 timeout (5s) のまま
 * unit lane に置くと並列実行の負荷次第で落ちるが、**壊れてはいない**ため開発者は毎回「本物か
 * 負荷か」を切り分けることになる。切り分けを間違えれば無い回帰を追うか、本物の回帰を
 * 「また負荷だろう」と見逃す。
 *
 * 同 class が 4 例に達した (#3972/#4000 → PR #4067 / #3978 → PR #4066 /
 * `page-guide-coverage` 6240ms / `ci-unit-test-path-filter-closure` 5533ms) ため、
 * instance ごとの timeout 引き上げをやめて、**追加時に区分の判断を必ず発生させる** gate にした
 * (ADR-0061 same-class-N→guard / #4048 `costClass` 未登録 throw と同型)。
 *
 * ## 検査内容
 *
 *   1. 走査 API (`readdirSync` / `globSync` / `readdir(` / `glob(` / `fg(` ...) を使う test file を
 *      候補として洗い出す
 *   2. 候補が `REPO_SCAN_TEST_REGISTRY` に未宣言なら fail (区分宣言の強制)
 *   3. 宣言された `scope` が静的判定と食い違えば fail
 *      (`bounded` と自己申告して timeout 要求を回避することを許さない)
 *   4. `scope: 'repo'` の test file に明示 timeout (≥ MIN_REPO_SCAN_TIMEOUT_MS) が無ければ fail
 *   5. registry にあるのに file が無い / もう走査していないエントリは fail (stale 宣言の除去)
 *
 * 「検査しなかったことを silent に通さない」ため、候補 0 件は異常 (走査 API の綴りが変わった等)
 * として fail する。
 *
 * ## 実行
 *
 *   node scripts/check-repo-scan-test-declaration.mjs
 *   node scripts/check-repo-scan-test-declaration.mjs --list   # 判定結果を一覧表示 (常に exit 0)
 *
 * ## exit code
 *
 *   0 — 違反なし
 *   1 — 違反あり
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	MIN_REPO_SCAN_TIMEOUT_MS,
	REPO_SCAN_TEST_REGISTRY,
} from './lib/ci/repo-scan-test-registry.mjs';
import { isMain } from './lib/is-main.mjs';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');

/** 走査 API のシグネチャ。1 つでも含めば「候補」。 */
const SCAN_API_PATTERN =
	/\breaddirSync\s*\(|\breaddir\s*\(|\bglobSync\s*\(|\bglob\s*\(|\bfg\s*\(|from ['"]fast-glob['"]|from ['"]glob['"]/;

/**
 * repo のディレクトリツリーを指す文字列リテラル。
 *
 * 「ディレクトリそのもの」を名指しするのは走査するときだけなので、単一ファイル参照
 * (`'src/lib/domain/labels.ts'`) とは区別できる。
 */
const REPO_ROOT_DIR_PATTERN =
	/(['"`])(src|scripts|tests|docs|site|infra|static|\.github|\.claude)(\/[a-z0-9_.-]+){0,2}\1/i;

/** 明示 timeout の宣言。`}, 60_000)` / `{ timeout: 60_000 }` / `testTimeout: 30000` を拾う。 */
const EXPLICIT_TIMEOUT_PATTERN = /(?:[Tt]imeout\s*:\s*|\}\s*,\s*)([0-9][0-9_]*)/g;

/**
 * test file を列挙する (tests/ 配下の *.test.ts)。
 *
 * @param {string} dir
 * @returns {string[]} repo root からの POSIX 相対パス
 */
export function listTestFiles(dir = join(repoRoot, 'tests')) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...listTestFiles(full));
		else if (/\.test\.ts$/.test(entry)) out.push(relative(repoRoot, full).replace(/\\/g, '/'));
	}
	return out;
}

/**
 * source から「走査 API を使うか」「repo ツリーを指すか」「明示 timeout があるか」を判定する。
 *
 * @param {string} source
 * @returns {{ usesScanApi: boolean; scope: 'repo' | 'bounded'; maxTimeoutMs: number }}
 */
export function analyzeTestSource(source) {
	const usesScanApi = SCAN_API_PATTERN.test(source);
	const scope = usesScanApi && REPO_ROOT_DIR_PATTERN.test(source) ? 'repo' : 'bounded';
	let maxTimeoutMs = 0;
	for (const m of source.matchAll(EXPLICIT_TIMEOUT_PATTERN)) {
		const value = Number((m[1] ?? '').replace(/_/g, ''));
		if (Number.isFinite(value)) maxTimeoutMs = Math.max(maxTimeoutMs, value);
	}
	return { usesScanApi, scope, maxTimeoutMs };
}

/**
 * gate 本体。file 読み込みを DI 可能にして test から fixture を注入する。
 *
 * @param {{ files: string[]; readFile: (path: string) => string;
 *           registry?: Record<string, { scope: 'repo' | 'bounded'; note: string }> }} input
 * @returns {{ violations: { id: string; path: string; message: string }[];
 *             candidates: { path: string; scope: string; maxTimeoutMs: number }[] }}
 */
export function checkRepoScanTestDeclarations({
	files,
	readFile,
	registry = REPO_SCAN_TEST_REGISTRY,
}) {
	const violations = [];
	const candidates = [];

	for (const path of files) {
		const analysis = analyzeTestSource(readFile(path));
		if (!analysis.usesScanApi) continue;
		candidates.push({ path, scope: analysis.scope, maxTimeoutMs: analysis.maxTimeoutMs });

		const declared = registry[path];
		if (!declared) {
			violations.push({
				id: 'undeclared',
				path,
				message:
					`repo 走査 test の区分が未宣言です (静的判定: scope='${analysis.scope}')。\n` +
					`      scripts/lib/ci/repo-scan-test-registry.mjs に以下を追加してください:\n` +
					`        '${path}': { scope: '${analysis.scope}', note: '<何を走査するか>' },` +
					(analysis.scope === 'repo'
						? `\n      scope='repo' の test には明示 timeout (≥ ${MIN_REPO_SCAN_TIMEOUT_MS}ms) も必要です。`
						: ''),
			});
			continue;
		}

		if (declared.scope !== analysis.scope) {
			violations.push({
				id: 'scope-mismatch',
				path,
				message:
					`宣言された scope='${declared.scope}' が静的判定 scope='${analysis.scope}' と一致しません。\n` +
					`      走査範囲を変えたなら registry の宣言も直してください ` +
					`(自己申告だけで区分を下げることはできません)。`,
			});
			continue;
		}

		if (declared.scope === 'repo' && analysis.maxTimeoutMs < MIN_REPO_SCAN_TIMEOUT_MS) {
			violations.push({
				id: 'missing-timeout',
				path,
				message:
					`scope='repo' ですが明示 timeout がありません (検出した最大値: ${analysis.maxTimeoutMs}ms、` +
					`必要: ${MIN_REPO_SCAN_TIMEOUT_MS}ms 以上)。\n` +
					`      対応: 当該 it(...) の第 3 引数に \`${MIN_REPO_SCAN_TIMEOUT_MS * 3}\` 等を渡すか、\n` +
					`            describe(..., { timeout: ${MIN_REPO_SCAN_TIMEOUT_MS * 3} }) を付ける。\n` +
					`      既定 5s のままだと並列実行の負荷で落ち、「本物か負荷か」の切り分けが毎回発生します (#4085)。`,
			});
		}
	}

	const candidatePaths = new Set(candidates.map((c) => c.path));
	for (const path of Object.keys(registry)) {
		if (candidatePaths.has(path)) continue;
		violations.push({
			id: 'stale-entry',
			path,
			message: files.includes(path)
				? 'registry に宣言されていますが、もう走査 API を使っていません。エントリを削除してください。'
				: 'registry に宣言されていますが file が存在しません。エントリを削除してください。',
		});
	}

	if (candidates.length === 0) {
		violations.push({
			id: 'no-candidates',
			path: '(全体)',
			message:
				'走査 API を使う test が 1 件も見つかりませんでした。検出 pattern が実装と乖離した疑いがあります ' +
				'(0 件を「違反なし」として黙って通すと gate が無効化されたことに誰も気付けないため fail にします、#4085)。',
		});
	}

	return { violations, candidates };
}

function main(argv = process.argv.slice(2)) {
	const files = listTestFiles();
	const readFile = (/** @type {string} */ p) => readFileSync(resolve(repoRoot, p), 'utf8');
	const { violations, candidates } = checkRepoScanTestDeclarations({ files, readFile });
	const prefix = '[repo-scan-test-declaration]';

	if (argv.includes('--list')) {
		for (const c of candidates) {
			console.log(
				`  ${c.scope.padEnd(7)} timeout=${String(c.maxTimeoutMs).padStart(6)}ms  ${c.path}`,
			);
		}
		console.log(
			`${prefix} 候補 ${candidates.length} 件 / 違反 ${violations.length} 件 (--list は常に exit 0)`,
		);
		return 0;
	}

	if (violations.length === 0) {
		console.log(
			`${prefix} OK — repo 走査 test ${candidates.length} 件すべて区分宣言済 ` +
				`(scope='repo' は明示 timeout ≥ ${MIN_REPO_SCAN_TIMEOUT_MS}ms を確認)`,
		);
		return 0;
	}

	console.log(`\n${prefix} ERROR — ${violations.length} 件の違反:\n`);
	for (const v of violations) {
		console.log(`  [${v.id}] ${v.path}\n      ${v.message}\n`);
	}
	console.log(
		'SSOT: scripts/lib/ci/repo-scan-test-registry.mjs / 運用は tests/CLAUDE.md §「repo 走査 test」(#4085)',
	);
	return 1;
}

if (isMain(import.meta.url)) {
	process.exit(main());
}
