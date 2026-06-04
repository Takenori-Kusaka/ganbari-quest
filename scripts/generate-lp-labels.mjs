#!/usr/bin/env node
/**
 * scripts/generate-lp-labels.mjs (#565)
 *
 * src/lib/domain/labels.ts + age-tier.ts から LP 用ラベル辞書を生成する。
 * site/shared-labels.js を上書き更新する。
 *
 * 用途:
 *   - アプリ側 labels.ts を変更したら、本スクリプトで LP 側ラベルを同期させる
 *   - GitHub Actions の LP デプロイパイプラインに組み込み、CIで不整合を検出
 *
 * 使用法:
 *   node scripts/generate-lp-labels.mjs [--check]
 *
 *   --check: 差分があれば exit 1（CI 用）
 *
 * 注: LP は静的 HTML として GitHub Pages から配信されるため、Lambda には一切影響しない。
 * 本スクリプトは純粋なビルドタイムツールであり、Lambda バンドルサイズへの影響なし。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const LABELS_TS = path.join(REPO_ROOT, 'src/lib/domain/labels.ts');
const TERMS_TS = path.join(REPO_ROOT, 'src/lib/domain/terms.ts');
const AGE_TIER_TS = path.join(REPO_ROOT, 'src/lib/domain/validation/age-tier.ts');
const OUTPUT_JS = path.join(REPO_ROOT, 'site/shared-labels.js');

const args = process.argv.slice(2);
const CHECK_MODE = args.includes('--check');

/**
 * labels.ts の単純な `key: 'value'` ブロックを行単位でパース
 *
 * @param {string} src
 * @param {string} constName
 * @returns {Record<string, string>}
 */
function parseSimpleBlock(src, constName) {
	const pattern = new RegExp(`export const ${constName}[^{]*{([^}]+)}`, 's');
	const match = src.match(pattern);
	if (!match || match[1] === undefined) throw new Error(`${constName} not found in labels.ts`);
	/** @type {Record<string, string>} */
	const result = {};
	for (const line of match[1].split('\n')) {
		const m = line.match(/(\w+):\s*'([^']+)'/);
		if (m && m[1] !== undefined && m[2] !== undefined) result[m[1]] = m[2];
	}
	return result;
}

/**
 * 文字列内の指定位置から始まるブロック `{ ... }` の本文（中括弧を除く）を返す。
 * ブロックが見つからない場合は null。
 *
 * @param {string} src
 * @param {number} startIdx
 * @returns {string | null}
 */
function extractBraceBlock(src, startIdx) {
	const blockStart = src.indexOf('{', startIdx);
	if (blockStart === -1) return null;
	let depth = 0;
	let i = blockStart;
	while (i < src.length) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}') {
			depth--;
			if (depth === 0) break;
		}
		i++;
	}
	return src.slice(blockStart + 1, i);
}

/**
 * labels.ts のブロックを行単位でパース
 * Biome が key: / 'value' と 2 行に分割する場合にも対応
 *
 * #1772: 定数が存在しない場合は空オブジェクト `{}` を返す（throw しない）。
 * これにより、後続 PR で空の LP_*_LABELS export を完全削除しても generate-lp-labels.mjs
 * が壊れなくなる。`shared-labels.js` には対応 namespace が空オブジェクトとして残るため
 * site/*.html 側の `data-lp-key` 参照は no-op となり、SEO フォールバックテキストが
 * そのまま残る。
 *
 * #1917: template literal 値を含む可能性があるため、戻り値は文字列または
 * TemplateLiteralValue (`{ __template: true, raw: string }`) のレコードとなる。
 * 解決 (interpolation) は resolveTemplateLiterals() で別途行う。
 *
 * @param {string} src
 * @param {string} constName
 * @returns {Record<string, string | TemplateLiteralValue>}
 */
function parseBlock(src, constName) {
	const startIdx = src.indexOf(`export const ${constName}`);
	if (startIdx === -1) {
		// 定数が見つからない場合は空オブジェクトを返す（#1772 完全削除対応）
		return {};
	}

	const block = extractBraceBlock(src, startIdx);
	if (block === null) return {};

	/** @type {Record<string, string | TemplateLiteralValue>} */
	const result = {};
	/** @type {string | null} */
	let pendingKey = null;

	for (const line of block.split('\n')) {
		pendingKey = parseBlockLine(line.trim(), result, pendingKey);
	}

	return result;
}

/**
 * Template literal 値を表す内部マーカー (#1917)。
 * raw に元の `...` 内側 (バッククォート除く) を保持し、後段の resolveTemplateLiterals で
 * `${NS.key}` 参照を解決する。同名マーカーで判別する。
 *
 * @typedef {{ __template: true; raw: string }} TemplateLiteralValue
 */

