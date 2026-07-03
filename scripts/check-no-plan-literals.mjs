#!/usr/bin/env node
// @ts-nocheck — plain Node lint script。test (labels-plan-literal-ratchet #3359) が checkFile を import
// するため checkJs:true の svelte-check 型グラフに入るが、本 script は型付け対象外 (scripts/ 他 lint と同方針)。
/**
 * scripts/check-no-plan-literals.mjs (#972 + Phase 5 F1 #1918)
 *
 * プラン / ステータス値 + 用語 (プラン名 / 価格 / トライアル / 解約 / 無料訴求) の
 * 文字列リテラル直書きを検出する CI ガード。
 *
 * 2 種類のルールを内蔵:
 *
 * 1. VALUE_LITERAL_RULES (#972)
 *    - SubscriptionPlan / SubscriptionStatus / LicenseKeyStatus 等の値リテラル
 *    - 例: 'family-monthly' / 'grace_period'
 *    - 用途: `$lib/domain/constants/*` の定数経由で参照させる
 *
 * 2. TERM_LITERAL_RULES (#1918 Phase 5 F1)
 *    - プラン名 / 価格 / トライアル / 解約 / 無料訴求の表示テキスト atom
 *    - 例: 'スタンダードプラン' / '月 ¥500' / '7 日間無料' / 'クレジットカード登録不要'
 *    - 用途: `src/lib/domain/terms.ts` の atom (PLAN_FULL_TERMS / PRICE_TERMS / TRIAL_TERMS /
 *      CANCEL_TERMS / FREE_TERMS) を経由して参照させる (ADR-0045 SSOT 2 階層化)
 *
 * 使用法: node scripts/check-no-plan-literals.mjs
 * CI: エラー検出時は exit 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// VALUE_LITERAL_RULES (#972) — SubscriptionPlan 等の値リテラル
//
// 検出ルール (曖昧性のない = 他ドメインで流用されない値のみ)
//  - 'monthly' / 'yearly' / 'terminated' / 'consumed' / 'revoked' / 'lifetime' は
//    チャレンジ周期・sitemap changefreq・汎用ステータス等で正当に使われるため対象外
//  - kebab-case の `family-*` と snake_case の `grace_period` はライセンス文脈固有
// ---------------------------------------------------------------------------

const VALUE_LITERAL_RULES = [
	{ pattern: 'family-monthly', constant: 'SUBSCRIPTION_PLAN.FAMILY_MONTHLY', kind: 'value' },
	{ pattern: 'family-yearly', constant: 'SUBSCRIPTION_PLAN.FAMILY_YEARLY', kind: 'value' },
	{ pattern: 'grace_period', constant: 'SUBSCRIPTION_STATUS.GRACE_PERIOD', kind: 'value' },
];

// ---------------------------------------------------------------------------
// TERM_LITERAL_RULES (#1918 Phase 5 F1) — プラン名 / 価格 / トライアル / 解約 / 無料訴求の atom
//
// 設計指針:
//  - terms.ts atom を SSOT として参照させる (ADR-0045)
//  - 互換 variant (空白あり / なし) はそれぞれ別 atom として独立させる (#1944 / #1958 経緯)
//  - 短縮形「スタンダード」「ファミリー」は文脈判定が必要なため本 Phase 5 F1 では検出対象外
//    （プラン名以外の文脈 = 「スタンダードな〜」「ファミリーレストラン」を誤検知するため）。
//    フル形「スタンダードプラン」「ファミリープラン」のみを検出する。短縮形を検出する場合は
//    別 Phase で AST ベース判定 (例: identifier 直前の文字が 「<」 や 「'」 等の文脈) を要する。
// ---------------------------------------------------------------------------

const TERM_LITERAL_RULES = [
	// プラン (フル形)
	{ pattern: 'スタンダードプラン', constant: 'PLAN_FULL_TERMS.standard', kind: 'term' },
	// Phase 7 PR-2d/e (#2706): family → premium rename。新規 SSOT 値は「プレミアムプラン」。
	// alias 共存期間中も rename 後の値で検出 (直書き禁止対象は「プレミアムプラン」、
	// 旧「ファミリープラン」直書きは alias 経由参照に置換すべき検出対象として残存)。
	{ pattern: 'プレミアムプラン', constant: 'PLAN_FULL_TERMS.premium', kind: 'term' },
	{
		pattern: 'ファミリープラン',
		constant: 'PLAN_FULL_TERMS.premium (旧 .family alias)',
		kind: 'term',
	},
	{ pattern: '無料プラン', constant: 'PLAN_FULL_TERMS.free', kind: 'term' },
	// 価格
	{
		pattern: '月 ¥500',
		constant: 'PRICE_TERMS.monthlyPrefix + PRICE_TERMS.standard',
		kind: 'term',
	},
	{ pattern: '月 ¥780', constant: 'PRICE_TERMS.monthlyPrefix + PRICE_TERMS.family', kind: 'term' },
	{ pattern: '¥500/月', constant: 'PRICE_TERMS.standard + "/月"', kind: 'term' },
	{ pattern: '¥780/月', constant: 'PRICE_TERMS.family + "/月"', kind: 'term' },
	{ pattern: '¥500（税込）', constant: 'PRICE_TERMS.standard + PRICE_TERMS.taxNote', kind: 'term' },
	{ pattern: '¥780（税込）', constant: 'PRICE_TERMS.family + PRICE_TERMS.taxNote', kind: 'term' },
	// トライアル — 案内する atom 組合わせは char-by-char で元 pattern を完全再現すること
	// (再現不可能な案内は Copilot [must] 指摘 #3 で BLOCK 対象)
	{
		pattern: '7 日間無料',
		constant: 'TRIAL_TERMS.durationSpaced + FREE_TERMS.suffix',
		kind: 'term',
	},
	{
		pattern: '7日間無料',
		constant: 'TRIAL_TERMS.duration + FREE_TERMS.suffix',
		kind: 'term',
	},
	{
		pattern: '7 日間の無料',
		constant: "TRIAL_TERMS.durationSpaced + 'の' + FREE_TERMS.suffix",
		kind: 'term',
	},
	{ pattern: 'クレジットカード登録不要', constant: 'TRIAL_TERMS.noCreditCard', kind: 'term' },
	{ pattern: 'クレカ登録不要', constant: 'TRIAL_TERMS.noCreditCardShort', kind: 'term' },
	// 解約
	{ pattern: 'いつでも解約 OK', constant: 'CANCEL_TERMS.anytimeOk', kind: 'term' },
	{ pattern: 'いつでも解約', constant: 'CANCEL_TERMS.anytime', kind: 'term' },
	// 無料訴求
	{ pattern: '基本無料', constant: 'FREE_TERMS.base', kind: 'term' },
	{ pattern: 'まずは無料', constant: 'FREE_TERMS.start', kind: 'term' },
];

// ---------------------------------------------------------------------------
// CONCEPT_ICON_RULES (#2899) — システム概念アイコンの直書き検出
//
// 設計指針 (research T4 / DESIGN.md §6-§7):
//   - システム概念 (みんなのテンプレート / marketplace 取込) を指すアイコン絵文字は
//     `src/lib/domain/terms.ts` の CONCEPT_ICONS atom 経由で参照させる。
//   - **ユーザーがカスタマイズする活動・チェックリスト項目のアイコン (item.icon /
//     COMMON_ICONS picker / stamp emoji 等のデータ値) は対象外** (asset-catalog.md)。
//     そのため「概念 emoji を一律禁止」ではなく、marketplace 取込導線で概念アイコンを
//     SSOT を介さず直書きする pattern (旧 `📦 {TEMPLATE_TERMS.browse}` 等) のみを検出する。
//   - matcher は「概念 emoji + 空白 + {TEMPLATE_TERMS.* / marketplaceSeeMore / .browse}」を
//     ピンポイントで捕捉し、誤検知 (データ値の 📦 等) を出さない。
//   - 検出時の修正方針: `{CONCEPT_ICONS.template} {TEMPLATE_TERMS.browse}` の形に置換する。
//
// 対象 emoji: 📦 (旧 marketplace concept icon、🏪 へ統一) / 🏪 (template) を marketplace
//             取込導線で直書きした場合。
//
// 【守備範囲の明示 (#2899 QM Re-Review AC5 正直化)】:
//   本ルールは「全 8 概念アイコンの直書きを一律検出する全面ガードではない」。
//   template 概念 (📦/🏪) が marketplace 取込導線 (`{TEMPLATE_TERMS.* / .browse /
//   marketplaceSeeMore}` 隣接) で直書きされる **特定アンチパターンの regression guard**
//   に限定する。他 7 概念アイコン (📝 activity / 📋 checklist / 🎁 reward / 📜 rule /
//   🎯 challenge / 🤖 aiSuggest / ❓ help) を bare emoji で検出しないのは、これらが
//   ユーザーデータ値 (item.icon / COMMON_ICONS picker / stamp emoji / badge emoji /
//   tutorial chapter icon 等) として正当に多用され、raw regex では概念 vs データ値を
//   判別できず false-positive 多発が不可避なため (本 script が短縮プラン名「スタンダード」
//   を検出対象外とする L54-57 の保守的設計方針と整合)。概念アイコンの SSOT 集約自体は
//   CONCEPT_ICONS atom + コードレビューで担保し、本 lint は再発頻度の高い 1 パターンに
//   絞った機械ガードとして機能する。
// ---------------------------------------------------------------------------

const CONCEPT_ICON_RULES = [
	{
		// 旧 `📦 {TEMPLATE_TERMS.browse}` / 新 `🏪 {TEMPLATE_TERMS.browse}` 等の直書き
		matcher: /[📦🏪]\s*\{\s*(?:TEMPLATE_TERMS\.|[A-Z_]+\.(?:browse|marketplaceSeeMore))/u,
		constant: 'CONCEPT_ICONS.template',
		kind: 'concept-icon',
	},
];

// ---------------------------------------------------------------------------
// SEARCH_ROOTS / EXTENSIONS
// ---------------------------------------------------------------------------

/**
 * 検査対象ディレクトリ。Phase 5 F1 (#1918) は src/ 配下の TypeScript / Svelte が対象。
 * site/*.html は LP SSOT 注入機構 (ADR-0025) と連動し別 Phase でカバーされる。
 */
