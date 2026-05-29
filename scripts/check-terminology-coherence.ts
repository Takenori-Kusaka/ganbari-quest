#!/usr/bin/env node
/**
 * scripts/check-terminology-coherence.ts (#2555 / CX research §F)
 *
 * 「動くが分かりにくい」UX 破綻 (機能テストでは原理的に緑のまま見逃す層) のうち、
 * 機械検証可能な 2 種を warning gate で検出する:
 *
 *   (A) 謎用語 / 非 SSOT 用語の add 経路ラベル混入 (CX research §F-1、bug-3「パックから追加」)
 *       - 内部語彙 (「パック」等) がユーザー向け add ラベルに露出しているのを検出。
 *         SSOT 用語へ誘導する。
 *   (B) 同一リソースの add 経路重複 (CX research §F-2 / DESIGN.md §10 add 経路 ≤ 4、bug-2 分離ボタン)
 *       - 同一リソース (活動 / 報酬 / 等) の add CTA (label) を列挙し、経路数が 4 を超えたら warn。
 *         Hick's Law (経路分裂 = cognitive overload) の機械化。
 *
 * Vale POC との比較結果 (#2555):
 *   Vale は表現力に優れるが、Go バイナリ依存とローカル実行の手間 (Pre-PMF Bucket A 違反) を考慮し、
 *   既存の check-add-path-coherence.mjs を本ファイル (.ts) に拡充し、
 *   terms.ts から直接 SSOT 用語をインポートして substitution ルールを機械評価する方針 (Option B) を採用した。
 *
 * 使用法: npx tsx scripts/check-terminology-coherence.ts
 *   --fail-on-violation を渡すと検出時に exit 1 (CI hard-fail 化用)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// SSOT terms インポート
// ---------------------------------------------------------------------------
import {
	ADMIN_VIEW_TERMS,
	ADVENTURE_TERMS,
	AUTONOMY_TERMS,
	CHILD_TERMS,
	FREE_PLAN_TERMS,
	GRADUATION_TERMS,
	LOGIN_TERMS,
	TEMPLATE_TERMS,
} from '../src/lib/domain/terms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const FAIL_ON_VIOLATION = process.argv.includes('--fail-on-violation');

// ---------------------------------------------------------------------------
// (A) 謎用語 BANLIST — ユーザー向け add / import ラベルに露出してはいけない内部語彙
//
// SSOT (src/lib/domain/terms.ts) で正規用語が定義されている概念について、
// 非 SSOT な代替語 (内部語彙) が UI ラベルに混入しているのを検出する。
// ---------------------------------------------------------------------------

const MYSTERY_TERMS = [
	{
		pattern: 'パックから',
		reason: `内部語彙「パック」が露出。SSOT は ${TEMPLATE_TERMS.userFacing} / ${TEMPLATE_TERMS.short} を使う (bug-3)`,
	},
	{
		pattern: 'パックを取込',
		reason: `内部語彙「パック」が露出。SSOT は ${TEMPLATE_TERMS.userFacing} / ${TEMPLATE_TERMS.short} を使う (bug-3)`,
	},
	{
		pattern: 'ずっと無料',
		reason: `「ずっと無料」は撤去対象。SSOT は ${FREE_PLAN_TERMS.forever} 等を使用する (#1913 E-7)`,
	},
	{
		pattern: '自律',
		reason: `「自律」は子供向けトーンに合わないため ${AUTONOMY_TERMS.selfPlanning} へリフレーム (#2058 UIUX-F-16)`,
	},
	{
		pattern: '自走',
		reason: `「自走」は子供向けトーンに合わないため ${AUTONOMY_TERMS.selfMotivated} へリフレーム (#2058 UIUX-F-16)`,
	},
	{
		pattern: '親管理画面',
		reason: `「親管理画面」は旧称。SSOT は ${ADMIN_VIEW_TERMS.canonical} / ${ADMIN_VIEW_TERMS.short} を使用する (#2057)`,
	},
	{
		pattern: '子ども',
		reason: `「子ども」は表記揺れ。SSOT は ${CHILD_TERMS.honorific} / ${CHILD_TERMS.neutral} / ${CHILD_TERMS.hiragana} を使用する (#1914 TECH-F)`,
	},
	{
		pattern: 'サインイン',
		reason: `UI表示用語は ${LOGIN_TERMS.canonical} を第一選択とする (#1914)`,
	},
	{
		pattern: '最終地点',
		reason: `「最終地点」は表記揺れ。SSOT は ${GRADUATION_TERMS.canonical} を使用する (#1915 D-4)`,
	},
	{
		pattern: 'アドベンチャー',
		reason: `「アドベンチャー」は表記揺れ。SSOT は ${ADVENTURE_TERMS.canonical} を使用する (#1915 D-5)`,
	},
];

// ---------------------------------------------------------------------------
// (B) add 経路定義 — labels.ts の *Header 系 namespace で「追加」系 CTA label を列挙
//
// 同一リソース (= 同一 namespace) の add CTA label を集計し、経路数 > 4 で warn。
// DESIGN.md §10「add 経路 ≤ 4」(Hick's Law) の機械化。
// ---------------------------------------------------------------------------

const ADD_CTA_KEYWORDS = ['追加', '取込', '取り込', 'インポート', 'import'];
const MAX_ADD_PATHS = 4; // DESIGN.md §10

const LABELS_PATH = path.join(REPO_ROOT, 'src/lib/domain/labels.ts');

function isCommentLine(line: string) {
	const trimmed = line.trim();
	return (
		trimmed.startsWith('//') ||
		trimmed.startsWith('*') ||
		(trimmed.startsWith('/*') && trimmed.endsWith('*/'))
	);
}