/**
 * @param {unknown} v
 * @returns {v is TemplateLiteralValue}
 */
function isTemplateLiteral(v) {
	return (
		typeof v === 'object' &&
		v !== null &&
		/** @type {TemplateLiteralValue} */ (v).__template === true
	);
}

/**
 * parseBlock の 1 行分の処理。result を変異させ、後続行で値を待つキーを返す。
 *
 * #1917: 以下 3 形式に対応:
 *   1. `key: 'simple string',`         (single quote)
 *   2. `key: \`Hello ${NS.foo}\`,`     (template literal、interpolation 1+)
 *   3. `key:` + 次行 `'value',` または `\`value\`,` (Biome multi-line)
 *
 * Template literal 値は `{ __template: true, raw: '...' }` で保持し、
 * resolveTemplateLiterals() で interpolation を解決する。
 *
 * @param {string} trimmed
 * @param {Record<string, string | TemplateLiteralValue>} result
 * @param {string | null} pendingKey
 * @returns {string | null}
 */
function parseBlockLine(trimmed, result, pendingKey) {
	// key: 'value', — single quote, same line
	const sameLineSingle = trimmed.match(/^(\w+):\s*'((?:[^'\\]|\\.)*)',?$/);
	if (sameLineSingle && sameLineSingle[1] !== undefined && sameLineSingle[2] !== undefined) {
		result[sameLineSingle[1]] = sameLineSingle[2];
		return null;
	}

	// key: `...${X.foo}...`, — template literal, same line (#1917)
	// バッククォートは `[^`\\]` で表現し、エスケープシーケンスをサポート
	const sameLineTemplate = trimmed.match(/^(\w+):\s*`((?:[^`\\]|\\.)*)`,?$/);
	if (sameLineTemplate && sameLineTemplate[1] !== undefined && sameLineTemplate[2] !== undefined) {
		result[sameLineTemplate[1]] = { __template: true, raw: sameLineTemplate[2] };
		return null;
	}

	// key: — key only, value on next line (Biome multi-line format)
	const keyOnly = trimmed.match(/^(\w+):$/);
	if (keyOnly && keyOnly[1] !== undefined) {
		return keyOnly[1];
	}

	// continuation of pending key
	if (pendingKey) {
		// 'value', — single quote
		const valueOnlySingle = trimmed.match(/^'((?:[^'\\]|\\.)*)',?$/);
		if (valueOnlySingle && valueOnlySingle[1] !== undefined) {
			result[pendingKey] = valueOnlySingle[1];
			return null;
		}
		// `value`, — template literal (#1917)
		const valueOnlyTemplate = trimmed.match(/^`((?:[^`\\]|\\.)*)`,?$/);
		if (valueOnlyTemplate && valueOnlyTemplate[1] !== undefined) {
			result[pendingKey] = { __template: true, raw: valueOnlyTemplate[1] };
			return null;
		}
	}

	return pendingKey;
}

/**
 * Template literal の `${NS.key}` または `${NS["key"]}` / `${NS['key']}` 参照を
 * 解決済み文字列に置換する (#1917)。
 *
 * 解決の流れ:
 *   1. `${...}` 部分を抽出し `NS.key` 形式と照合
 *   2. namespaces[NS] の対応 key を引き、文字列なら埋め込み、再度 template ならネスト解決
 *   3. ネスト最大深度 (DEFAULT 8) を超えた場合は循環参照とみなして throw
 *   4. namespace / key が不在なら "Unresolved ${NS}.${key} in ${owner}" で throw
 *
 * @param {string} raw - template literal 内側 (バッククォート除く)
 * @param {Record<string, Record<string, string | TemplateLiteralValue>>} namespaces - NS 名 → key/value マップ
 * @param {string} ownerLabel - エラーメッセージ用 (例: "LP_HERO_PRICE_BAND_LABELS.itemFree")
 * @param {number} [depth=0] - 再帰深度
 * @returns {string}
 */