const SEARCH_ROOTS = [
	'src/lib/server',
	'src/lib/features',
	'src/lib/ui',
	'src/lib/domain',
	'src/hooks.server.ts',
	'src/routes',
];
const EXTENSIONS = ['.ts', '.svelte'];

// ---------------------------------------------------------------------------
// 検査除外パス (allowlist)
//
// AC2 (#1918): allowlist は src/lib/domain/terms.ts / src/lib/domain/labels.ts /
//              docs/ / tests/ のみ。
// AC3 (#1918): site/shared-labels.js (auto-generated) は exempt (= SEARCH_ROOTS に含めない
//              ので自動的に対象外)。
// ---------------------------------------------------------------------------

const EXCLUDE_PATTERNS = [
	// VALUE_LITERAL_RULES (#972) で既存だった除外
	/src[\\/]lib[\\/]domain[\\/]constants[\\/]/,
	/src[\\/]lib[\\/]server[\\/]services[\\/]stripe-service\.ts$/,
	/src[\\/]lib[\\/]server[\\/]db[\\/].*[\\/]schema\.ts$/,
	/src[\\/]lib[\\/]server[\\/]db[\\/]migrations[\\/]/,
	// TERM_LITERAL_RULES (#1918) の allowlist
	//   - src/lib/domain/terms.ts: atom 定義 SSOT
	//   - src/lib/domain/labels.ts: compound 組立て layer (terms.ts atom を参照)
	//   - tests/, *.test.ts, *.spec.ts: テスト fixture (期待値文字列の照合に必要)
	//   - docs/: 仕様書 (CI 対象外、Markdown は別ガード)
	/src[\\/]lib[\\/]domain[\\/]terms\.ts$/,
	/src[\\/]lib[\\/]domain[\\/]labels\.ts$/,
	/\.test\.ts$/,
	/\.spec\.ts$/,
	/\.test\.mjs$/,
];

