#!/usr/bin/env node
/**
 * scripts/check-license-key-leak.mjs (#2836 / Epic #2525 Phase 7 PR-L4)
 *
 * license key 全廃 (Phase 1 補強 3 #2788) の再導入防止 CI ガード。
 *
 * 「ライセンスキー」/ `licenseKey` / `license-key` / `LICENSE_KEY` / `LicenseKey` の参照を
 * src/ + site/ で grep し、allowlist 外の **コード行** (= コメント以外) で 1 件でも検出したら
 * exit 1 する。LP / メール / ラベル / UI から license key 概念が再導入されることを構造的に防ぐ。
 *
 * --- PR-L5 #2879: `LICENSE_PLAN` / `LicensePlan` / `license-plan` も検出対象に追加 ---
 *
 * Tenant の課金プラン enum は実体が Stripe Subscription の plan 種別であり、license key とは
 * 無関係だが、命名上 `license` 語彙を含んでいたため `SUBSCRIPTION_PLAN` / `SubscriptionPlan` /
 * `subscription-plan.ts` へ rename した (#2879)。rename 後の src/ + site/ には `license-plan` 系
 * 識別子が完全ゼロのため、本 pattern を追加して license 語彙の再導入を構造的に防ぐ。
 *
 * --- allowlist 設計 (PR-L5 #2860 で contract 完了、DB 層 allowlist 撤去) ---
 *
 * 1. FILE_ALLOWLIST: PR-L5 (#2860) で license key の DB 列 / enum / table / repository を物理削除
 *    したため、旧 DB / 認可・実行モード・service 層の allowlist は不要になり撤去。残るのは:
 *    - `legacy-url-map.ts`: `/help/license-key` → `/admin/subscription` 301 redirect の `from` entry
 *      は永久保持 (CLAUDE.md #578) のため allowlist。
 *
 * 2. コメント行 (line が `//` / `*` / `<!--` / `#` で始まる) は履歴記述として許容。
 *    license key 撤去の経緯コメント (`#2818` / `#2860` 等) は全 file に分散するため、path ではなく
 *    line 単位で許容する。
 *
 * 上記いずれにも該当しない **コード行** の license key 参照 = 再導入とみなし fail (完全ゼロ化)。
 *
 * 使用法: node scripts/check-license-key-leak.mjs
 * CI: 検出時は exit 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain as isMainModule } from './lib/is-main.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// 走査ルート (REPO_ROOT 相対)
export const SEARCH_ROOTS = ['src', 'site'];

// 走査対象拡張子
export const EXTENSIONS = ['.ts', '.svelte', '.js', '.mjs', '.cjs', '.html', '.css'];

// 検出パターン (大文字小文字を区別する。'license' 単独 (= Stripe 'license' 等) は誤検知のため不採用)
export const PATTERNS = [
	/ライセンスキー/,
	/licenseKey/,
	/license-key/,
	/LICENSE_KEY/,
	/LicenseKey/,
	// PR-L5 #2879: SUBSCRIPTION_PLAN への rename 後、license-plan 系識別子の再導入を防ぐ
	/LICENSE_PLAN/,
	/LicensePlan/,
	/license-plan/,
];

// ---------------------------------------------------------------------------
// FILE_ALLOWLIST — LEGACY_URL_MAP のみ (PR-L5 #2860 で DB 層 allowlist 撤去、完全ゼロ化)
//
// PR-L5 (#2860) で license key の DB 列 / enum / table / repository を物理削除したため、
// 旧 DB / service 層 file の allowlist は不要になった。残るのは永久保持の redirect entry のみ。
// path 区切りは / と \ の両方を許容する。
// ---------------------------------------------------------------------------
export const FILE_ALLOWLIST = [
	// LEGACY_URL_MAP: /help/license-key → /admin/subscription 301 entry (永久保持、CLAUDE.md #578)
	/^src[\\/]lib[\\/]server[\\/]routing[\\/]legacy-url-map\.ts$/,
];

/**
 * relPath (REPO_ROOT 相対) が FILE_ALLOWLIST に一致するか。
 * @param {string} relPath
 * @returns {boolean}
 */
export function isFileAllowlisted(relPath) {
	const normalized = relPath.replace(/\\/g, '/');
	return FILE_ALLOWLIST.some((p) => p.test(relPath) || p.test(normalized));
}

/**
 * line がコメント行なら true。license key 撤去の経緯コメント (`#2818` 等) を許容する。
 * 行頭の空白を除いた先頭が `//` / `*` (block comment 継続) / `/*` / `<!--` / `#`。
 * @param {string} line
 * @returns {boolean}
 */
export function isCommentLine(line) {
	const trimmed = line.trimStart();
	return (
		trimmed.startsWith('//') ||
		trimmed.startsWith('*') ||
		trimmed.startsWith('/*') ||
		trimmed.startsWith('<!--') ||
		trimmed.startsWith('#')
	);
}

/**
 * 1 ファイル分の content から allowlist 外の license key コード行参照を検出する。
 * (file 単位ロジックの純関数。テスト容易性のため content を直接受ける)
 * @param {string} relPath REPO_ROOT 相対 path
 * @param {string} content ファイル内容
 * @returns {Array<{file: string, line: number, snippet: string}>}
 */