function resolveTemplateLiteralValue(raw, namespaces, ownerLabel, depth = 0) {
	const MAX_DEPTH = 8;
	if (depth > MAX_DEPTH) {
		throw new Error(
			`Template literal resolution exceeded max depth (${MAX_DEPTH}) at ${ownerLabel}. ` +
				'Possible circular reference.',
		);
	}
	// `${ ... }` を非貪欲マッチ。エスケープ ($ → \$) は対象外 (labels.ts では使わない想定)。
	return raw.replace(/\$\{([^}]+)\}/g, (_match, expr) => {
		const trimmed = expr.trim();
		// "NS.key" / "NS['key']" / 'NS["key"]' の 3 形式に対応
		const dotMatch = trimmed.match(/^(\w+)\.(\w+)$/);
		const bracketMatch = trimmed.match(/^(\w+)\[\s*['"]([^'"]+)['"]\s*\]$/);
		const ns = dotMatch ? dotMatch[1] : bracketMatch ? bracketMatch[1] : null;
		const key = dotMatch ? dotMatch[2] : bracketMatch ? bracketMatch[2] : null;
		if (!ns || !key) {
			throw new Error(
				`Unsupported template literal expression "${trimmed}" in ${ownerLabel}. ` +
					// biome-ignore lint/suspicious/noTemplateCurlyInString: 意図的に literal "${NS.key}" を含むメッセージ
					'Only ${NS.key} / ${NS["key"]} / ${NS[\'key\']} are supported.',
			);
		}
		const nsRecord = namespaces[ns];
		if (!nsRecord) {
			throw new Error(`Unresolved ${ns}.${key} in ${ownerLabel}: namespace ${ns} not found.`);
		}
		const value = nsRecord[key];
		if (value === undefined) {
			throw new Error(`Unresolved ${ns}.${key} in ${ownerLabel}: key ${key} not in ${ns}.`);
		}
		if (isTemplateLiteral(value)) {
			// ネスト解決
			return resolveTemplateLiteralValue(value.raw, namespaces, `${ns}.${key}`, depth + 1);
		}
		return value;
	});
}

/**
 * すべての namespace を template literal 解決済み文字列レコードに変換する (#1917)。
 * 解決失敗時は throw する (caller 側で詳細エラーが伝播)。
 *
 * 動作:
 *   - 文字列値はそのまま
 *   - TemplateLiteralValue は resolveTemplateLiteralValue で文字列化
 *
 * @param {Record<string, Record<string, string | TemplateLiteralValue>>} namespaces
 * @returns {Record<string, Record<string, string>>}
 */
function resolveAllTemplates(namespaces) {
	/** @type {Record<string, Record<string, string>>} */
	const resolved = {};
	for (const [nsName, nsRecord] of Object.entries(namespaces)) {
		/** @type {Record<string, string>} */
		const resolvedNs = {};
		for (const [key, value] of Object.entries(nsRecord)) {
			if (typeof value === 'string') {
				resolvedNs[key] = value;
			} else if (isTemplateLiteral(value)) {
				resolvedNs[key] = resolveTemplateLiteralValue(value.raw, namespaces, `${nsName}.${key}`);
			}
		}
		resolved[nsName] = resolvedNs;
	}
	return resolved;
}

/**
 * terms.ts (将来導入予定) から atom 定数を抽出する。
 * ファイルが存在しない場合は空オブジェクトを返す (本 PR 単独では terms.ts 未導入のため)。
 *
 * #1917: template literal 解決のための atom 参照元。
 * 探索対象: ファイル内の全 `export const X_TERMS = { ... }` ブロック。
 *
 * @returns {Record<string, Record<string, string | TemplateLiteralValue>>}
 */
function parseTermsTs() {
	if (!fs.existsSync(TERMS_TS)) {
		return {};
	}
	const src = fs.readFileSync(TERMS_TS, 'utf-8');
	/** @type {Record<string, Record<string, string | TemplateLiteralValue>>} */
	const result = {};
	// `export const FOO_TERMS = {` パターンを全て抽出
	// 名前: 大文字スネークケースの定数名のみ対象 (atom 専用慣習)
	const constPattern = /export const (\w+)\s*[:=]/g;
	const seen = new Set();
	const matches = src.matchAll(constPattern);
	for (const m of matches) {
		const name = m[1];
		if (!name || seen.has(name)) continue;
		seen.add(name);
		const block = parseBlock(src, name);
		if (Object.keys(block).length > 0) {
			result[name] = block;
		}
	}
	return result;
}

/**
 * LP 用 namespace 名 ↔ 戻り値 key の対応表。
 *
 * #1917 のリファクタで parseLabelsTs() の cognitive complexity を 27 → 安全圏に下げるため、
 * 多数の parseBlock 呼び出しと namespaces map / return マッピングを data table に外出しした。
 * 過去 PR 由来のコメント（どの Issue で追加したか）はキー単位で保持。
 *
 * @type {Array<{constName: string, returnKey: string, note?: string}>}
 */
