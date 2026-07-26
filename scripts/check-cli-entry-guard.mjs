#!/usr/bin/env node
/**
 * scripts/check-cli-entry-guard.mjs
 *
 * #3969: 「CLI 直接実行判定 (isMain) を各 script が自前で書く」ことを機械的に禁止する gate。
 *
 * ## 背景 — なぜ grep gate が必要か
 *
 * `scripts/` 配下の 53 script が末尾で自前の isMain 判定を持ち、そのうち 41 件が
 * **symlink / junction 経由の起動で必ず false になる**実装だった。false になると
 * `main()` が呼ばれず、**何も検査しないまま exit 0 (= PASS)** を返す。
 * gate script でこれが起きると「壊れていることに誰も気付かない」。
 *
 * 判定を `scripts/lib/is-main.mjs` (SSOT) へ集約しただけでは、次に script を書く人が
 * 42 個目の方言を持ち込んで同じ事故が再発する。**再発を人間のレビュー勘に頼らないため**の
 * gate が本 script である。
 *
 * ## 検出する 2 つのサブクラス
 *
 * 1. **argv1**: `process.argv[1]` の直接参照。
 *    `import.meta.url` (実体パス) と `process.argv[1]` (ユーザー入力パス) を比べる形は
 *    symlink 経由で必ず不一致になる。
 * 2. **file-url**: `` `file://${...}` `` / `'file://' + ...` の手組み URL。
 *    Windows で `file:///E:/x` と `file://E:\x` を比べることになり、symlink の有無に
 *    関係なく**常に false**。`scripts/check-cdk-replacement.mjs` がこれで、本番 deploy 経路の
 *    Replacement 保護が Windows ローカルでは一度も機能していなかった。
 *    URL 化が必要なら `node:url` の `pathToFileURL()` を使う。
 *
 * ## opt-out
 *
 * 正当な理由がある場合のみ、当該行または直前行に理由付きマーカーを置く:
 *   - `allow-argv1: <理由>`
 *   - `allow-file-url: <理由>`
 * 理由文字列が空のマーカーは opt-out として認めない (無言の抑止を防ぐ)。
 *
 * ## 使い方
 *
 *   node scripts/check-cli-entry-guard.mjs          # 違反があれば exit 1
 *   node scripts/check-cli-entry-guard.mjs --help
 *
 * ## 関連
 *   - scripts/lib/is-main.mjs (判定 SSOT)
 *   - tests/unit/scripts/cli-entry-guard.test.ts (本 gate + no-op meta-gate)
 *   - ADR-0061 (same-class N 回 → guard 化)
 *   - Issue #3969
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isMain as isMainModule } from './lib/is-main.mjs';

/**
 * 走査対象のルート (repo 相対)。tests/ は node -e 文字列中の argv[1] が正当なため対象外。
 *
 * `.claude` を含むのは、hook / skill script も**壊れると無言で PASS する gate** だからである
 * (`.claude/hooks/gate-approve.mjs` は ADR-0056 evidence を検証して QM の approve を止める hook で、
 * junction 経由では判定が false になり approve を素通ししていた)。実行経路が `scripts/` と違うだけで
 * 事故の class は同じなので、走査範囲を実行経路ではなく「壊れたときに無言で PASS するか」で決める。
 */
const SCAN_ROOTS = ['scripts', 'src', 'infra', '.claude'];
const SCAN_EXTS = ['.mjs', '.cjs', '.js', '.ts'];
/**
 * 走査から外すディレクトリ名。
 *
 * `worktrees` は `.claude/worktrees/` に git worktree 実体が置かれる運用があるため必須
 * (除外しないと他ブランチの全ソースを重複走査し、本ブランチと無関係な違反を報告する)。
 */
const SKIP_DIRS = new Set([
	'node_modules',
	'.svelte-kit',
	'cdk.out',
	'dist',
	'build',
	'__snapshots__',
	'worktrees',
]);
/** 判定 SSOT 自身は argv[1] を参照してよい (むしろここだけが参照すべき)。 */
const SSOT_FILE = join('scripts', 'lib', 'is-main.mjs');

/** @typedef {{ id: string, re: RegExp, marker: RegExp, hint: string }} Rule */

