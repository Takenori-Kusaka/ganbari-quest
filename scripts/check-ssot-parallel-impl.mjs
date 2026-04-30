#!/usr/bin/env node
/**
 * scripts/check-ssot-parallel-impl.mjs (#1739 / R25)
 *
 * 並行実装ペア (labels.ts ⇄ shared-labels.js) の差分検知 CI。
 *
 * `scripts/generate-lp-labels.mjs --check` は **full text 比較**で
 * 完全一致を検証するが、生成器の parser がそもそも参照していない
 * `LP_*_LABELS` namespace は検証対象にならない (例: parser が未対応の
 * 新規 namespace を labels.ts に追加しても検出されない)。
 *
 * 本スクリプトは以下を **集合比較** で検証する:
 *   1. labels.ts の `LP_*_LABELS` export 一覧 と
 *      shared-labels.js の `LP_LABELS` namespace 一覧の整合性
 *   2. 各 namespace 内の key 集合が一致することの検証
 *
 * これにより「parser 未対応 namespace の silent drift」(過去の #1346 / #566 / #1126
 * 系の半完成機構放置) を機械的に止める。
 *
 * 生成器 (`generate-lp-labels.mjs`) を補完する位置付け。両方を CI に並べる
 * ことで、parser バグ・反映漏れの両面を捕捉する。
 *
 * Usage:
 *   node scripts/check-ssot-parallel-impl.mjs
 *
 * Exit code:
 *   0: 整合
 *   1: 不整合 (どの namespace / key が片側にしかないかを stderr に列挙)
 *
 * 参考: ADR-0009 (labels.ts SSOT 化原則), ADR-0014 (labels / i18n 機構選定)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const LABELS_TS = join(REPO_ROOT, 'src/lib/domain/labels.ts');
const SHARED_LABELS_JS = join(REPO_ROOT, 'site/shared-labels.js');

// labels.ts の `LP_*_LABELS` のうち、shared-labels.js に注入する想定が **無い** namespace は
// 明示除外する (例: hero band は site/index.html の Svelte 化前提の hold)。
// 除外リストはここに 1 行追加すれば良い。
//
// 現状の除外:
//   - LP_HERO_PRICE_BAND_LABELS / LP_CTA_TRUST_BADGES_LABELS / LP_HERO_SPEC_BADGES_LABELS:
//     #1683 ADR-0025 で hero/CTA セクションは Svelte 化を待つため、shared-labels.js には
//     注入しない (Phase B 完了後に LP_LABELS namespace に組み込む段階で除外解除)。
const LABELS_TS_EXCLUDED_NAMESPACES = new Set([
	'LP_HERO_PRICE_BAND_LABELS',
	'LP_CTA_TRUST_BADGES_LABELS',
	'LP_HERO_SPEC_BADGES_LABELS',
]);

/**
 * labels.ts から `export const LP_*_LABELS = { ... }` を抽出する。
 * 戻り値: Map<namespaceName, Set<keyName>>
 */
export function extractLabelsTsLpNamespaces(src) {
	const result = new Map();
	const namePattern = /^export const (LP_[A-Z0-9_]+_LABELS)\s*=\s*\{/gm;
	for (const m of src.matchAll(namePattern)) {
		const name = m[1];
		// `{` の対応で end を見つける
		const startIdx = m.index + m[0].length;
		let depth = 1;
		let i = startIdx;
		while (i < src.length && depth > 0) {
			const ch = src[i];
			if (ch === '{') depth++;
			else if (ch === '}') depth--;
			i++;
		}
		const body = src.slice(startIdx, i - 1);
		result.set(name, parseKeysFromBlock(body));
	}
	return result;
}

/**
 * オブジェクトリテラルの body 内から top-level key 名を抽出する。
 * (ネストは無視。 trailing comma あり / 改行 split 両対応)
 */
function parseKeysFromBlock(body) {
	const keys = new Set();
	const lines = body.split('\n');
	let nestDepth = 0;
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;

		// nest depth tracking — top-level だけを拾う
		const opens = (line.match(/\{/g) || []).length;
		const closes = (line.match(/\}/g) || []).length;
		const beforeDepth = nestDepth;
		nestDepth += opens - closes;

		if (beforeDepth !== 0) {
			continue;
		}

		// `key: 'value',` (single-line) または `key:` (Biome multi-line; value next line)
		const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
		if (m) {
			keys.add(m[1]);
		}
	}
	return keys;
}