const LP_NAMESPACE_TABLE = [
	{ constName: 'LP_RETENTION_LABELS', returnKey: 'lpRetentionLabels' },
	{ constName: 'LP_CORELOOP_LABELS', returnKey: 'lpCoreloopLabels' },
	// #1465 Phase C: LP 共通ナビ・フッター・CTA
	{ constName: 'LP_NAV_LABELS', returnKey: 'lpNavLabels', note: '#1465 Phase C' },
	{ constName: 'LP_FOOTER_LABELS', returnKey: 'lpFooterLabels', note: '#1465 Phase C' },
	{ constName: 'LP_COMMON_LABELS', returnKey: 'lpCommonLabels', note: '#1465 Phase C' },
	// Phase 2 R5/R6 (#1609/#1610): 法務系打消し表示
	{ constName: 'LP_LEGAL_DISCLAIMER_LABELS', returnKey: 'lpLegalDisclaimerLabels' },
	// Phase 4 R9/R10 (#1613/#1614): 年齢別成長ロードマップ + アナログ vs デジタル
	{ constName: 'LP_VERSUS_LABELS', returnKey: 'lpVersusLabels' },
	{ constName: 'LP_GROWTH_ROADMAP_LABELS', returnKey: 'lpGrowthRoadmapLabels' },
	// 注: #1784 Hero 直後 StoryBrand Guide ブロック (LP_GUIDE_LABELS) は #1843 で完全 revert
	// Phase 5 R44 (#1650): pricing.html SSOT 同期
	{ constName: 'LP_PRICING_LABELS', returnKey: 'lpPricingLabels' },
	// 注: ADR-0028 (#1713 R7) で LP の founder 直接相談 namespace は #1772 で完全撤去済
	// 注: LP_LICENSEKEY_LABELS (旧 site/help/license-key.html 用) は Epic #2525 Phase 7 PR-L4 (#2836)
	//     license key 全廃 + help ページ完全削除に伴い撤去済 (lpLicenseKeyLabels namespace 消滅)。
	{ constName: 'LP_FAQ_LABELS', returnKey: 'lpFaqLabels' },
	{ constName: 'LP_SELFHOST_LABELS', returnKey: 'lpSelfhostLabels' },
	{ constName: 'LP_INDEX_EXTRA_LABELS', returnKey: 'lpIndexExtraLabels' },
	// #1732: floating-cta 深度別文言
	{ constName: 'LP_FLOATING_CTA_LABELS', returnKey: 'lpFloatingCtaLabels' },
	{ constName: 'LP_PAMPHLET_LABELS', returnKey: 'lpPamphletLabels' },
	{ constName: 'LP_PRICING_EXTRA_LABELS', returnKey: 'lpPricingExtraLabels' },
	// #1702: site/{index,pricing,faq,pamphlet}.html 339 件 SSOT 化用 phase B namespace
	{ constName: 'LP_INDEX_PHASEB_LABELS', returnKey: 'lpIndexPhaseBLabels' },
	{ constName: 'LP_PRICING_PHASEB_LABELS', returnKey: 'lpPricingPhaseBLabels' },
	{ constName: 'LP_FAQ_PHASEB_LABELS', returnKey: 'lpFaqPhaseBLabels' },
	{ constName: 'LP_PAMPHLET_PHASEB_LABELS', returnKey: 'lpPamphletPhaseBLabels' },
	// #1703 #1683-C: 法的文書 SSOT 化（ADR-0009 supersede / ADR-0025）
	{ constName: 'LP_LEGAL_PRIVACY_LABELS', returnKey: 'lpLegalPrivacyLabels' },
	{ constName: 'LP_LEGAL_TERMS_LABELS', returnKey: 'lpLegalTermsLabels' },
	{ constName: 'LP_LEGAL_SLA_LABELS', returnKey: 'lpLegalSlaLabels' },
	{ constName: 'LP_LEGAL_TOKUSHOHO_LABELS', returnKey: 'lpLegalTokushohoLabels' },
];

/**
 * labels.ts の全 namespace を template literal 解決済みで取得する内部実装。
 *
 * #1917: 以下の 3 段階で動作する。
 *   Phase 1: 全 namespace を raw (template literal は marker で保持) でパース
 *   Phase 2: terms.ts を読み込み、namespaces map に統合
 *   Phase 3: resolveAllTemplates で interpolation を解決
 * 解決失敗時は throw + 詳細表示 (Unresolved ${ns}.${key} in ${owner})
 *
 * @returns {Record<string, Record<string, string>>} namespace 名 → key/value マップ (全て解決済み)
 */
