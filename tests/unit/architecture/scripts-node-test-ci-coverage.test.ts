/**
 * tests/unit/architecture/scripts-node-test-ci-coverage.test.ts
 *
 * 「テストが書かれている」と「テストが実行されている」が一致していることを機械で固定する。
 *
 * ## 何が起きていたか（実測）
 *
 * `scripts/__tests__/` には 13 file の `*.test.mjs` があるが、`ci.yml` は
 * `node --test <literal path>` を 3 行書いていただけで、**10 file はどこからも実行されて
 * いなかった**（`vitest.config` の include も `tests/unit/**` / `tests/integration/**` のみで
 * 対象外）。実行されない期間に仕様が変わり、**3 file が壊れたまま気づかれずに残っていた**:
 *
 * - `check-ss-blob-sha-uniqueness` — #4084 で意図的に `skip → fail` へ変えた挙動に test が未追随
 * - `generate-lp-labels` × 2 — fixture の key 不整合 / #1916 (ADR-0045) で意味が反転した assert
 *
 * ## 本 test が固定すること
 *
 * 実行対象が **人手で維持される literal list** である限り、今日の 3 件を直しても
 * 「次に test を足した人が ci.yml に 1 行足し忘れる」で同じ状態に戻る。そこで
 * **「新しい test file を足したら自動で実行対象に入る」ことそのもの**を検査する:
 *
 * 1. `scripts/__tests__/**\/*.test.mjs` の全 file が、`ci.yml` のいずれかの `node --test`
 *    コマンドの引数（glob 含む）でカバーされていること
 * 2. カバーしているコマンドが **glob であること**（literal 列挙に戻すと、追加時の 1 行漏れで
 *    また実行されない file が生まれるため、literal だけで全件カバーしていても fail させる）
 *
 * ADR-0061（same-class-N→guard / fitness function）。同 class の先行例:
 * `ci-unit-test-path-filter-closure.test.ts`（#4007、path filter の closure）。
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test の区分宣言 (scripts/lib/ci/repo-scan-test-registry.mjs) に合わせた明示 timeout。
vi.setConfig({ testTimeout: 20_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const SCRIPTS_TESTS_DIR = 'scripts/__tests__';
const CI_WORKFLOW = '.github/workflows/ci.yml';

/** `scripts/__tests__/` 配下の test file（repo 相対、POSIX 区切り）を再帰列挙する。 */
function listScriptTestFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) {
			out.push(...listScriptTestFiles(rel));
		} else if (entry.name.endsWith('.test.mjs')) {
			out.push(rel);
		}
	}
	return out.sort();
}

/**
 * ci.yml から `node --test <args...>` の引数群を抽出する。
 *
 * quote (`"..."` / `'...'`) は剥がし、`node` のオプション (`--test-*` 等) は落とす。
 */
function extractNodeTestPatterns(workflowSrc: string): string[] {
	const patterns: string[] = [];
	// CRLF で読んだ場合、`.` は `\r` にマッチしない (JS regex では line terminator 扱い) ため
	// `(.+)$` が丸ごと不成立になり「引数 0 件」= 検査が黙って消える。改行を先に正規化する。
	for (const line of workflowSrc.replace(/\r\n?/g, '\n').split('\n')) {
		const m = line.match(/node\s+--test\s+(.+)$/);
		if (!m?.[1]) continue;
		const args = m[1].trim();
		for (const raw of args.split(/\s+/)) {
			const arg = raw.replace(/^["']|["']$/g, '');
			if (!arg || arg.startsWith('-')) continue;
			patterns.push(arg);
		}
	}
	return patterns;
}

/**
 * node の test runner が受け取る glob（`*` / `**`）を、対象 path にマッチするか判定する。
 *
 * `*` は `/` を跨がず、`**` は跨ぐ（node / picomatch と同じ意味）。
 */
function matchesPattern(pattern: string, filePath: string): boolean {
	if (!pattern.includes('*')) return pattern === filePath;
	const regexSrc = pattern
		.split('/')
		.map((seg) => {
			if (seg === '**') return '(?:.*)';
			return seg
				.split('*')
				.map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
				.join('[^/]*');
		})
		.join('/')
		// `a/**/b` の `**` が 0 セグメントにもマッチするようにする
		.replace(/\/\(\?:\.\*\)\//g, '/(?:.*/)?');
	return new RegExp(`^${regexSrc}$`).test(filePath);
}

describe('scripts/__tests__ の全 test file が CI の実行対象に入っている', () => {
	const testFiles = listScriptTestFiles(SCRIPTS_TESTS_DIR);
	const workflowSrc = readFileSync(path.join(REPO_ROOT, CI_WORKFLOW), 'utf8');
	const patterns = extractNodeTestPatterns(workflowSrc);

	it('前提: 走査対象の test file と ci.yml の node --test 引数がどちらも 1 件以上ある', () => {
		// 走査が空振りしたまま「違反 0 件」で緑になる silent-pass を塞ぐ (#4007 と同 class)。
		expect(testFiles.length).toBeGreaterThan(0);
		expect(patterns.length).toBeGreaterThan(0);
	});

	it('全 file がいずれかの node --test 引数でカバーされている', () => {
		const uncovered = testFiles.filter((f) => !patterns.some((p) => matchesPattern(p, f)));
		expect(
			uncovered,
			`ci.yml の node --test から実行されない test file がある。実行されない test は` +
				` drift しても気づけない (実測: 10 file 未実行 / うち 3 file が壊れていた)。` +
				` glob (${SCRIPTS_TESTS_DIR}/**/*.test.mjs) で渡すこと`,
		).toEqual([]);
	});

	it('カバーしているのが glob である（literal 列挙に戻さない）', () => {
		const globPatterns = patterns.filter((p) => p.includes('*') && p.startsWith(SCRIPTS_TESTS_DIR));
		const coveredByGlob = testFiles.filter((f) => globPatterns.some((p) => matchesPattern(p, f)));
		expect(
			coveredByGlob,
			`literal path の列挙は「test を足したら 1 行足す」を人の注意に依存させるため禁止する。` +
				` ci.yml では node --test "${SCRIPTS_TESTS_DIR}/**/*.test.mjs" のように glob で渡すこと`,
		).toEqual(testFiles);
	});
});