function shouldExclude(filePath) {
	const rel = path.relative(REPO_ROOT, filePath);
	return EXCLUDE_PATTERNS.some((p) => p.test(rel));
}

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	const stat = fs.statSync(dir);
	if (stat.isFile()) {
		if (EXTENSIONS.some((ext) => dir.endsWith(ext)) && !shouldExclude(dir)) {
			out.push(dir);
		}
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
			if (!shouldExclude(full)) out.push(full);
		}
	}
	return out;
}

/**
 * VALUE_LITERAL_RULES (#972) はクオート付きリテラルのみ検出する (型安全 string union 想定)。
 */
function makeValueMatcher(pattern) {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`['"\`]${escaped}['"\`]`);
}

/**
 * TERM_LITERAL_RULES (#1918) は表示テキストのため、クオートで囲まれたリテラル + テンプレート
 * リテラル内の生テキストの両方を検出する。HTML 直書き Svelte template の `{...}` 外の生テキスト
 * (例: <p>スタンダードプラン以上です</p>) も対象。
 */
function makeTermMatcher(pattern) {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// 全角・半角区別なし、文字どこでも一致
	return new RegExp(escaped);
}

/**
 * 行がコメント行であれば true を返す (TS / Svelte 共通)。
 *  - 行頭 `//`
 *  - 行頭 `*` (JSDoc / ブロックコメント中行)
 *  - 行頭 `/*` で行末まで `*\/` で閉じ、後続コードがない場合のみ
 *    （`/* foo *\/ const bad = '...';` のような後続コード続きはコメント扱いしない —
 *      後続コード内のリテラル直書きを隠蔽させないため。Copilot R2 [must] 指摘）
 *  - 行頭 `<!--` (Svelte / HTML コメント、open のみ)
 *  - 行内が `<!-- ... -->` で完結 (シングル行 HTML コメント)
 * 行中の `// ...` 末尾コメントは検出対象外にしない (リテラル直書き隠蔽防止)。
 *
 * NOTE: HTML コメント判定は regex (`<!--.*-->`) ではなく文字列前後一致で実装する。
 *       理由: CodeQL `js/bad-tag-filter` (Bad HTML filtering regexp) のように
 *       「HTML タグを regex でフィルタする」パターンは複数行コメントを取りこぼす
 *       セキュリティリスク pattern として警告対象になる。本スクリプトは
 *       `lines = text.split(/\r?\n/)` で行単位処理しているため `line` に newline が
 *       含まれることは構造的に無いが、HTML サニタイザ regex を書かずに済む文字列
 *       前後一致で判定することで CodeQL の指摘自体を構造的に消し、将来の同種パターン
 *       展開も防ぐ。
 */