/**
 * labels.ts のテキストをスキャンし、謎用語と add 経路を集計する。
 * テスト用に任意のテキストを渡せるようにする。
 */
export function scanLabels(text?: string) {
	const lines = (text || fs.readFileSync(LABELS_PATH, 'utf8')).split(/\r?\n/);

	const mysteryHits: {
		line: number;
		key: string;
		value: string;
		pattern: string;
		reason: string;
	}[] = [];
	const namespaceAddPaths = new Map<string, { key: string; value: string; line: number }[]>();
	let currentNamespace: string | null = null;
	let namespaceDepth = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line || isCommentLine(line)) continue;

		// namespace 開始 (`\tfoo: {` or `  foo: {`、export const 直下の 1 段ネスト)
		const nsMatch = line.match(/^\t([a-zA-Z][a-zA-Z0-9]*):\s*\{\s*$/);
		if (nsMatch && namespaceDepth === 0) {
			currentNamespace = nsMatch[1] ?? null;
			namespaceDepth = 1;
			continue;
		}
		// namespace 終了 (1 段インデントの `},`)
		if (currentNamespace && /^\t\},?\s*$/.test(line)) {
			currentNamespace = null;
			namespaceDepth = 0;
			continue;
		}

		// `key: '値'` / `key: "値"` の string literal を抽出
		const kvMatch = line.match(/^\s*([a-zA-Z][a-zA-Z0-9]*):\s*['"](.+?)['"]\s*,?\s*$/);
		if (!kvMatch) continue;
		const key = kvMatch[1];
		const value = kvMatch[2];

		if (!key || !value) continue;

		// (A) 謎用語検出 (全 namespace 対象)
		for (const { pattern, reason } of MYSTERY_TERMS) {
			if (value.includes(pattern)) {
				mysteryHits.push({ line: i + 1, key, value, pattern, reason });
			}
		}

		// (B) add 経路集計 (*Header namespace 配下の add CTA label のみ)
		if (currentNamespace?.endsWith('Header')) {
			const isAddCta = ADD_CTA_KEYWORDS.some((kw) => value.includes(kw));
			const isLabelKey =
				/Label$/.test(key) && !/Aria|Menu|Trigger|Dialog/.test(key) && key !== 'addButtonLabel';
			if (isAddCta && isLabelKey) {
				if (!namespaceAddPaths.has(currentNamespace)) {
					namespaceAddPaths.set(currentNamespace, []);
				}
				namespaceAddPaths.get(currentNamespace)?.push({ key, value, line: i + 1 });
			}
		}
	}

	return { mysteryHits, namespaceAddPaths };
}

function main() {
	console.log(
		'[check-terminology-coherence] #2555 / CX research §F — terminology & add 経路 UX coherence 検査',
	);

	if (!fs.existsSync(LABELS_PATH)) {
		console.error(`[check-terminology-coherence] labels.ts not found: ${LABELS_PATH}`);
		return 1;
	}

	const { mysteryHits, namespaceAddPaths } = scanLabels();

	let warningCount = 0;

	// (A) 謎用語
	if (mysteryHits.length > 0) {
		console.log('\n[check-terminology-coherence] (A) 謎用語 / 非 SSOT 用語の混入:');
		for (const h of mysteryHits) {
			console.log(`  labels.ts:${h.line}  ${h.key}: "${h.value}"  ← "${h.pattern}"`);
			console.log(`    理由: ${h.reason}`);
			warningCount++;
		}
	}

	// (B) add 経路重複 (> 4)
	for (const [ns, paths] of namespaceAddPaths) {
		if (paths.length > MAX_ADD_PATHS) {
			console.log(
				`\n[check-terminology-coherence] (B) ${ns}: add 経路 ${paths.length} 件 (> ${MAX_ADD_PATHS}、DESIGN.md §10 Hick's Law 違反):`,
			);
			for (const p of paths) {
				console.log(`  labels.ts:${p.line}  ${p.key}: "${p.value}"`);
			}
			console.log('    対応: menu / dropdown / command palette で集約 (DESIGN.md §10)');
			warningCount++;
		}
	}

	// 集計レポート
	console.log('\n[check-terminology-coherence] add 経路サマリ (*Header namespace):');
	for (const [ns, paths] of namespaceAddPaths) {
		const labels = paths.map((p) => `"${p.value}"`).join(', ');
		console.log(`  ${ns}: ${paths.length} 経路  [${labels}]`);
	}

	if (warningCount === 0) {
		console.log('\n[check-terminology-coherence] ✓ PASS — UX coherence 問題なし');
		return 0;
	}

	console.log(`\n[check-terminology-coherence] ⚠ ${warningCount} 件の UX coherence warning を検出`);
	console.log(
		'  これは「動くが分かりにくい」層 (謎用語 / 経路重複) の機械検出 (warning)。\n' +
			'  Cognitive Walkthrough (#2459 C-2) で人間が最終判断する。',
	);
	return FAIL_ON_VIOLATION ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const isMain = (() => {
	if (typeof process === 'undefined') return false;
	const argv1 = process.argv[1];
	if (!argv1) return false;
	try {
		return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(argv1);
	} catch {
		return false;
	}
})();

if (isMain) {
	const code = main();
	process.exit(code);
}