/**
 * shared-labels.js の `const LP_LABELS = { ... }` から namespace と key を抽出する。
 * LP_LABELS は JSON.stringify 出力なので素朴な文字列処理で OK。
 *
 * 戻り値: Map<namespaceName, Set<keyName>>
 *   namespaceName は LP_LABELS の top-level key (例: "retention" → "LP_RETENTION_LABELS")
 */
export function extractSharedLabelsJsLpNamespaces(src) {
	const startMarker = 'const LP_LABELS = ';
	const startIdx = src.indexOf(startMarker);
	if (startIdx === -1) {
		throw new Error('LP_LABELS not found in site/shared-labels.js');
	}
	const blockStart = src.indexOf('{', startIdx);
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
	const block = src.slice(blockStart, i + 1);

	// JSON っぽいので JSON.parse で読み取る。生成元が JSON.stringify なので問題ない。
	let lpLabels;
	try {
		lpLabels = JSON.parse(block);
	} catch (e) {
		throw new Error(`Failed to JSON.parse LP_LABELS from shared-labels.js: ${e.message}`);
	}

	const result = new Map();
	for (const [shortName, sectionData] of Object.entries(lpLabels)) {
		// shortName ("retention" 等) → labels.ts 名前 ("LP_RETENTION_LABELS") に正規化
		const labelsName = shortNameToLabelsTsName(shortName);
		// sectionData が object でない場合は空 Set 扱い (旧式 alias へのガード)
		if (sectionData && typeof sectionData === 'object' && !Array.isArray(sectionData)) {
			result.set(labelsName, new Set(Object.keys(sectionData)));
		}
	}
	return result;
}

/**
 * shared-labels.js の short namespace name を labels.ts の export 名に正規化する。
 *
 * generate-lp-labels.mjs が採用している組み立てルール:
 *   retention → LP_RETENTION_LABELS
 *   coreloop → LP_CORELOOP_LABELS
 *   nav → LP_NAV_LABELS
 *   ...
 *   indexB / pricingB / faqB / pamphletB → LP_<X>_PHASEB_LABELS
 *   indexExtra → LP_INDEX_EXTRA_LABELS
 *   pricingExtra → LP_PRICING_EXTRA_LABELS
 *   founderInquiry → LP_FOUNDER_INQUIRY_LABELS
 *   licenseKey → LP_LICENSEKEY_LABELS
 *   growthRoadmap → LP_GROWTH_ROADMAP_LABELS
 *   legalDisclaimer → LP_LEGAL_DISCLAIMER_LABELS
 */
export function shortNameToLabelsTsName(shortName) {
	// 特殊マッピング (camelCase → 正式 name)
	const overrides = {
		founderInquiry: 'LP_FOUNDER_INQUIRY_LABELS',
		licenseKey: 'LP_LICENSEKEY_LABELS',
		growthRoadmap: 'LP_GROWTH_ROADMAP_LABELS',
		legalDisclaimer: 'LP_LEGAL_DISCLAIMER_LABELS',
		indexExtra: 'LP_INDEX_EXTRA_LABELS',
		pricingExtra: 'LP_PRICING_EXTRA_LABELS',
		indexB: 'LP_INDEX_PHASEB_LABELS',
		pricingB: 'LP_PRICING_PHASEB_LABELS',
		faqB: 'LP_FAQ_PHASEB_LABELS',
		pamphletB: 'LP_PAMPHLET_PHASEB_LABELS',
		// duplicated alias (generate-lp-labels.mjs の互換性のため shared-labels.js に
		// 残っている `lpLicenseKeyLabels` 等は本検証では namespace としてカウントしない)
		lpLicenseKeyLabels: null,
		lpFaqLabels: null,
		lpSelfhostLabels: null,
	};
	if (Object.hasOwn(overrides, shortName)) {
		return overrides[shortName];
	}
	// 一般則: snake_case 化 → 大文字化 → LP_<X>_LABELS
	const upper = shortName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
	return `LP_${upper}_LABELS`;
}

/**
 * 集合 A - B (A にあって B に無い)
 */
export function diffSet(a, b) {
	const result = new Set();
	for (const item of a) {
		if (!b.has(item)) result.add(item);
	}
	return result;
}

