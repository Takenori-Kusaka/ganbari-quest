#!/usr/bin/env node
/**
 * scripts/check-readdir-rotation-guard.mjs
 *
 * #3978: 「`readdir` の戻りを緩い一致で絞り込み、その結果を破壊的操作の対象にする」class を
 * 機械的に検出する gate。
 *
 * ## 背景 — なぜ 2 回目で gate 化するのか
 *
 * PR #3956 で QM から「`readdir` の戻りを `startsWith` + `endsWith` の緩い一致で世代として
 * 数えており、命名規則から外れたファイルが世代枠を食う」という BLOCK を受けた。#3956 では
 * PGlite 側 (`PGLITE_BACKUP_FILENAME_PATTERN`) を正規表現の完全一致に直して閉じたが、
 * **同じ class が `scripts/backup-db.cjs` に残存していた** (#3978 の一次調査で発見)。
 *
 * 手動退避 `ganbari-quest-manual-pre-hotfix.db` を 1 本置くだけで、辞書順で `'m'` は数字より
 * 後ろなので降順ソートの先頭 (= 最新扱い) に居座り、保持枠を恒久的に 1 つ食う。結果として
 * 実バックアップの最古 1 世代が本来より 1 日早く `unlinkSync` される。
 *
 * 「3 回目で linter rule 化では遅い。2 回目で機械化を試み、代わりに機械化の水準を下げる」
 * という PO / QM 判断 (docs/sessions/dev-session.md §「QA 指摘の再発防止台帳」#2/#3) に従い、
 * 本 gate は **意図的に精度を落とした行ベース検査**として実装している。
 *
 * ## 検出条件 (3 つすべてを満たす箇所)
 *
 *   1. `readdir` / `readdirSync` の呼び出しがある
 *   2. その直後の chain 内 (CHAIN_WINDOW 行) の `.filter(...)` が `startsWith(` / `endsWith(` を
 *      直接使っており、`*_PATTERN` 名の const (正規表現) を経由していない
 *   3. 同一ファイル内の近接 (±PROXIMITY_WINDOW 行) に破壊的操作
 *      (`unlinkSync` / `rm(` / `rmSync(` / `rename(` / `renameSync(` / `unlink(`) がある
 *
 * ## 意図的に下げた水準 (false positive を許容する)
 *
 * 静的解析で「同一関数内」を厳密に取るのは重いので、初版は **同一ファイル内の近接 (±20 行)**
 * で判定する。false positive は許容し、`rotation-gate-ok: <理由>` の inline 抑制コメントで
 * 明示的に除外できるようにしている。
 *
 * **抑制コメントを書かせること自体が「この絞り込みは削除に使われる」という宣言になる**ので、
 * gate の目的 (書き手にその接続を意識させる) は達成される。理由が空のマーカーは opt-out として
 * 認めない (無言の抑止を防ぐ)。
 *
 * ## 使い方
 *
 *   node scripts/check-readdir-rotation-guard.mjs          # 違反があれば exit 1
 *   node scripts/check-readdir-rotation-guard.mjs --help
 *
 * ## 関連
 *   - src/lib/server/db/pglite/backup.ts (目標形: PGLITE_BACKUP_FILENAME_PATTERN 完全一致)
 *   - scripts/backup-db.cjs (#3978 で是正した同 class の実在箇所)
 *   - tests/unit/scripts/check-readdir-rotation-guard.test.ts
 *   - ADR-0061 (same-class-N → guard 化)
 *   - Issue #3956 / #3978
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isMain as isMainModule } from './lib/is-main.mjs';

/** 走査対象ルート (repo 相対)。 */
export const SCAN_ROOTS = ['src', 'scripts'];
/** 走査対象拡張子。 */
export const SCAN_EXTS = ['.ts', '.js', '.mjs', '.cjs'];
/** 走査から外すディレクトリ名 (worktrees は他ブランチ実体を重複走査しないため必須)。 */
const SKIP_DIRS = new Set([
	'node_modules',
	'.svelte-kit',
	'cdk.out',
	'dist',
	'build',
	'__snapshots__',
	'worktrees',
]);

