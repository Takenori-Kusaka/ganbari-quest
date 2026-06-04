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
 * --- allowlist 設計 ---
 *
 * 1. FILE_ALLOWLIST (PR-L5 担当の DB / 認可・実行モード・service 層)
 *    - license key の DB 列 / enum / table / repository は PR-L5 (env 撤去 + 列・enum 物理削除、
 *      expand-contract §3.8) で削除する。本 PR-L4 (LP/メール/ラベル) の scope 外のため allowlist。
 *    - `src/lib/server/db/**` / `license-record.types.ts` / `license-key-status.ts` /
 *      `license-plan.ts` / `license-service.ts` / `validation/auth.ts` / `auth/entities.ts` /
 *      `runtime/env.ts` (ALLOW_LEGACY_LICENSE_KEYS) / `rate-limit-service.ts` 等
 *    - `legacy-url-map.ts`: `/help/license-key` → `/admin/subscription` 301 redirect の `from` entry
 *      は永久保持 (CLAUDE.md #578) のため allowlist。
 *
 * 2. コメント行 (line が `//` / `*` / `<!--` / `#` で始まる) は履歴記述として許容。
 *    license key 撤去の経緯コメント (`#2818` 等) は全 file に分散するため、path ではなく
 *    line 単位で許容する。
 *
 * 上記いずれにも該当しない **コード行** の license key 参照 = 再導入とみなし fail。
 *
 * 使用法: node scripts/check-license-key-leak.mjs
 * CI: 検出時は exit 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
];

// ---------------------------------------------------------------------------
// FILE_ALLOWLIST — PR-L5 担当の DB / 認可・実行モード・service 層 + LEGACY_URL_MAP
//
// これらの file は license key の DB 列 / enum / repository / 永久 redirect entry を保持し、
// 物理削除は PR-L5 (env 撤去 + 列・enum DROP、expand-contract §3.8) で実施する。
// 本 PR-L4 の scope 外。path 区切りは / と \ の両方を許容する。
// ---------------------------------------------------------------------------
export const FILE_ALLOWLIST = [
	// DB 層 (PR-L5: 列・enum・table 物理削除)
	/^src[\\/]lib[\\/]server[\\/]db[\\/]/,
	/^src[\\/]lib[\\/]domain[\\/]constants[\\/]license-key-status\.ts$/,
	/^src[\\/]lib[\\/]domain[\\/]constants[\\/]license-plan\.ts$/,
	/^src[\\/]lib[\\/]domain[\\/]validation[\\/]auth\.ts$/,
	// 認可・実行モード・service 層 (PR-L5: 列読込経路 / dead service 撤去)
	/^src[\\/]lib[\\/]server[\\/]auth[\\/]entities\.ts$/,
	/^src[\\/]lib[\\/]server[\\/]services[\\/]license-service\.ts$/,
	/^src[\\/]lib[\\/]server[\\/]services[\\/]rate-limit-service\.ts$/,
	/^src[\\/]lib[\\/]runtime[\\/]env\.ts$/,
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

function main() {
	const violations = findAllViolations();
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
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
	main();
}