/**
 * 2 系統の namespace Map を比較し、不整合の error 文字列配列を返す。
 * テストから直接呼べるよう純粋関数にしている (main() からも使う)。
 *
 * @param {Map<string, Set<string>>} labelsTsNamespaces
 * @param {Map<string, Set<string>>} sharedLabelsJsNamespaces
 * @param {Set<string>} excluded labels.ts 側で shared 注入を除外する namespace 一覧
 * @returns {string[]} 検出した不整合の説明 (空なら整合)
 */
export function compareNamespaces(labelsTsNamespaces, sharedLabelsJsNamespaces, excluded) {
	const labelsTsNames = new Set([...labelsTsNamespaces.keys()].filter((n) => !excluded.has(n)));
	const sharedLabelsJsNames = new Set(
		[...sharedLabelsJsNamespaces.keys()].filter((n) => n !== null),
	);

	const onlyInLabelsTs = diffSet(labelsTsNames, sharedLabelsJsNames);
	const onlyInShared = diffSet(sharedLabelsJsNames, labelsTsNames);

	const errors = [];

	if (onlyInLabelsTs.size > 0) {
		errors.push(
			`labels.ts に存在するが shared-labels.js に無い namespace: ${[...onlyInLabelsTs].sort().join(', ')}`,
		);
	}
	if (onlyInShared.size > 0) {
		errors.push(
			`shared-labels.js に存在するが labels.ts に無い namespace: ${[...onlyInShared].sort().join(', ')}`,
		);
	}

	const common = [...labelsTsNames].filter((n) => sharedLabelsJsNames.has(n));
	for (const ns of common) {
		const tsKeys = labelsTsNamespaces.get(ns);
		const jsKeys = sharedLabelsJsNamespaces.get(ns);
		if (!jsKeys) continue;
		const onlyTs = diffSet(tsKeys, jsKeys);
		const onlyJs = diffSet(jsKeys, tsKeys);
		if (onlyTs.size > 0) {
			errors.push(
				`${ns}: labels.ts に存在するが shared-labels.js に無い key (${onlyTs.size} 件): ${[...onlyTs].slice(0, 5).join(', ')}${onlyTs.size > 5 ? ' ...' : ''}`,
			);
		}
		if (onlyJs.size > 0) {
			errors.push(
				`${ns}: shared-labels.js に存在するが labels.ts に無い key (${onlyJs.size} 件): ${[...onlyJs].slice(0, 5).join(', ')}${onlyJs.size > 5 ? ' ...' : ''}`,
			);
		}
	}

	return errors;
}

function main() {
	const labelsTsSrc = readFileSync(LABELS_TS, 'utf-8');
	const sharedLabelsJsSrc = readFileSync(SHARED_LABELS_JS, 'utf-8');

	const labelsTsNamespaces = extractLabelsTsLpNamespaces(labelsTsSrc);
	const sharedLabelsJsNamespaces = extractSharedLabelsJsLpNamespaces(sharedLabelsJsSrc);

	const errors = compareNamespaces(
		labelsTsNamespaces,
		sharedLabelsJsNamespaces,
		LABELS_TS_EXCLUDED_NAMESPACES,
	);

	if (errors.length > 0) {
		console.error('\n[SSOT-PARALLEL] labels.ts ⇄ shared-labels.js の不整合を検出しました:');
		for (const err of errors) {
			console.error(`  - ${err}`);
		}
		console.error('\n対処方法:');
		console.error('  1. 新規 namespace を labels.ts に追加した場合:');
		console.error('     scripts/generate-lp-labels.mjs の `parseLabelsTs()` に追加し、');
		console.error('     `lpLabels` ネストにも組み込む。');
		console.error('  2. その後 `node scripts/generate-lp-labels.mjs` を実行して再生成。');
		console.error('  3. shared-labels.js に注入しない方針の namespace は本スクリプトの');
		console.error(
			'     `LABELS_TS_EXCLUDED_NAMESPACES` に追加する (#1683 hero band 等の hold ケース用)。',
		);
		process.exit(1);
	}

	const labelsTsNamesCount = [...labelsTsNamespaces.keys()].filter(
		(n) => !LABELS_TS_EXCLUDED_NAMESPACES.has(n),
	).length;
	console.log(
		`OK [SSOT-PARALLEL]: labels.ts ⇄ shared-labels.js の ${labelsTsNamesCount} namespace が整合 (除外 ${LABELS_TS_EXCLUDED_NAMESPACES.size} 件)`,
	);
}

// CLI 実行時のみ main() を起動 (import 時は副作用なし)。
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
	main();
}
