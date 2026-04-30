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
const AGE_TIER_TS = path.join(REPO_ROOT, 'src/lib/domain/validation/age-tier.ts');
const OUTPUT_JS = path.join(REPO_ROOT, 'site/shared-labels.js');

const args = process.argv.slice(2);
const CHECK_MODE = args.includes('--check');

/**
 * labels.ts の単純な `key: 'value'` ブロックを行単位でパース
 */
function parseSimpleBlock(src, constName) {
	const pattern = new RegExp(`export const ${constName}[^{]*{([^}]+)}`, 's');
	const match = src.match(pattern);
	if (!match) throw new Error(`${constName} not found in labels.ts`);
	const result = {};
	for (const line of match[1].split('\n')) {
		const m = line.match(/(\w+):\s*'([^']+)'/);
		if (m) result[m[1]] = m[2];
	}
	return result;
}

/**
 * labels.ts のブロックを行単位でパース
 * Biome が key: / 'value' と 2 行に分割する場合にも対応
 */
function parseBlock(src, constName) {
	const startIdx = src.indexOf(`export const ${constName}`);
	if (startIdx === -1) throw new Error(`${constName} not found in labels.ts`);

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
	const block = src.slice(blockStart + 1, i);

	const result = {};
	const lines = block.split('\n');
	let pendingKey = null;

	for (const line of lines) {
		const trimmed = line.trim();

		// key: 'value', — same line
		const sameLine = trimmed.match(/^(\w+):\s*'((?:[^'\\]|\\.)*)',?$/);
		if (sameLine) {
			result[sameLine[1]] = sameLine[2];
			pendingKey = null;
			continue;
		}

		// key: — key only, value on next line (Biome multi-line format)
		const keyOnly = trimmed.match(/^(\w+):$/);
		if (keyOnly) {
			pendingKey = keyOnly[1];
			continue;
		}

		// 'value', — continuation of pending key
		if (pendingKey) {
			const valueOnly = trimmed.match(/^'((?:[^'\\]|\\.)*)',?$/);
			if (valueOnly) {
				result[pendingKey] = valueOnly[1];
				pendingKey = null;
			}
		}
	}

	return result;
}

/**
 * labels.ts から定数を抽出する簡易パーサ（TS コンパイラなしで読み取る）
 */
function parseLabelsTs() {
	const src = fs.readFileSync(LABELS_TS, 'utf-8');

	const ageTierLabels = parseSimpleBlock(src, 'AGE_TIER_LABELS');
	const ageTierShort = parseSimpleBlock(src, 'AGE_TIER_SHORT_LABELS');
	const planLabels = parseSimpleBlock(src, 'PLAN_LABELS');
	const lpRetentionLabels = parseBlock(src, 'LP_RETENTION_LABELS');
	const lpCoreloopLabels = parseBlock(src, 'LP_CORELOOP_LABELS');
	// #1465 Phase C: LP 共通ナビ・フッター・CTA
	const lpNavLabels = parseBlock(src, 'LP_NAV_LABELS');
	const lpFooterLabels = parseBlock(src, 'LP_FOOTER_LABELS');
	const lpCommonLabels = parseBlock(src, 'LP_COMMON_LABELS');
	// Phase 2 R5/R6 (#1609/#1610): 法務系打消し表示
	const lpLegalDisclaimerLabels = parseBlock(src, 'LP_LEGAL_DISCLAIMER_LABELS');
	// Phase 4 R9/R10 (#1613/#1614): 年齢別成長ロードマップ + アナログ vs デジタル
	const lpVersusLabels = parseBlock(src, 'LP_VERSUS_LABELS');
	const lpGrowthRoadmapLabels = parseBlock(src, 'LP_GROWTH_ROADMAP_LABELS');
	// Phase 5 R44 (#1650): pricing.html SSOT 同期
	const lpPricingLabels = parseBlock(src, 'LP_PRICING_LABELS');
	// #1594 ADR-0023 I8: LP の founder 直接相談 CTA セクション
	const lpFounderInquiryLabels = parseBlock(src, 'LP_FOUNDER_INQUIRY_LABELS');
	const lpLicenseKeyLabels = parseBlock(src, 'LP_LICENSEKEY_LABELS');
	const lpFaqLabels = parseBlock(src, 'LP_FAQ_LABELS');
	const lpSelfhostLabels = parseBlock(src, 'LP_SELFHOST_LABELS');
	const lpIndexExtraLabels = parseBlock(src, 'LP_INDEX_EXTRA_LABELS');
	const lpPamphletLabels = parseBlock(src, 'LP_PAMPHLET_LABELS');
	const lpPricingExtraLabels = parseBlock(src, 'LP_PRICING_EXTRA_LABELS');
	// #1702: site/{index,pricing,faq,pamphlet}.html 339 件 SSOT 化用 phase B namespace
	const lpIndexPhaseBLabels = parseBlock(src, 'LP_INDEX_PHASEB_LABELS');
	const lpPricingPhaseBLabels = parseBlock(src, 'LP_PRICING_PHASEB_LABELS');
	const lpFaqPhaseBLabels = parseBlock(src, 'LP_FAQ_PHASEB_LABELS');
	const lpPamphletPhaseBLabels = parseBlock(src, 'LP_PAMPHLET_PHASEB_LABELS');

	return {
		ageTierLabels,
		ageTierShort,
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
		lpFounderInquiryLabels,
		lpLicenseKeyLabels,
		lpFaqLabels,
		lpSelfhostLabels,
		lpIndexExtraLabels,
		lpPamphletLabels,
		lpPricingExtraLabels,
		lpIndexPhaseBLabels,
		lpPricingPhaseBLabels,
		lpFaqPhaseBLabels,
		lpPamphletPhaseBLabels,
	};
}

