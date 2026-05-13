#!/usr/bin/env node

/**
 * scripts/check-namespace-duplicate.mjs (#2061)
 *
 * Issue 起票時の namespace 重複検査ツール。
 *
 * 背景:
 *   PR #2041 (#1898) と PR #2044 (#1896) で同名 namespace `LP_FAQ_TERMS` を別 scope で
 *   2 回 export しようとして TypeScript duplicate identifier conflict が発生した。
 *   PO Session で Issue 起票時に既存 namespace との scope 重複検査が手動運用でスケールしない
 *   ため、ADR-0009 / ADR-0045 (terms.ts → labels.ts SSOT) の起票時 gate として導入。
 *
 * 動作:
 *   1. Issue body ファイル (markdown) から `XXX_LABELS` / `XXX_TERMS` 等の
 *      SCREAMING_SNAKE_CASE namespace 名を抽出
 *   2. `src/lib/domain/terms.ts` / `src/lib/domain/labels.ts` を grep し、既存 `export const`
 *      に同名 namespace が存在するか判定
 *   3. (任意) `gh` CLI が存在し `--check-open-issues` 指定時は open Issue の title/body も検索
 *   4. 衝突を検出した場合は警告を出力し、PO に対応指針 (scope 統合 / 命名衝突回避) を提示
 *
 * 使用法:
 *   # Issue body draft ファイルを引数で渡す（PO Session の通常運用）
 *   node scripts/check-namespace-duplicate.mjs tmp/issue-bodies/<slug>.md
 *
 *   # 標準入力経由
 *   cat tmp/issue-bodies/<slug>.md | node scripts/check-namespace-duplicate.mjs -
 *
 *   # open Issue 検索を同時実行 (gh CLI 認証済みが前提)
 *   node scripts/check-namespace-duplicate.mjs tmp/issue-bodies/<slug>.md --check-open-issues
 *
 *   # 衝突検出時に exit 1 (CI 用、デフォルトは warning のみで exit 0)
 *   node scripts/check-namespace-duplicate.mjs tmp/issue-bodies/<slug>.md --fail-on-conflict
 *
 * 終了コード:
 *   0: 衝突なし、または衝突ありだが --fail-on-conflict なし (PO 判断に委ねる)
 *   1: --fail-on-conflict 指定時に衝突検出
 *   2: 入力エラー (ファイル不存在等)
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 抽出対象 namespace パターン
// ---------------------------------------------------------------------------
//
// SSOT は src/lib/domain/{terms,labels}.ts。両ファイルの `export const` 命名規則は:
//   - terms.ts:  `XXX_TERMS` (atom、例: `PLAN_TERMS` / `LP_FAQ_TERMS`)
//   - labels.ts: `XXX_LABELS` (compound、例: `APP_LABELS` / `LP_HERO_LABELS`)
//   - 例外:      `PAGE_TITLES` / `NAV_CATEGORIES` (suffix なし) は誤検知抑制のため対象外
//
// 検出対象は SCREAMING_SNAKE + 末尾 `_LABELS|_TERMS` で限定。
// 単一単語 (PLAN_TERMS) と複合 (LP_FAQ_TERMS) の両方を許容する。
// `_TERMS` / `_LABELS` は本ドメイン外で偶然出現しにくいため false-positive は低い。

const NAMESPACE_PATTERN = /\b([A-Z][A-Z0-9_]*_(?:LABELS|TERMS))\b/g;

// 抽出後に除外する false-positive (本ツール自身が説明文で言及するためのキーワード等)
const EXCLUDE_NAMES = new Set([
	// 本ツールが説明文中に書き得る一般語
	'XXX_LABELS',
	'XXX_TERMS',
]);

// ---------------------------------------------------------------------------
// 入力解析
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const args = {
		input: null,
		checkOpenIssues: false,
		failOnConflict: false,
		help: false,
	};
	for (const a of argv) {
		if (a === '--check-open-issues') args.checkOpenIssues = true;
		else if (a === '--fail-on-conflict') args.failOnConflict = true;
		else if (a === '--help' || a === '-h') args.help = true;
		else if (a === '-') args.input = '-';
		else if (!a.startsWith('--')) args.input = a;
	}
	return args;
}

function readInput(input) {
	if (input === '-') {
		return fs.readFileSync(0, 'utf8');
	}
	if (!input) {
		console.error('Error: Issue body ファイルパスが必要です。--help を参照してください。');
		process.exit(2);
	}
	const abs = path.resolve(process.cwd(), input);
	if (!fs.existsSync(abs)) {
		console.error(`Error: ファイルが存在しません: ${abs}`);
		process.exit(2);
	}
	return fs.readFileSync(abs, 'utf8');
}

function printHelp() {
	console.log(`scripts/check-namespace-duplicate.mjs (#2061)

Issue 起票前に SSOT namespace 名 (XXX_LABELS / XXX_TERMS) の重複を検査します。

使用法:
  node scripts/check-namespace-duplicate.mjs <issue-body-file>
  node scripts/check-namespace-duplicate.mjs - < issue-body.md
  node scripts/check-namespace-duplicate.mjs tmp/issue-bodies/foo.md --check-open-issues
  node scripts/check-namespace-duplicate.mjs tmp/issue-bodies/foo.md --fail-on-conflict

オプション:
  --check-open-issues   gh CLI で open Issue の title/body 内 namespace も検索
  --fail-on-conflict    衝突検出時に exit 1 (デフォルトは warning のみで exit 0)
  -h, --help            このヘルプを表示
`);
}

// ---------------------------------------------------------------------------
// namespace 抽出
// ---------------------------------------------------------------------------

export function extractNamespaces(body) {
	const found = new Set();
	const matches = body.matchAll(NAMESPACE_PATTERN);
	for (const m of matches) {
		const name = m[1];
		if (EXCLUDE_NAMES.has(name)) continue;
		found.add(name);
	}
	return [...found];
}

// ---------------------------------------------------------------------------
// SSOT 重複検査 (terms.ts / labels.ts)
// ---------------------------------------------------------------------------

const SSOT_FILES = ['src/lib/domain/terms.ts', 'src/lib/domain/labels.ts'];

export function checkSSotDuplicates(namespaces, repoRoot = REPO_ROOT) {
	const conflicts = [];
	for (const file of SSOT_FILES) {
		const abs = path.join(repoRoot, file);
		if (!fs.existsSync(abs)) continue;
		const content = fs.readFileSync(abs, 'utf8');
		for (const ns of namespaces) {
			// `export const NS =` (行頭 / 改行直後限定)
			const re = new RegExp(`^export\\s+const\\s+${ns}\\s*=`, 'm');
			if (re.test(content)) {
				conflicts.push({ namespace: ns, file });
			}
		}
	}
	return conflicts;
}

// ---------------------------------------------------------------------------
// open Issue 検索 (オプション)
// ---------------------------------------------------------------------------

function checkOpenIssues(namespaces) {
	const conflicts = [];
	try {
		execSync('gh --version', { stdio: 'ignore' });
	} catch {
		console.warn('Warning: gh CLI が見つからないため open Issue 検索を skip します。');
		return conflicts;
	}
	for (const ns of namespaces) {
		try {
			const out = execSync(
				`gh issue list --state open --search "${ns}" --json number,title --limit 10`,
				{ encoding: 'utf8' },
			);
			const items = JSON.parse(out);
			for (const it of items) {
				conflicts.push({ namespace: ns, number: it.number, title: it.title });
			}
		} catch (e) {
			console.warn(`Warning: gh issue list for "${ns}" failed: ${e.message}`);
		}
	}
	return conflicts;
}

// ---------------------------------------------------------------------------
// 出力
// ---------------------------------------------------------------------------

function reportConflicts(namespaces, ssotConflicts, issueConflicts) {
	console.log(`\n[check-namespace-duplicate] 検出 namespace: ${namespaces.length} 件`);
	if (namespaces.length === 0) {
		console.log(
			'  (Issue body 内に XXX_LABELS / XXX_TERMS 形式の namespace 名は見つかりませんでした)',
		);
		return false;
	}
	for (const ns of namespaces) {
		console.log(`  - ${ns}`);
	}

	if (ssotConflicts.length > 0) {
		console.log(
			`\n[WARNING] SSOT (terms.ts / labels.ts) に既存 namespace あり: ${ssotConflicts.length} 件`,
		);
		for (const c of ssotConflicts) {
			console.log(`  - ${c.namespace}  既存定義: ${c.file}`);
		}
		console.log(`\n  対応指針 (PO 判断):`);
		console.log(
			`    A) scope 統合: 既存 namespace を superset として採用、本 Issue を既存 Issue にマージ`,
		);
		console.log(`       (重複側を close / blocked_by で関連付け)`);
		console.log(
			`    B) 命名衝突回避: 新 namespace 名を変更 (例: LP_FAQ_TERMS → LP_FAQ_DISCLAIMER_TERMS)`,
		);
		console.log(
			`    C) 意図的な拡張: 既存 namespace に key を追加するだけなら scope 重複は誤検知。`,
		);
		console.log(`       Issue body に「既存 ${ssotConflicts[0].namespace} の key 追加のみ」と明記`);
	}

	if (issueConflicts.length > 0) {
		console.log(`\n[WARNING] open Issue に同名 namespace の言及あり: ${issueConflicts.length} 件`);
		for (const c of issueConflicts) {
			console.log(`  - ${c.namespace}  #${c.number} ${c.title}`);
		}
		console.log(`\n  対応指針 (PO 判断):`);
		console.log(
			`    既存 Issue の scope を確認し、重複起票を回避 (Issue 統合 / blocked_by 関連付け)`,
		);
	}

	if (ssotConflicts.length === 0 && issueConflicts.length === 0) {
		console.log('\n[OK] 重複は検出されませんでした。');
		return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		process.exit(0);
	}
	const body = readInput(args.input);
	const namespaces = extractNamespaces(body);
	const ssotConflicts = checkSSotDuplicates(namespaces);
	const issueConflicts = args.checkOpenIssues ? checkOpenIssues(namespaces) : [];
	const hasConflict = reportConflicts(namespaces, ssotConflicts, issueConflicts);
	if (hasConflict && args.failOnConflict) {
		console.log('\n--fail-on-conflict 指定により exit 1');
		process.exit(1);
	}
	process.exit(0);
}

// Run as CLI (not when imported as a module)
const isMain = (() => {
	try {
		return path.resolve(process.argv[1]) === __filename;
	} catch {
		return false;
	}
})();

if (isMain) {
	main();
}