export function findViolationsInContent(relPath, content) {
	if (isFileAllowlisted(relPath)) return [];
	/** @type {Array<{file: string, line: number, snippet: string}>} */
	const out = [];
	const lines = content.split(/\r?\n/);
	lines.forEach((line, idx) => {
		if (!PATTERNS.some((p) => p.test(line))) return;
		if (isCommentLine(line)) return;
		out.push({
			file: relPath.replace(/\\/g, '/'),
			line: idx + 1,
			snippet: line.trim().slice(0, 120),
		});
	});
	return out;
}

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules') continue;
			walk(full, out);
		} else if (entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
			out.push(full);
		}
	}
	return out;
}

/**
 * REPO_ROOT (既定) 配下の SEARCH_ROOTS を走査し、全違反を返す。
 * @param {string} [repoRoot]
 * @returns {Array<{file: string, line: number, snippet: string}>}
 */
export function findAllViolations(repoRoot = REPO_ROOT) {
	/** @type {Array<{file: string, line: number, snippet: string}>} */
	const violations = [];
	for (const root of SEARCH_ROOTS) {
		const files = walk(path.join(repoRoot, root));
		for (const file of files) {
			const rel = path.relative(repoRoot, file);
			const content = fs.readFileSync(file, 'utf8');
			violations.push(...findViolationsInContent(rel, content));
		}
	}
	return violations;
}

/**
 * `--budget-ms <n>` の値を返す (未指定は null)。
 * @param {string[]} argv
 * @returns {number | null}
 */
export function parseBudgetMs(argv) {
	const i = argv.indexOf('--budget-ms');
	if (i === -1) return null;
	const raw = argv[i + 1];
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) {
		throw new Error(`--budget-ms には正の数値が必要です (受領: ${String(raw)})`);
	}
	return n;
}

const HELP_TEXT = `check-license-key-leak.mjs — license key 全廃 (#2836 / Epic #2525 Phase 7) の再導入防止 gate

使用法:
  node scripts/check-license-key-leak.mjs [--budget-ms <n>] [--help]

検査内容:
  ${SEARCH_ROOTS.join(' + ')} 配下の対象拡張子 (${EXTENSIONS.join(' ')}) を走査し、
  allowlist 外の **コード行** に license key 参照があれば exit 1。
  コメント行 (// / * / <!-- / #) は履歴記述として許容。

オプション:
  --budget-ms <n>  走査の所要が n ms を超えたら exit 1 (#4000)。
                   CI runner は fresh clone = 常に cold FS cache なので、この step が
                   そのまま cold 条件の実測点になる。走査対象が想定外に膨らんだ場合
                   (SEARCH_ROOTS / EXTENSIONS の誤拡張等) の機械検知に使う。
  --help           本ヘルプを表示して exit 0 (走査は行わない)。
`;

function main() {
	// #4000: `--help` は走査せず即返す。実 repo 全走査は cold FS cache で 18s 規模になるため、
	// help を見るだけ / CLI 疎通を確かめるだけの用途で走査を起動させない
	// (`cli-entry-guard.test.ts` の symlink 等価 probe も `--help` を使う)。
	if (process.argv.slice(2).includes('--help')) {
		console.log(HELP_TEXT);
		process.exit(0);
	}

	// #4000: 走査自体の所要を必ず出す。CI runner は fresh clone = 常に cold FS cache なので、
	// この数値が「cold 条件での実測」そのものになる (別途 cold 再現 job を作る必要がない)。
	// 実測 (#4000): warm ~285ms / cold ~18.8s (986 file・6.5MB、Windows Defender 下で ~19ms/file)。
	// 走査コストは harness ではなく **走査自身の初回 file open** が支配する。
	const startedAt = Date.now();
	const violations = findAllViolations();
	const elapsedMs = Date.now() - startedAt;
	console.log(`[check-license-key-leak] scan 所要: ${elapsedMs}ms`);

	// budget 超過は「走査の構造が変わった (対象が膨らんだ / I/O が増えた)」の機械検知。
	// 通常変動で鳴らないよう桁違いの余裕を持たせ、catastrophic な回帰だけを落とす。
	const budgetMs = parseBudgetMs(process.argv.slice(2));
	if (budgetMs !== null && elapsedMs > budgetMs) {
		console.error(
			`[check-license-key-leak] ✗ scan が budget を超過しました (${elapsedMs}ms > ${budgetMs}ms)\n` +
				'  走査対象 (SEARCH_ROOTS / EXTENSIONS) が想定外に膨らんでいないか確認してください。',
		);
		process.exit(1);
	}

	if (violations.length === 0) {
		console.log(
			'[check-license-key-leak] OK — allowlist 外のコード行に license key 参照なし (再導入なし)',
		);
		process.exit(0);
	}
	console.error(
		`[check-license-key-leak] ✗ allowlist 外のコード行に license key 参照を ${violations.length} 件検出しました (Epic #2525 Phase 7 license key 全廃の再導入):\n`,
	);
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}`);
		console.error(`    ${v.snippet}`);
	}
	console.error('\n修正方針:');
	console.error('  - LP / メール / ラベル / UI で license key 概念を再導入しないでください。');
	console.error('  - entitlement は Stripe Subscription (tenant.status=ACTIVE) が唯一 SSOT です。');
	console.error(
		'  - DB 列 / enum / repository / LEGACY_URL_MAP entry は PR-L5 担当の allowlist です。',
	);
	console.error(
		'    新規に DB 層へ追加する場合は scripts/check-license-key-leak.mjs の FILE_ALLOWLIST を更新してください。',
	);
	console.error('  - 履歴記述はコメント行 (//, *, <!--, #) であれば許容されます。');
	process.exit(1);
}

// CLI として直接実行された時のみ main() を走らせる (import 時は副作用なし → テスト容易)
if (isMainModule(import.meta.url)) {
	main();
}
