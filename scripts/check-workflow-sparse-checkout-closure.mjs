#!/usr/bin/env node
/**
 * scripts/check-workflow-sparse-checkout-closure.mjs
 *
 * #3969: workflow の `sparse-checkout` が「実行する script の import 先」まで含んでいるかを検証する gate。
 *
 * ## 背景 — なぜこの gate が要るか
 *
 * `.github/workflows/` の gate job は、repo 全体を checkout せず
 * `sparse-checkout` で**必要なファイルだけを個別列挙**している (cone-mode: false)。
 *
 * ```yaml
 * sparse-checkout: |
 *   actions/pr-lane
 *   scripts/pr-lane.mjs
 *   scripts/check-merge-gate-checklist.mjs
 * sparse-checkout-cone-mode: false
 * ```
 *
 * この形は列挙が「script 単体」で閉じている前提に立っている。**#3969 で CLI 直接実行判定を
 * `scripts/lib/is-main.mjs` (SSOT) へ集約した結果、その前提が壊れた。** 列挙された script が
 * SSOT helper を import するようになり、helper が checkout されていない job は
 * `ERR_MODULE_NOT_FOUND` で落ちる。実際に必須 gate 6 job が同時に fail した。
 *
 * 今後 gate script を追加するたびに (`check-cli-entry-guard.mjs` が SSOT 利用を強制するため)
 * **必ず helper への import が生える**。つまりこれは一度直せば済む事故ではなく、
 * 列挙を手で書き続ける限り再発し続ける構造である。人間の注意力ではなく gate で閉じる
 * (ADR-0061 same-class-N→guard)。
 *
 * ## 検査内容
 *
 * `sparse-checkout` ブロックごとに、列挙された JS/MJS ファイルの**相対 import を再帰的に辿り**、
 * 到達する repo 内ファイルがすべて同じブロックに含まれているかを見る。
 * 含まれていなければ violation として報告する。
 *
 * ディレクトリ列挙 (`actions/pr-lane` 等) は prefix 一致で「含まれている」と扱う。
 *
 * ## 検査しないこと (意図的な限界)
 *
 * - **bare specifier** (`node:fs` / npm パッケージ) は対象外。checkout ではなく
 *   `npm ci` の担当であり、sparse-checkout の完全性とは別の問題。
 * - **動的 import** (`await import(expr)`) は式が静的に決まらないため辿れない。
 *   gate script は起動時 import で書かれている前提。
 * - **`.ts` の gate** を列挙した場合、その import は辿らない (起点は `JS_EXTS` のみ)。
 *   現状 sparse-checkout に列挙されている実体は `.mjs` と `actions/pr-lane` だけなので穴は顕在化しない。
 *   `.ts` gate を列挙するときは `JS_EXTS` に `.ts` を足し、拡張子省略 import の解決を追加する必要がある。
 * - **import 以外のリポジトリ内ファイル依存** (`readFileSync('docs/...')` 等) は辿らない。
 *   現在列挙されている 6 script はいずれも入力が env と引数のみで、repo 内ファイルを読んでいない。
 * - workflow が `run:` で実際にどの script を叩くかは見ない。列挙されたものだけを起点にする
 *   (列挙されていない script を叩く job は sparse-checkout 以前の問題として CI が即落ちる)。
 *
 * ## 使い方
 *
 *   node scripts/check-workflow-sparse-checkout-closure.mjs   # 不足があれば exit 1
 *   node scripts/check-workflow-sparse-checkout-closure.mjs --help
 *
 * ## 関連
 *   - scripts/lib/is-main.mjs (本 gate が生まれる原因になった SSOT helper)
 *   - scripts/check-cli-entry-guard.mjs (SSOT 利用を強制する側の gate)
 *   - tests/unit/scripts/workflow-sparse-checkout-closure.test.ts
 *   - Issue #3969
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { isMain as isMainModule } from './lib/is-main.mjs';

const WORKFLOW_DIR = join('.github', 'workflows');
/** import を辿る対象の拡張子。 */
const JS_EXTS = ['.mjs', '.cjs', '.js'];

/**
 * `sparse-checkout: |` の literal block scalar を行ベースで抽出する。
 *
 * YAML パーサを使わないのは、対象が「key + block scalar」という単純形に限られ、
 * かつ workflow の他の構文に一切依存しないため。行の字下げだけで閉じ判定できる。
 *
 * @param {string} source workflow YAML の内容
 * @returns {Array<{ line: number, entries: string[] }>} 1-origin 行番号と列挙されたパス
 */
