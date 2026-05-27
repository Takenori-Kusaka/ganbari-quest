#!/usr/bin/env node
/**
 * scripts/check-add-path-coherence.mjs (#2544 / CX research §F)
 *
 * 「動くが分かりにくい」UX 破綻 (機能テストでは原理的に緑のまま見逃す層) のうち、
 * 機械検証可能な 2 種を warning gate で検出する:
 *
 *   (A) 謎用語 / 非 SSOT 用語の add 経路ラベル混入 (CX research §F-1、bug-3「パックから追加」)
 *       - 内部語彙 (「パック」等) がユーザー向け add ラベルに露出しているのを検出。
 *         SSOT 用語 (TEMPLATE_TERMS.userFacing = 「みんなのテンプレート」/ short = 「テンプレート」)
 *         へ誘導する。
 *   (B) 同一リソースの add 経路重複 (CX research §F-2 / DESIGN.md §10 add 経路 ≤ 4、bug-2 分離ボタン)
 *       - 同一リソース (活動 / 報酬 / 等) の add CTA (label) を列挙し、経路数が 4 を超えたら warn。
 *         Hick's Law (経路分裂 = cognitive overload) の機械化。
 *
 * 背景 (実害): 初顧客レビューで「一括追加」と「追加」の分離 / 「パックから追加」謎用語 /
 *   独自 UI 分岐 (bug-2/3/4) を 1 分で発見。機能テスト (#2544 E2E) は緑のまま見逃した。
 *
 * 性質: **warning gate** (exit 0 維持、検出は警告のみ)。
 *   ADR-0010 整合 (静的解析で「分かりにくさ」を完璧に判定不能、heuristic + 人間判断併用)。
 *   既存 `check-import-service-duplication.mjs` (warning gate) と同型。
 *   厳格 fail 化 / Vale 本格導入は #2459 配下 C-3 で POC 後に判断。
 *
 * 既存パターン継承: scripts/check-internal-terms.mjs (#2288) / check-no-plan-literals.mjs (#972)
 *
 * 使用法: node scripts/check-add-path-coherence.mjs
 *   --fail-on-violation を渡すと検出時に exit 1 (将来の CI hard-fail 化用、既定は warn のみ)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
		// bug-3: 「パックから追加」。marketplace 取込なのに「パック」という内部語彙を露出。
		// SSOT は TEMPLATE_TERMS.userFacing = 「みんなのテンプレート」/ short = 「テンプレート」。
		pattern: 'パックから',
		reason:
			'「パック」は内部語彙。marketplace 取込ラベルは TEMPLATE_TERMS (みんなのテンプレート / テンプレート) を使う (bug-3)',
	},
	{
		pattern: 'パックを取込',
		reason:
			'「パック」は内部語彙。TEMPLATE_TERMS (みんなのテンプレート / テンプレート) を使う (bug-3)',
	},
];

// ---------------------------------------------------------------------------
// (B) add 経路定義 — labels.ts の *Header 系 namespace で「追加」系 CTA label を列挙
//
// 同一リソース (= 同一 namespace) の add CTA label を集計し、経路数 > 4 で warn。
// DESIGN.md §10「add 経路 ≤ 4」(Hick's Law) の機械化。
// ---------------------------------------------------------------------------

// 「追加」「取込」「インポート」「作成」等を含むラベルを add 経路 CTA とみなす
const ADD_CTA_KEYWORDS = ['追加', '取込', '取り込', 'インポート', 'import'];
const MAX_ADD_PATHS = 4; // DESIGN.md §10

const LABELS_PATH = path.join(REPO_ROOT, 'src/lib/domain/labels.ts');

function isCommentLine(line) {
	const trimmed = line.trim();
	return (
		trimmed.startsWith('//') ||
		trimmed.startsWith('*') ||
		(trimmed.startsWith('/*') && trimmed.endsWith('*/'))
	);
}

/**
 * labels.ts を行スキャンし、`<key>: '<value>',` 形式の string literal を抽出する。
 * namespace (トップレベル `<name>: {` で開く const) ごとに add CTA を集計する。
 */