function parseAllNamespacesResolved() {
	const src = fs.readFileSync(LABELS_TS, 'utf-8');

	// AGE は year-based name で固定 + 既存 simple block 保持 (#1772)
	const ageTierLabels = parseSimpleBlock(src, 'AGE_TIER_LABELS');
	const ageTierShort = parseSimpleBlock(src, 'AGE_TIER_SHORT_LABELS');
	// #1916: PLAN_LABELS は terms.ts (PLAN_FULL_TERMS) を template literal 参照する compound に
	// なったため、parseSimpleBlock (single quote 専用) では空になる。parseBlock 経由で
	// raw を取得し resolveAllTemplates で解決する。
	const planLabels = parseBlock(src, 'PLAN_LABELS');

	// #1917: LP 系 namespace は data table 駆動で一括 parse + namespaces map 構築
	/** @type {Record<string, Record<string, string | TemplateLiteralValue>>} */
	const lpRaw = {};
	for (const { constName } of LP_NAMESPACE_TABLE) {
		lpRaw[constName] = parseBlock(src, constName);
	}

	// #1917: terms.ts (atom) を取り込み、template literal を解決
	// 解決失敗時は throw され、CLI / --check が exit 1 で停止する。
	const termsNamespaces = parseTermsTs();
	/** @type {Record<string, Record<string, string | TemplateLiteralValue>>} */
	const allNamespaces = {
		...termsNamespaces,
		AGE_TIER_LABELS: ageTierLabels,
		AGE_TIER_SHORT_LABELS: ageTierShort,
		PLAN_LABELS: planLabels,
		...lpRaw,
	};
	return resolveAllTemplates(allNamespaces);
}

/**
 * labels.ts から定数を抽出し、generateSharedLabelsJs で使う形に整える。
 * 既存呼出元への破壊的変更を避けるため戻り値 key は従来どおり (ageTierLabels / lp* 形式)。
 *
 * @returns {{
 *   ageTierLabels: Record<string, string>;
 *   ageTierShort: Record<string, string>;
 *   planLabels: Record<string, string>;
 *   [lpKey: string]: Record<string, string>;
 * }}
 */
function parseLabelsTs() {
	const resolved = parseAllNamespacesResolved();

	// data table を経由して resolved → 戻り値 key へマッピング
	// 全 namespace は resolveAllTemplates で必ず entry を持つが、TS 型上 optional なので `?? {}` で defensive fallback。
	/** @type {Record<string, Record<string, string>>} */
	const lpResolved = {};
	for (const { constName, returnKey } of LP_NAMESPACE_TABLE) {
		lpResolved[returnKey] = resolved[constName] ?? {};
	}

	return {
		ageTierLabels: resolved.AGE_TIER_LABELS ?? {},
		ageTierShort: resolved.AGE_TIER_SHORT_LABELS ?? {},
		planLabels: resolved.PLAN_LABELS ?? {},
		...lpResolved,
	};
}

/**
 * age-tier.ts から AGE_TIER_CONFIG（ageMin, ageMax）を抽出
 *
 * @returns {Record<string, { ageMin: number; ageMax: number }>}
 */
function parseAgeTierTs() {
	const src = fs.readFileSync(AGE_TIER_TS, 'utf-8');

	// AGE_TIER_CONFIG ブロック抽出（ネストが多いので手動で対応）
	const startIdx = src.indexOf('AGE_TIER_CONFIG');
	if (startIdx === -1) throw new Error('AGE_TIER_CONFIG not found in age-tier.ts');
	const configSrc = src.slice(startIdx);

	/** @type {Record<string, { ageMin: number; ageMax: number }>} */
	const config = {};
	const modes = ['baby', 'preschool', 'elementary', 'junior', 'senior'];
	for (const mode of modes) {
		// 例: baby: { label: ..., ageMin: 0, ageMax: 2, ... }
		const modePattern = new RegExp(
			`${mode}:\\s*{[^}]*ageMin:\\s*(\\d+)[^}]*ageMax:\\s*(\\d+)`,
			's',
		);
		const m = configSrc.match(modePattern);
		if (!m) throw new Error(`AGE_TIER_CONFIG.${mode} not parseable`);
		config[mode] = { ageMin: Number(m[1]), ageMax: Number(m[2]) };
	}

	return config;
}

/**
 * LP 用 shared-labels.js コンテンツを生成する
 */