function isCommentLine(line) {
	// `//` / `*` (JSDoc 中行) / `<!--` (open) のみで判定する単純ケース
	if (/^\s*(\/\/|\*|<!--)/.test(line)) return true;
	const trimmed = line.trim();
	// シングル行 HTML コメント: `<!-- 無料プラン ... -->`（後続コードがない場合のみ）
	if (trimmed.startsWith('<!--') && trimmed.endsWith('-->') && trimmed.length >= 7) return true;
	// `/*` で始まる行: 同一行内で `*/` で閉じ、その後にコードが無い場合のみコメント扱い。
	// `/* ... */ const bad = '...';` のような後続コード続きは検出続行（Copilot R2 [must]）。
	if (trimmed.startsWith('/*')) {
		const closeIdx = trimmed.indexOf('*/');
		if (closeIdx === -1) {
			// 単一行で閉じない multi-line コメントの開始行は呼び出し元の inBlockComment
			// 追跡 (line 239 周辺) で扱うため、ここでは「コメント行として処理」を返す。
			return true;
		}
		const tail = trimmed.slice(closeIdx + 2).trim();
		if (tail.length === 0) return true;
		// tail にコードがある場合は「コメント行」とせず検出続行
		return false;
	}
	return false;
}

/**
 * 行が単なる「行末コメント」だけで構成されたリテラル違反であれば検出をスキップする。
 * 例: `	// 無料プラン or Portal 未利用時は thanks ページに遷移`
 *
 * これは「行頭が空白 + // または * + 任意」のパターンを isCommentLine() で吸収する。
 */