export function parseSparseCheckoutBlocks(source) {
	const lines = source.split(/\r?\n/);
	/** @type {Array<{ line: number, entries: string[] }>} */
	const blocks = [];

	for (let i = 0; i < lines.length; i++) {
		const m = /^(\s*)sparse-checkout:\s*\|\s*$/.exec(lines[i] ?? '');
		if (!m) continue;
		const keyIndent = (m[1] ?? '').length;
		/** @type {string[]} */
		const entries = [];
		for (let j = i + 1; j < lines.length; j++) {
			const line = lines[j] ?? '';
			if (line.trim() === '') continue;
			const indent = line.length - line.trimStart().length;
			// block scalar は key より深く字下げされた行のみ。浅くなった時点で終端。
			if (indent <= keyIndent) break;
			entries.push(line.trim());
		}
		blocks.push({ line: i + 1, entries });
	}
	return blocks;
}

/**
 * 1 ファイルの相対 import specifier を抽出する。
 *
 * `import ... from './x.mjs'` / `import './x.mjs'` / `export ... from './x.mjs'` の 3 形。
 * bare specifier (`node:fs` / npm) は相対でないため自然に除外される。
 *
 * @param {string} source
 * @returns {string[]}
 */
export function extractRelativeImports(source) {
	/** @type {string[]} */
	const specs = [];
	const re = /(?:^|\n)\s*(?:import|export)\s[^;\n]*?['"](\.[^'"]+)['"]/g;
	let m = re.exec(source);
	while (m !== null) {
		const spec = m[1];
		if (spec !== undefined) specs.push(spec);
		m = re.exec(source);
	}
	// `import './side-effect.mjs'` (from を伴わない形)
	const sideEffect = /(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g;
	m = sideEffect.exec(source);
	while (m !== null) {
		const spec = m[1];
		if (spec !== undefined && !specs.includes(spec)) specs.push(spec);
		m = sideEffect.exec(source);
	}
	return specs;
}

/**
 * repo 相対パスが、列挙された entry のいずれかで覆われているか。
 *
 * entry がファイルなら完全一致、ディレクトリなら prefix 一致で覆う。
 *
 * @param {string} relPath posix 区切りの repo 相対パス
 * @param {readonly string[]} entries
 * @returns {boolean}
 */
export function isCoveredBy(relPath, entries) {
	return entries.some((entry) => {
		const e = entry.replace(/^\.\//, '').replace(/\/+$/, '');
		return relPath === e || relPath.startsWith(`${e}/`);
	});
}

/** @param {string} p @returns {string} */
function toPosix(p) {
	return p.split(sep).join('/');
}

/**
 * 起点ファイル群から相対 import を再帰的に辿り、到達する repo 相対パス集合を返す。
 *
 * 起点自身は含めない (起点は定義上 sparse-checkout に列挙されている)。
 *
 * @param {string} repoRoot
 * @param {readonly string[]} startRelPaths posix 区切りの repo 相対パス
 * @returns {string[]} posix 区切りの repo 相対パス (到達順、重複なし)
 */
export function collectTransitiveDeps(repoRoot, startRelPaths) {
	/** @type {Set<string>} */
	const seen = new Set(startRelPaths);
	/** @type {string[]} */
	const found = [];
	/** @type {string[]} */
	const queue = [...startRelPaths];

	while (queue.length > 0) {
		const current = /** @type {string} */ (queue.shift());
		const abs = join(repoRoot, current);
		if (!existsSync(abs)) continue;
		if (!JS_EXTS.some((ext) => current.endsWith(ext))) continue;

		for (const spec of extractRelativeImports(readFileSync(abs, 'utf8'))) {
			const depRel = toPosix(relative(repoRoot, resolve(dirname(abs), spec)));
			// repo 外へ出る import は checkout の対象外 (そもそも存在し得ない)
			if (depRel.startsWith('..')) continue;
			if (seen.has(depRel)) continue;
			seen.add(depRel);
			found.push(depRel);
			queue.push(depRel);
		}
	}
	return found;
}

/**
 * workflow 1 ファイルを検査する (純粋部分は上記 export 群、こちらは fs 依存)。
 *
 * `enumerated` / `resolved` も返すのは、**本 gate 自身が無言 PASS する条件を可視化する**ため。
 * 列挙された script が 1 本も disk 上に無い環境 (sparse checkout された作業ツリー等) では
 * 起点が空になり、違反 0 件 = exit 0 になる。それを「検証した」と読み違えないよう、
 * main() 側で「起点 0 本」を OK と区別して表示する (#3969 が閉じる class と同型のため)。
 *
 * @param {string} repoRoot
 * @param {string} workflowRelPath posix 区切り
 * @returns {{ violations: Array<{ workflow: string, line: number, missing: string, via: string }>, enumerated: string[], resolved: string[] }}
 */
function checkWorkflow(repoRoot, workflowRelPath) {
	const source = readFileSync(join(repoRoot, workflowRelPath), 'utf8');
	/** @type {Array<{ workflow: string, line: number, missing: string, via: string }>} */
	const violations = [];
	/** @type {string[]} */
	const enumerated = [];
	/** @type {string[]} */
	const resolved = [];

	for (const block of parseSparseCheckoutBlocks(source)) {
		const jsEntries = block.entries.filter((e) => JS_EXTS.some((ext) => e.endsWith(ext)));
		const starts = jsEntries.filter((e) => existsSync(join(repoRoot, e)));
		enumerated.push(...jsEntries);
		resolved.push(...starts);
		if (starts.length === 0) continue;

		for (const dep of collectTransitiveDeps(repoRoot, starts)) {
			if (isCoveredBy(dep, block.entries)) continue;
			violations.push({
				workflow: workflowRelPath,
				line: block.line,
				missing: dep,
				via: starts.join(', '),
			});
		}
	}
	return { violations, enumerated, resolved };
}

function printHelp() {
	console.log(`check-workflow-sparse-checkout-closure.mjs — sparse-checkout の import 閉包検証 (Issue #3969)

検査対象: ${toPosix(WORKFLOW_DIR)}/*.yml の \`sparse-checkout: |\` ブロック
検査内容: 列挙された ${JS_EXTS.join(' / ')} の相対 import を再帰的に辿り、
          到達先が同じブロックに列挙されているかを確認する

対象外  : bare specifier (node: / npm) — npm ci の担当
          動的 import — 式が静的に決まらない

使い方  : node scripts/check-workflow-sparse-checkout-closure.mjs`);
}

function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		printHelp();
		return 0;
	}

	const repoRoot = process.cwd();
	const dir = join(repoRoot, WORKFLOW_DIR);
	if (!existsSync(dir) || !statSync(dir).isDirectory()) {
		console.log(
			`[check-workflow-sparse-checkout-closure] SKIP: ${toPosix(WORKFLOW_DIR)} が無い (sparse checkout 環境)`,
		);
		return 0;
	}

	const workflows = readdirSync(dir)
		.filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
		.map((n) => posix.join(toPosix(WORKFLOW_DIR), n));

	const results = workflows.map((w) => checkWorkflow(repoRoot, w));
	const violations = results.flatMap((r) => r.violations);
	const enumerated = results.flatMap((r) => r.enumerated);
	const resolved = results.flatMap((r) => r.resolved);

	// 起点が 1 本も解決できなければ「漏れ 0 件」ではなく「未検証」。無言 PASS を OK と呼ばない。
	if (resolved.length === 0) {
		console.log(
			`[check-workflow-sparse-checkout-closure] SKIP: 列挙された ${enumerated.length} 本の script が disk 上に無く、閉包は未検証 (sparse checkout 環境)`,
		);
		return 0;
	}

	if (violations.length === 0) {
		console.log(
			`[check-workflow-sparse-checkout-closure] OK: ${workflows.length} workflow / 起点 ${resolved.length} 本の sparse-checkout に import 漏れ 0 件`,
		);
		return 0;
	}

	console.error(
		`[check-workflow-sparse-checkout-closure] FAIL: ${violations.length} 件の import 漏れ`,
	);
	console.error('');
	for (const v of violations) {
		console.error(`  ${v.workflow}:${v.line}  不足: ${v.missing}`);
		console.error(`      ${v.via} が import しているが sparse-checkout に列挙されていない`);
	}
	console.error('');
	console.error(
		'  対処: 当該 sparse-checkout ブロックに上記パスを追加する (job は ERR_MODULE_NOT_FOUND で落ちる)',
	);
	return 1;
}

if (isMainModule(import.meta.url)) {
	process.exit(main());
}