function generateSharedLabelsJs() {
	const {
		ageTierLabels,
		planLabels,
		lpRetentionLabels,
		lpCoreloopLabels,
		lpNavLabels,
		lpFooterLabels,
		lpCommonLabels,
		lpLegalDisclaimerLabels,
		lpVersusLabels,
		lpGrowthRoadmapLabels,
		lpPricingLabels,
		lpLicenseKeyLabels,
		lpFaqLabels,
		lpSelfhostLabels,
		lpIndexExtraLabels,
		lpFloatingCtaLabels,
		lpPamphletLabels,
		lpPricingExtraLabels,
		lpIndexPhaseBLabels,
		lpPricingPhaseBLabels,
		lpFaqPhaseBLabels,
		lpPamphletPhaseBLabels,
		lpLegalPrivacyLabels,
		lpLegalTermsLabels,
		lpLegalSlaLabels,
		lpLegalTokushohoLabels,
	} = parseLabelsTs();
	const ageTierConfig = parseAgeTierTs();

	// 各年齢区分の name / range / formal / ageMin / ageMax を統合
	// #1304: AGE_TIER_LABELS.baby が「準備モード（0〜2歳）」に更新済みのため LP_FORMAL_OVERRIDES 不要
	/** @type {Record<string, { name: string; range: string; formal: string; ageMin: number; ageMax: number }>} */
	const ageTiers = {};
	for (const mode of ['baby', 'preschool', 'elementary', 'junior', 'senior']) {
		const formal = ageTierLabels[mode];
		const config = ageTierConfig[mode];
		if (formal === undefined || config === undefined) {
			throw new Error(`age tier mode '${mode}' missing in labels.ts or age-tier.ts`);
		}
		// name は formal の括弧より前の部分 + 'モード'（既に 'モード' で終わる場合は付けない）
		const baseName = formal.split('（')[0] ?? '';
		const name = baseName.endsWith('モード') ? baseName : `${baseName}モード`;
		// range は formal の括弧内の年齢範囲（AGE_TIER_SHORT_LABELS が年齢範囲でない場合に備えて formal から取得）
		const range = formal.includes('（')
			? (formal.split('（')[1] ?? '').replace('）', '')
			: `${config.ageMin}〜${config.ageMax}歳`;
		ageTiers[mode] = {
			name,
			range,
			formal,
			ageMin: config.ageMin,
			ageMax: config.ageMax,
		};
	}

	// LP コンテンツ辞書をネストした構造に組み立て
	const lpLabels = {
		retention: lpRetentionLabels,
		coreloop: lpCoreloopLabels,
		nav: lpNavLabels,
		footer: lpFooterLabels,
		common: lpCommonLabels,
		legalDisclaimer: lpLegalDisclaimerLabels,
		versus: lpVersusLabels,
		growthRoadmap: lpGrowthRoadmapLabels,
		// 注: #1784 guide: lpGuideLabels は #1843 で完全 revert（PO-N-1 指摘で Hero → versus 直行へ復帰）
		pricing: lpPricingLabels,
		// 注: ADR-0028 (#1713 R7) で LP の founder 直接相談セクション削除 → #1772 で namespace 完全撤去
		licenseKey: lpLicenseKeyLabels,
		faq: lpFaqLabels,
		selfhost: lpSelfhostLabels,
		indexExtra: lpIndexExtraLabels,
		// #1732: floating-cta 深度別文言（site/index.html の floating-cta スクリプトが参照）
		floatingCta: lpFloatingCtaLabels,
		pamphlet: lpPamphletLabels,
		pricingExtra: lpPricingExtraLabels,
		// #1702: site/{index,pricing,faq,pamphlet}.html 339 件 SSOT 化用 phase B namespace
		indexB: lpIndexPhaseBLabels,
		pricingB: lpPricingPhaseBLabels,
		faqB: lpFaqPhaseBLabels,
		pamphletB: lpPamphletPhaseBLabels,
		// #1703 #1683-C: 法的文書 SSOT 化
		legalPrivacy: lpLegalPrivacyLabels,
		legalTerms: lpLegalTermsLabels,
		legalSla: lpLegalSlaLabels,
		legalTokushoho: lpLegalTokushohoLabels,
		lpLicenseKeyLabels,
		lpFaqLabels,
		lpSelfhostLabels,
	};

	const header = `/**
 * LP共通用語辞書 (#561, #565, #1344)
 *
 * ⚠️ このファイルは自動生成されます。直接編集しないでください。
 * 生成元: src/lib/domain/labels.ts + src/lib/domain/validation/age-tier.ts
 * 生成コマンド: node scripts/generate-lp-labels.mjs
 *
 * 用法:
 * <script src="shared-labels.js"></script>
 * <div data-age-tier="elementary" data-label="age-tier-name">小学生モード</div>
 * <h2 data-lp-key="retention.sectionTitle">三日坊主にならない設計</h2>
 *
 * data-label の値:
 *   - "age-tier-name"  : モード名（乳幼児モード/幼児モード/小学生モード/中学生モード/高校生モード）
 *   - "age-tier-range" : 年齢範囲（0〜2歳 等）
 *   - "age-tier-formal": 正式名（乳幼児（0〜2歳） 等）
 *
 * data-lp-key の値: "セクション名.キー名" 形式 (LP_LABELS を参照)
 */
(function () {
	'use strict';

	const AGE_TIERS = ${JSON.stringify(ageTiers, null, '\t').replace(/\n/g, '\n\t')};

	const PLAN_LABELS = ${JSON.stringify(planLabels, null, '\t').replace(/\n/g, '\n\t')};

	const LP_LABELS = ${JSON.stringify(lpLabels, null, '\t').replace(/\n/g, '\n\t')};

	// グローバルへエクスポート
	window.GANBARI_LABELS = {
		ageTiers: AGE_TIERS,
		plans: PLAN_LABELS,
		lp: LP_LABELS,
	};

	/**
	 * data-age-tier + data-label 属性を持つ要素を辞書値で上書きする
	 */
	function applyAgeTierLabels() {
		const elements = document.querySelectorAll('[data-age-tier][data-label]');
		elements.forEach((el) => {
			const tier = el.getAttribute('data-age-tier');
			const labelType = el.getAttribute('data-label');
			const tierData = AGE_TIERS[tier];
			if (!tierData) return;

			let value;
			switch (labelType) {
				case 'age-tier-name':
					value = tierData.name;
					break;
				case 'age-tier-range':
					value = tierData.range;
					break;
				case 'age-tier-formal':
					value = tierData.formal;
					break;
				default:
					return;
			}
			el.textContent = value;
		});

		// 親要素に data-age-tier、子要素に data-label を持つパターンも対応
		const parentTiers = document.querySelectorAll('[data-age-tier]');
		parentTiers.forEach((parent) => {
			const tier = parent.getAttribute('data-age-tier');
			const tierData = AGE_TIERS[tier];
			if (!tierData) return;
			parent.querySelectorAll('[data-label]').forEach((child) => {
				if (child.hasAttribute('data-age-tier')) return; // 直接指定優先
				const labelType = child.getAttribute('data-label');
				let value;
				switch (labelType) {
					case 'age-tier-name':
						value = tierData.name;
						break;
					case 'age-tier-range':
						value = tierData.range;
						break;
					case 'age-tier-formal':
						value = tierData.formal;
						break;
					default:
						return;
				}
				child.textContent = value;
			});
		});
	}

	/**
	 * data-plan + data-label 属性を持つ要素を辞書値で上書きする
	 *
	 * data-label の値:
	 *   - "plan-name": プラン名（無料プラン/スタンダードプラン/ファミリープラン）
	 */
	function applyPlanLabels() {
		var elements = document.querySelectorAll('[data-plan][data-label]');
		elements.forEach(function(el) {
			var plan = el.getAttribute('data-plan');
			var labelType = el.getAttribute('data-label');
			var planName = PLAN_LABELS[plan];
			if (!planName) return;

			if (labelType === 'plan-name') {
				el.textContent = planName;
			}
		});
	}

	/**
	 * data-lp-key 属性を持つ要素を LP_LABELS 辞書値で上書きする (#1344, #1701 ADR-0025)
	 *
	 * data-lp-key の形式: "section.key" (例: "retention.sectionTitle")
	 * SEO のため HTML 側にはフォールバックテキストを残してよい。
	 * JS ロード後に labels.ts の値で確認・置換する。
	 *
	 * #1701: nested HTML (<strong>/<em>/<a> 等) を保持できるよう innerHTML + DOMPurify sanitize に切替。
	 * DOMPurify は site/*.html の <head> に CDN 経由で注入される (ADR-0025)。
	 * 不在時は textContent fallback + console.warn する。
	 */
	function applyLpKeys() {
		var elements = document.querySelectorAll('[data-lp-key]');
		var Purify = (typeof window !== 'undefined') && window.DOMPurify;
		// #1717 致命的欠陥修正: legal docs (privacy/terms/sla/tokushoho) が h1/h2/p/ul/ol/li/div/table 等を必要とするため
		// ALLOWED_TAGS / ALLOWED_ATTR を構造タグ/属性まで拡張する。
		// XSS 防御は維持: <script>/<iframe>/<object>/<embed>/<style>/<svg>/<math> 等の危険タグは含めない（DOMPurify DEFAULT で deny）。
		// インラインイベントハンドラ（onerror= 等）/ javascript: URL は引き続きブロックされる。
		var SANITIZE_CONFIG = {
			ALLOWED_TAGS: [
				// 既存（インライン装飾）
				'strong', 'em', 'a', 'br', 'span', 'sup', 'sub', 'small', 'b', 'i',
				// 構造（見出し・段落・リスト・コンテナ）
				'h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'div',
				// テーブル（tokushoho.html の特商法表記など）
				'table', 'tr', 'th', 'td', 'thead', 'tbody',
				// セマンティック構造 / 定義リスト / コード
				'code', 'header', 'section', 'dl', 'dt', 'dd',
				// 図版
				'figure', 'figcaption'
			],
			ALLOWED_ATTR: [
				'href', 'target', 'rel', 'class', 'aria-hidden', 'aria-label',
				// 内部リンク anchor (privacy.html#under-age 等) の整合性のため id を許可
				'id',
				// mailto 文脈識別 (data-contact-context="プライバシー" 等) を保持
				'data-contact-context'
			],
			ALLOW_DATA_ATTR: false,
			ALLOW_UNKNOWN_PROTOCOLS: false,
			ADD_ATTR: ['target']
		};
		if (Purify && !Purify.__gqHookInstalled) {
			Purify.addHook('afterSanitizeAttributes', function(node) {
				if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
					node.setAttribute('rel', 'noopener noreferrer');
				}
			});
			Purify.__gqHookInstalled = true;
		}
		// 親要素が <table>/<thead>/<tbody>/<tr> で、かつ入力値が <tr>/<thead>/<tbody> から始まる場合、
		// 通常の HTML パーサだとブラウザが table の row group context 外と判定し <tr> 等を捨てる。
		// この場合は XHTML パーサ (PARSER_MEDIA_TYPE) で sanitize し、table row 構造を保持する。
		// 参考: tokushoho.html の <table data-lp-key="legalTokushoho.tableContent"> + <tr>...<tr>...
		var TABLE_ROW_PARENT_TAGS = ['TABLE', 'THEAD', 'TBODY', 'TR'];
		function needsXhtmlParse(parentEl, value) {
			if (TABLE_ROW_PARENT_TAGS.indexOf(parentEl.tagName) === -1) return false;
			// 値が <tr|<thead|<tbody|<th|<td から始まれば XHTML モードが必要
			// 注: 本ファイル全体が template literal で書かれているため、\\s/\\b と二重エスケープ
			return /^\\s*<(tr|thead|tbody|th|td)\\b/i.test(value);
		}

		// XHTML パーサに渡す前に void HTML 要素 (<br>, <hr>, <img>) を self-closing 形式に正規化する。
		// XHTML パーサは未閉じの void 要素で parse error を起こし、それ以降の要素を切り捨てるため
		// (例: <tr><td>foo<br>bar</td></tr><tr>... が <br> で中断される)、事前に <br/> 形式に揃える。
		// 注: 二重エスケープ — 本ファイル全体が template literal 内のため \\s/\\b/\\/ と書く
		function normalizeVoidElements(html) {
			return html
				.replace(/<br(\\s[^>]*?)?>/gi, '<br$1/>')
				.replace(/<hr(\\s[^>]*?)?>/gi, '<hr$1/>')
				.replace(/<img(\\s[^>]*?)?>/gi, '<img$1/>');
		}

		elements.forEach(function(el) {
			var key = el.getAttribute('data-lp-key');
			var parts = key.split('.');
			if (parts.length !== 2) return;
			var sectionData = LP_LABELS[parts[0]];
			if (!sectionData) return;
			var value = sectionData[parts[1]];
			if (value === undefined) return;
			if (Purify) {
				var useXhtml = needsXhtmlParse(el, value);
				var input = useXhtml ? normalizeVoidElements(value) : value;
				var cfg = useXhtml
					? Object.assign({}, SANITIZE_CONFIG, { PARSER_MEDIA_TYPE: 'application/xhtml+xml' })
					: SANITIZE_CONFIG;
				el.innerHTML = Purify.sanitize(input, cfg);
			} else {
				el.textContent = value;
				console.warn('[applyLpKeys] DOMPurify unavailable, fell back to textContent for', key);
			}
		});
	}

	function applyAll() {
		applyAgeTierLabels();
		applyPlanLabels();
		applyLpKeys();
	}

	// DOMContentLoaded 後に適用
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', applyAll);
	} else {
		applyAll();
	}
})();
`;

	return header;
}