function checkFile(filePath) {
	const text = fs.readFileSync(filePath, 'utf8');
	const lines = text.split(/\r?\n/);
	const findings = [];

	const allRules = [
		...VALUE_LITERAL_RULES.map((r) => ({ ...r, matcher: makeValueMatcher(r.pattern) })),
		...TERM_LITERAL_RULES.map((r) => ({ ...r, matcher: makeTermMatcher(r.pattern) })),
		// CONCEPT_ICON_RULES (#2899) は matcher を直接持つ (pattern は report 用 label)
		...CONCEPT_ICON_RULES.map((r) => ({ ...r, pattern: 'concept-icon 直書き' })),
	];

	let inBlockComment = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// ブロックコメント追跡 (簡易判定、シングル行 /* ... */ は検出続行)
		if (inBlockComment) {
			if (line.includes('*/')) inBlockComment = false;
			continue;
		}
		if (/^\s*\/\*/.test(line) && !line.includes('*/')) {
			inBlockComment = true;
			continue;
		}
		if (isCommentLine(line)) continue;

		for (const rule of allRules) {
			if (rule.matcher.test(line)) {
				findings.push({
					file: path.relative(REPO_ROOT, filePath),
					line: i + 1,
					pattern: rule.pattern,
					constant: rule.constant,
					kind: rule.kind,
					snippet: line.trim().slice(0, 120),
				});
			}
		}
	}
	return findings;
}

function main() {
	const files = [];
	for (const root of SEARCH_ROOTS) {
		walk(path.join(REPO_ROOT, root), files);
	}
	const allFindings = [];
	for (const f of files) {
		allFindings.push(...checkFile(f));
	}
	if (allFindings.length === 0) {
		console.log('[check-no-plan-literals] OK — リテラル直書きなし');
		process.exit(0);
	}
	const valueFindings = allFindings.filter((f) => f.kind === 'value');
	const termFindings = allFindings.filter((f) => f.kind === 'term');
	const iconFindings = allFindings.filter((f) => f.kind === 'concept-icon');
	console.error(
		`[check-no-plan-literals] NG — ${allFindings.length} 件のリテラル直書きを検出しました ` +
			`(value: ${valueFindings.length} 件 / term: ${termFindings.length} 件 / concept-icon: ${iconFindings.length} 件):\n`,
	);
	for (const f of allFindings) {
		console.error(`  ${f.file}:${f.line}`);
		console.error(`    ${f.snippet}`);
		console.error(
			`    → ${f.constant} を使用してください (pattern: '${f.pattern}', kind: ${f.kind})\n`,
		);
	}
	console.error('修正方針:');
	console.error(
		'  - kind=value: src/lib/domain/constants/{subscription-plan,subscription-status,license-key-status,auth-license-status}.ts の定数を import',
	);
	console.error(
		'  - kind=term : src/lib/domain/terms.ts の atom (PLAN_FULL_TERMS / PRICE_TERMS / TRIAL_TERMS / CANCEL_TERMS / FREE_TERMS) を import (#1916 ADR-0045)',
	);
	console.error(
		'  - kind=concept-icon (#2899): src/lib/domain/terms.ts の CONCEPT_ICONS atom を import し、marketplace 取込導線では `{CONCEPT_ICONS.template} {TEMPLATE_TERMS.browse}` の形にする (概念アイコン直書き禁止)。ユーザーカスタマイズ item.icon / COMMON_ICONS は対象外',
	);
	console.error(
		'  - allowlist (Phase 5 F1 #1918): src/lib/domain/terms.ts / src/lib/domain/labels.ts / docs/ / tests/ / *.test.ts / *.spec.ts',
	);
	process.exit(1);
}

// テスト用 export
export { CONCEPT_ICON_RULES, checkFile, shouldExclude, TERM_LITERAL_RULES, VALUE_LITERAL_RULES };

// CLI エントリ (直接実行時のみ)
const isMain =
	import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
	process.argv[1].endsWith('check-no-plan-literals.mjs');
if (isMain) {
	main();
}