/** @type {readonly Rule[]} */
const RULES = [
	{
		id: 'argv1',
		re: /process\s*\.\s*argv\s*\[\s*1\s*\]/,
		marker: /allow-argv1:\s*\S/,
		hint: "CLI 直接実行判定は `import { isMain } from '<rel>/lib/is-main.mjs'` を使う (symlink / junction 経由でも正しく判定される)",
	},
	{
		id: 'file-url',
		// `file://${...}` (template literal) と 'file://' + x / "file://" + x (連結) の両形。
		re: /`file:\/\/\$\{|['"]file:\/\/['"]\s*\+/,
		marker: /allow-file-url:\s*\S/,
		hint: 'path → URL 変換は `pathToFileURL()` (node:url) を使う。手組みは Windows で常に不一致になる',
	},
];

/**
 * 行がコメントのみか判定する (block comment の内側行 / 行頭 `//` / shebang)。
 *
 * 完全な字句解析はしない。gate の目的は「実行される比較コード」の検出であり、
 * 解説コメント中の記述例を violation にしないための最小限の除外である。
 *
 * @param {string} line
 * @returns {boolean}
 */
function isCommentLine(line) {
	const t = line.trim();
	return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#!');
}

/**
 * 対象行の直前に連続するコメント行の中に opt-out マーカーがあるか判定する。
 *
 * @param {readonly string[]} lines
 * @param {number} index 対象行の 0-based index
 * @param {RegExp} marker
 * @returns {boolean}
 */
function hasMarkerInPrecedingComments(lines, index, marker) {
	for (let j = index - 1; j >= 0; j--) {
		const line = lines[j] ?? '';
		if (line.trim() === '') break;
		if (!isCommentLine(line)) break;
		if (marker.test(line)) return true;
	}
	return false;
}

/**
 * dir 配下を再帰走査して対象拡張子のファイルを集める。
 *
 * @param {string} dir
 * @param {string[]} [acc]
 * @returns {string[]}
 */
function collectFiles(dir, acc = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return acc;
	}
	for (const e of entries) {
		if (e.name.startsWith('.') && e.name !== '.github') continue;
		const full = join(dir, e.name);
		if (e.isDirectory()) {
			if (SKIP_DIRS.has(e.name)) continue;
			collectFiles(full, acc);
			continue;
		}
		if (!e.isFile()) continue;
		if (SCAN_EXTS.some((ext) => e.name.endsWith(ext))) acc.push(full);
	}
	return acc;
}

/**
 * 1 ファイルを走査して violation を返す (純粋関数、unit test 対象)。
 *
 * ## 守備範囲 (意図的な限界)
 *
 * 正規表現による行単位の静的検査であり、`process.argv[1]` の**字面**しか見ない。
 * 以下の等価な書き方は素通りする:
 *
 *   - `const [, entry] = process.argv;`
 *   - `process.argv.at(1)`
 *   - `process.argv.slice(1)[0]`
 *
 * AST 解析まで広げれば塞げるが、本 gate の目的は「41 件あった既知の方言が**再び増えない**こと」であり、
 * 迂回を試みる書き手を想定していない。上記 3 形を書くのは argv[1] 直参照より手間が多く、
 * 素で書かれる確率が低い。塞ぐコスト > 得られる保証、と判断して字面検査に留めている。
 * 迂回形が実際に混入したら、その時点で AST 化する (ADR-0061 same-class-N→guard)。
 *
 * @param {string} relPath repo 相対パス (区切りは OS 依存でよい)
 * @param {string} source ファイル内容
 * @returns {Array<{ file: string, line: number, rule: string, text: string, hint: string }>}
 */
export function scanSource(relPath, source) {
	const normalized = relPath.split(sep).join('/');
	if (normalized === SSOT_FILE.split(sep).join('/')) return [];
	const lines = source.split(/\r?\n/);
	const violations = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (isCommentLine(line)) continue;
		for (const rule of RULES) {
			if (!rule.re.test(line)) continue;
			// 当該行、または直前に連続するコメントブロック内に理由付き opt-out マーカーがあれば許可。
			// 「直前 1 行のみ」に限ると、複数行で理由を書いた正当な opt-out が通らない。
			if (rule.marker.test(line) || hasMarkerInPrecedingComments(lines, i, rule.marker)) continue;
			violations.push({
				file: normalized,
				line: i + 1,
				rule: rule.id,
				text: line.trim(),
				hint: rule.hint,
			});
		}
	}
	return violations;
}

function printHelp() {
	console.log(`check-cli-entry-guard.mjs — CLI 直接実行判定の自前実装を禁止する gate (Issue #3969)

走査対象: ${SCAN_ROOTS.join(' / ')} 配下の ${SCAN_EXTS.join(' / ')}
検出ルール:
  argv1     argv[1] の直接参照 (symlink 経由で isMain が常に false になる)
  file-url  file スキーマ URL をテンプレート / 文字列連結で手組み (Windows で常に false)

判定 SSOT : ${SSOT_FILE.split(sep).join('/')}
opt-out   : 当該行または直前行に \`allow-argv1: <理由>\` / \`allow-file-url: <理由>\`
使い方    : node scripts/check-cli-entry-guard.mjs`);
}

function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		printHelp();
		return 0;
	}
	const root = process.cwd();
	const violations = [];
	for (const scanRoot of SCAN_ROOTS) {
		const abs = join(root, scanRoot);
		try {
			if (!statSync(abs).isDirectory()) continue;
		} catch {
			continue;
		}
		for (const file of collectFiles(abs)) {
			violations.push(...scanSource(relative(root, file), readFileSync(file, 'utf8')));
		}
	}

	if (violations.length === 0) {
		console.log('[check-cli-entry-guard] OK: 自前の CLI 実行判定 / 手組み file:// URL は 0 件');
		return 0;
	}

	console.error(`[check-cli-entry-guard] FAIL: ${violations.length} 件の違反`);
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.text}`);
		console.error(`      → ${v.hint}`);
	}
	console.error(
		'\n  背景: symlink / junction 経由で起動すると自前判定は必ず false になり、gate が何も',
	);
	console.error('        検査せず exit 0 を返す (#3969 で 41 script が該当していた)。');
	console.error(
		`  opt-out: 正当な理由があれば当該行/直前行に \`allow-argv1: <理由>\` または \`allow-file-url: <理由>\``,
	);
	return 1;
}

if (isMainModule(import.meta.url)) {
	process.exit(main());
}