function main() {
	const generated = generateSharedLabelsJs();

	if (CHECK_MODE) {
		if (!fs.existsSync(OUTPUT_JS)) {
			console.error(
				`✗ ${OUTPUT_JS} が存在しません。\`node scripts/generate-lp-labels.mjs\` を実行してください。`,
			);
			process.exit(1);
		}
		const current = fs.readFileSync(OUTPUT_JS, 'utf-8');
		if (current !== generated) {
			console.error('✗ site/shared-labels.js が labels.ts と同期されていません。');
			console.error('  `node scripts/generate-lp-labels.mjs` を実行して再生成してください。');
			process.exit(1);
		}
		console.log('✓ site/shared-labels.js は最新です');
		return;
	}

	fs.writeFileSync(OUTPUT_JS, generated, 'utf-8');
	console.log(`✓ ${OUTPUT_JS} を生成しました`);
}

// CLI 実行時のみ main() を呼ぶ。テストから import される場合は副作用なし
const invokedAsCli = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedAsCli) {
	main();
}

// #1772: 単体テスト用に parseBlock / parseSimpleBlock をエクスポート
// #1917: template literal 解決ロジックも追加 (parseBlockLine / resolveTemplateLiteralValue / resolveAllTemplates / isTemplateLiteral)
export {
	isTemplateLiteral,
	parseBlock,
	parseBlockLine,
	parseSimpleBlock,
	resolveAllTemplates,
	resolveTemplateLiteralValue,
};