/**
 * age-tier.ts から AGE_TIER_CONFIG（ageMin, ageMax）を抽出
 */
function parseAgeTierTs() {
	const src = fs.readFileSync(AGE_TIER_TS, 'utf-8');

	// AGE_TIER_CONFIG ブロック抽出（ネストが多いので手動で対応）
	const startIdx = src.indexOf('AGE_TIER_CONFIG');
	if (startIdx === -1) throw new Error('AGE_TIER_CONFIG not found in age-tier.ts');
	const configSrc = src.slice(startIdx);

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
		lpFounderInquiryLabels,
		lpLicenseKeyLabels,
		lpFaqLabels,
		lpSelfhostLabels,
		lpIndexExtraLabels,
		lpPamphletLabels,
		lpPricingExtraLabels,
		lpIndexPhaseBLabels,
		lpPricingPhaseBLabels,
		lpFaqPhaseBLabels,
		lpPamphletPhaseBLabels,
	} = parseLabelsTs();
	const ageTierConfig = parseAgeTierTs();

	// 各年齢区分の name / range / formal / ageMin / ageMax を統合
	// #1304: AGE_TIER_LABELS.baby が「準備モード（0〜2歳）」に更新済みのため LP_FORMAL_OVERRIDES 不要
	const ageTiers = {};
	for (const mode of ['baby', 'preschool', 'elementary', 'junior', 'senior']) {
		const formal = ageTierLabels[mode];
		const config = ageTierConfig[mode];
		// name は formal の括弧より前の部分 + 'モード'（既に 'モード' で終わる場合は付けない）
		const baseName = formal.split('（')[0];
		const name = baseName.endsWith('モード') ? baseName : `${baseName}モード`;
		// range は formal の括弧内の年齢範囲（AGE_TIER_SHORT_LABELS が年齢範囲でない場合に備えて formal から取得）
		const range = formal.includes('（')
			? formal.split('（')[1].replace('）', '')
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
		pricing: lpPricingLabels,
		founderInquiry: lpFounderInquiryLabels,
		licenseKey: lpLicenseKeyLabels,
		faq: lpFaqLabels,
		selfhost: lpSelfhostLabels,
		indexExtra: lpIndexExtraLabels,
		pamphlet: lpPamphletLabels,
		pricingExtra: lpPricingExtraLabels,
		// #1702: site/{index,pricing,faq,pamphlet}.html 339 件 SSOT 化用 phase B namespace
		indexB: lpIndexPhaseBLabels,
		pricingB: lpPricingPhaseBLabels,
		faqB: lpFaqPhaseBLabels,
		pamphletB: lpPamphletPhaseBLabels,
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
		var SANITIZE_CONFIG = {
			ALLOWED_TAGS: ['strong','em','a','br','span','sup','sub','small','b','i'],
			ALLOWED_ATTR: ['href','target','rel','class','aria-hidden','aria-label'],
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
		elements.forEach(function(el) {
			var key = el.getAttribute('data-lp-key');
			var parts = key.split('.');
			if (parts.length !== 2) return;
			var sectionData = LP_LABELS[parts[0]];
			if (!sectionData) return;
			var value = sectionData[parts[1]];
			if (value === undefined) return;
			if (Purify) {
				el.innerHTML = Purify.sanitize(value, SANITIZE_CONFIG);
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

main();