/**
 * `readdir` 行から下方向に何行を「同一 chain」と見なすか。
 * `.readdirSync(dir)` → 改行 → `.filter(...)` → `.sort()` … の整形済みチェーンを拾える幅。
 */
export const CHAIN_WINDOW = 8;
/**
 * 破壊的操作を探す近接幅 (readdir 行の ±)。#3978 の指定値。
 * 「同一関数内」の厳密判定を避けた代替であり、false positive は抑制コメントで処理する。
 */
export const PROXIMITY_WINDOW = 20;

/** 破壊的操作。これが近接に無ければ「列挙だけ」なので対象外 (走査 script 等の false positive を除く)。 */
const DESTRUCTIVE_RE = /\b(unlinkSync|unlink|rmSync|rm|renameSync|rename)\s*\(/;
/** 緩い一致による絞り込み。 */
const LOOSE_MATCH_RE = /\.(startsWith|endsWith)\s*\(/;
/** 命名済みパターン const (正規表現) 経由の判定。これがあれば緩い一致があっても対象外。 */
const NAMED_PATTERN_RE = /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_PATTERN\b/;
/** readdir 呼び出し。 */
const READDIR_RE = /\breaddir(Sync)?\s*\(/;
/** 抑制マーカー (理由必須)。 */
const SUPPRESS_RE = /rotation-gate-ok:\s*\S/;

/**
 * 行がコメントのみか判定する (block comment の内側行 / 行頭 `//` / shebang)。
 *
 * 完全な字句解析はしない。gate の目的は「実行されるコード」の検出であり、
 * 解説コメント中の記述例 (本 file 冒頭の説明など) を violation にしないための最小限の除外。
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isCommentLine(line) {
	const t = line.trim();
	return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#!');
}

/**
 * 対象行、またはその直前に連続するコメント行の中に抑制マーカーがあるか。
 *
 * @param {readonly string[]} lines
 * @param {number} index 対象行の 0-based index
 * @returns {boolean}
 */
function hasSuppression(lines, index) {
	if (SUPPRESS_RE.test(lines[index] ?? '')) return true;
	for (let j = index - 1; j >= 0; j--) {
		const line = lines[j] ?? '';
		if (line.trim() === '') break;
		if (!isCommentLine(line)) break;
		if (SUPPRESS_RE.test(line)) return true;
	}
	return false;
}

/**
 * 1 ファイルを走査して violation を返す (純粋関数、unit test 対象)。
 *
 * @param {string} relPath repo 相対パス (区切りは OS 依存でよい)
 * @param {string} source ファイル内容
 * @returns {Array<{ file: string, line: number, text: string }>}
 */
export function scanSource(relPath, source) {
	const normalized = relPath.split(sep).join('/');
	const lines = source.split(/\r?\n/);
	/** @type {Array<{ file: string, line: number, text: string }>} */
	const violations = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (isCommentLine(line)) continue;
		if (!READDIR_RE.test(line)) continue;

		// (2) chain 内の絞り込みが「緩い一致」かつ「命名済みパターン非経由」か。
		const chain = lines
			.slice(i, i + CHAIN_WINDOW + 1)
			.filter((l) => !isCommentLine(l))
			.join('\n');
		if (!chain.includes('.filter(')) continue;
		if (!LOOSE_MATCH_RE.test(chain)) continue;
		if (NAMED_PATTERN_RE.test(chain)) continue;

		// (3) 近接に破壊的操作があるか (= 絞り込み結果が削除 / 移動の対象集合になり得る)。
		const near = lines
			.slice(Math.max(0, i - PROXIMITY_WINDOW), i + PROXIMITY_WINDOW + 1)
			.filter((l) => !isCommentLine(l))
			.join('\n');
		if (!DESTRUCTIVE_RE.test(near)) continue;

		if (hasSuppression(lines, i)) continue;

		violations.push({ file: normalized, line: i + 1, text: line.trim() });
	}

	return violations;
}

/**
 * dir 配下を再帰走査して対象拡張子のファイルを集める。テストファイルは対象外。
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
		const full = join(dir, e.name);
		if (e.isDirectory()) {
			if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
			collectFiles(full, acc);
			continue;
		}
		if (!e.isFile()) continue;
		if (/\.(test|spec)\./.test(e.name)) continue;
		if (SCAN_EXTS.some((ext) => e.name.endsWith(ext))) acc.push(full);
	}
	return acc;
}

/**
 * repoRoot 配下の SCAN_ROOTS を走査し、全違反と走査件数を返す。
 *
 * @param {string} repoRoot
 * @returns {{ violations: Array<{ file: string, line: number, text: string }>, scanned: string[], fileCount: number }}
 */
export function findAllViolations(repoRoot) {
	/** @type {Array<{ file: string, line: number, text: string }>} */
	const violations = [];
	/** @type {string[]} */
	const scanned = [];
	let fileCount = 0;

	for (const scanRoot of SCAN_ROOTS) {
		const abs = join(repoRoot, scanRoot);
		try {
			if (!statSync(abs).isDirectory()) {
				scanned.push(`${scanRoot}=対象外`);
				continue;
			}
		} catch {
			scanned.push(`${scanRoot}=未検出`);
			continue;
		}
		const files = collectFiles(abs);
		scanned.push(`${scanRoot}=${files.length}`);
		fileCount += files.length;
		for (const file of files) {
			violations.push(...scanSource(relative(repoRoot, file), readFileSync(file, 'utf8')));
		}
	}

	return { violations, scanned, fileCount };
}

function printHelp() {
	console.log(`check-readdir-rotation-guard.mjs — readdir の緩い一致 × 破壊的操作を禁止する gate (Issue #3978)

走査対象: ${SCAN_ROOTS.join(' / ')} 配下の ${SCAN_EXTS.join(' / ')} (*.test.* / *.spec.* は除外)
検出条件: readdir の chain 内 (${CHAIN_WINDOW} 行) の .filter が startsWith / endsWith を直接使い、
          *_PATTERN 経由でなく、同一ファイルの ±${PROXIMITY_WINDOW} 行に破壊的操作がある
opt-out : 当該行または直前のコメント行に \`rotation-gate-ok: <理由>\` (理由必須)
使い方  : node scripts/check-readdir-rotation-guard.mjs`);
}

function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		printHelp();
		return 0;
	}
	const repoRoot = process.cwd();
	const { violations, scanned, fileCount } = findAllViolations(repoRoot);

	// 走査件数を必ず出す。0 件走査と 0 件違反が同じ文言の exit 0 になると、
	// 「gate が壊れて何も見ていない」状態を PASS と読み違える (本 gate が塞ぐ class と同型)。
	if (fileCount === 0) {
		console.error(
			`[check-readdir-rotation-guard] FAIL: 1 ファイルも走査していません (走査 ${scanned.join(' / ')})`,
		);
		console.error(
			'  → cwd が repo root か、SCAN_ROOTS が checkout に含まれているか確認してください。',
		);
		return 1;
	}

	if (violations.length === 0) {
		console.log(
			`[check-readdir-rotation-guard] OK: 緩い一致 × 破壊的操作は 0 件 (走査 ${scanned.join(' / ')})`,
		);
		return 0;
	}

	console.error(`[check-readdir-rotation-guard] FAIL: ${violations.length} 件の違反`);
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line} ${v.text}`);
	}
	console.error('\n  背景: readdir の戻りを prefix / suffix の緩い一致で絞り込むと、命名規則から');
	console.error('        外れた同居物 (手動退避 / 旧命名の残骸 / ディレクトリ) が「世代」として');
	console.error('        数えられ、保持枠を食う or 削除対象に混ざる (#3956 / #3978)。');
	console.error('  → 修正: 命名規則を `*_PATTERN` 名の正規表現 const として定義し、その完全一致');
	console.error(
		'          (`PATTERN.test(name)`) で絞り込む。生成側にも同じパターンの assert を置く。',
	);
	console.error(
		'  → opt-out: 別 class だと判断した場合のみ、当該行/直前行に `rotation-gate-ok: <理由>`',
	);
	return 1;
}

if (isMainModule(import.meta.url)) {
	process.exit(main());
}