function scanLabels() {
	const text = fs.readFileSync(LABELS_PATH, 'utf8');
	const lines = text.split(/\r?\n/);

	const mysteryHits = []; // { line, key, value, reason }
	// namespace 検出は単純化: `<name>: {` (インデント 1 段) を namespace 開始とみなす
	const namespaceAddPaths = new Map(); // namespace -> [{ key, value, line }]
	let currentNamespace = null;
	let namespaceDepth = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (isCommentLine(line)) continue;

		// namespace 開始 (`\tfoo: {` or `  foo: {`、export const 直下の 1 段ネスト)
		const nsMatch = line.match(/^\t([a-zA-Z][a-zA-Z0-9]*):\s*\{\s*$/);
		if (nsMatch && namespaceDepth === 0) {
			currentNamespace = nsMatch[1];
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
		const [, key, value] = kvMatch;

		// (A) 謎用語検出 (全 namespace 対象)
		for (const { pattern, reason } of MYSTERY_TERMS) {
			if (value.includes(pattern)) {
				mysteryHits.push({ line: i + 1, key, value, pattern, reason });
			}
		}

		// (B) add 経路集計 (*Header namespace 配下の add CTA label のみ)
		if (currentNamespace?.endsWith('Header')) {
			const isAddCta = ADD_CTA_KEYWORDS.some((kw) => value.includes(kw));
			// add 経路の「ラベル」のみ (AriaLabel / Title / Icon / Btn 説明等は除外して経路を数えすぎない)。
			// addButtonLabel は menu trigger (「+ 追加」) で実体経路ではないため除外。
			const isLabelKey =
				/Label$/.test(key) && !/Aria|Menu|Trigger|Dialog/.test(key) && key !== 'addButtonLabel';
			if (isAddCta && isLabelKey) {
				if (!namespaceAddPaths.has(currentNamespace)) {
					namespaceAddPaths.set(currentNamespace, []);
				}
				namespaceAddPaths.get(currentNamespace).push({ key, value, line: i + 1 });
			}
		}
	}

	return { mysteryHits, namespaceAddPaths };
}

function main() {
	console.log('[check-add-path-coherence] #2544 / CX research §F — add 経路 UX coherence 検査');

	if (!fs.existsSync(LABELS_PATH)) {
		console.error(`[check-add-path-coherence] labels.ts not found: ${LABELS_PATH}`);
		return 1;
	}

	const { mysteryHits, namespaceAddPaths } = scanLabels();

	let warningCount = 0;

	// (A) 謎用語
	if (mysteryHits.length > 0) {
		console.log('\n[check-add-path-coherence] (A) 謎用語 / 非 SSOT 用語の add ラベル混入:');
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
				`\n[check-add-path-coherence] (B) ${ns}: add 経路 ${paths.length} 件 (> ${MAX_ADD_PATHS}、DESIGN.md §10 Hick's Law 違反):`,
			);
			for (const p of paths) {
				console.log(`  labels.ts:${p.line}  ${p.key}: "${p.value}"`);
			}
			console.log('    対応: menu / dropdown / command palette で集約 (DESIGN.md §10)');
			warningCount++;
		}
	}

	// 集計レポート (経路数 ≤ 4 の namespace も参考表示)
	console.log('\n[check-add-path-coherence] add 経路サマリ (*Header namespace):');
	for (const [ns, paths] of namespaceAddPaths) {
		const labels = paths.map((p) => `"${p.value}"`).join(', ');
		console.log(`  ${ns}: ${paths.length} 経路  [${labels}]`);
	}

	if (warningCount === 0) {
		console.log('\n[check-add-path-coherence] ✓ PASS — add 経路 UX coherence 問題なし');
		return 0;
	}

	console.log(`\n[check-add-path-coherence] ⚠ ${warningCount} 件の UX coherence warning を検出`);
	console.log(
		'  これは「動くが分かりにくい」層 (謎用語 / 経路重複) の機械検出 (warning)。\n' +
			'  顧客レビュー前に Cognitive Walkthrough (#2459 C-2) で人間が最終判断する。',
	);
	return FAIL_ON_VIOLATION ? 1 : 0;
}

const code = main();
process.exit(code);
