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
 * labels.ts から定数を抽出する簡易パーサ（TS コンパイラなしで読み取る）
 */
function parseLabelsTs() {
	const src = fs.readFileSync(LABELS_TS, 'utf-8');

	// AGE_TIER_LABELS ブロック抽出
	const ageMatch = src.match(/export const AGE_TIER_LABELS[^{]*{([^}]+)}/s);
	if (!ageMatch) throw new Error('AGE_TIER_LABELS not found in labels.ts');

	const ageTierLabels = {};
	for (const line of ageMatch[1].split('\n')) {
		const m = line.match(/(\w+):\s*'([^']+)'/);
		if (m) ageTierLabels[m[1]] = m[2];
	}

	// AGE_TIER_SHORT_LABELS ブロック抽出
	const shortMatch = src.match(/export const AGE_TIER_SHORT_LABELS[^{]*{([^}]+)}/s);
	if (!shortMatch) throw new Error('AGE_TIER_SHORT_LABELS not found in labels.ts');

	const ageTierShort = {};
	for (const line of shortMatch[1].split('\n')) {
		const m = line.match(/(\w+):\s*'([^']+)'/);
		if (m) ageTierShort[m[1]] = m[2];
	}

	// PLAN_LABELS ブロック抽出
	const planMatch = src.match(/export const PLAN_LABELS\s*=\s*{([^}]+)}/s);
	if (!planMatch) throw new Error('PLAN_LABELS not found in labels.ts');

	const planLabels = {};
	for (const line of planMatch[1].split('\n')) {
		const m = line.match(/(\w+):\s*'([^']+)'/);
		if (m) planLabels[m[1]] = m[2];
	}

	return { ageTierLabels, ageTierShort, planLabels };
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
		const modePattern = new RegExp(`${mode}:\\s*{[^}]*ageMin:\\s*(\\d+)[^}]*ageMax:\\s*(\\d+)`, 's');
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
	const { ageTierLabels, ageTierShort, planLabels } = parseLabelsTs();
	const ageTierConfig = parseAgeTierTs();

	// 各年齢区分の name / range / formal / ageMin / ageMax を統合
	const ageTiers = {};
	for (const mode of ['baby', 'preschool', 'elementary', 'junior', 'senior']) {
		const formal = ageTierLabels[mode];
		const range = ageTierShort[mode];
		const config = ageTierConfig[mode];
		// name は formal の括弧より前の部分 + 'モード'
		const baseName = formal.split('（')[0];
		ageTiers[mode] = {
			name: `${baseName}モード`,
			range,
			formal,
			ageMin: config.ageMin,
			ageMax: config.ageMax,
		};
	}

	const header = `/**
 * LP共通用語辞書 (#561, #565)
 *
 * ⚠️ このファイルは自動生成されます。直接編集しないでください。
 * 生成元: src/lib/domain/labels.ts + src/lib/domain/validation/age-tier.ts
 * 生成コマンド: node scripts/generate-lp-labels.mjs
 *
 * 用法:
 * <script src="shared-labels.js"></script>
 * <div data-age-tier="elementary" data-label="age-tier-name">小学生モード</div>
 *
 * → 本スクリプトが data-age-tier 属性を見て data-label の値を辞書から差し替える。
 *
 * data-label の値:
 *   - "age-tier-name"  : モード名（乳幼児モード/幼児モード/小学生モード/中学生モード/高校生モード）
 *   - "age-tier-range" : 年齢範囲（0〜2歳 等）
 *   - "age-tier-formal": 正式名（乳幼児（0〜2歳） 等）
 */
(function () {
	'use strict';

	const AGE_TIERS = ${JSON.stringify(ageTiers, null, '\t').replace(/\n/g, '\n\t')};

	const PLAN_LABELS = ${JSON.stringify(planLabels, null, '\t').replace(/\n/g, '\n\t')};

	// グローバルへエクスポート
	window.GANBARI_LABELS = {
		ageTiers: AGE_TIERS,
		plans: PLAN_LABELS,
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

	// DOMContentLoaded 後に適用
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', applyAgeTierLabels);
	} else {
		applyAgeTierLabels();
	}
})();
`;

	return header;
}

function main() {
	const generated = generateSharedLabelsJs();

	if (CHECK_MODE) {
		if (!fs.existsSync(OUTPUT_JS)) {
			console.error(`✗ ${OUTPUT_JS} が存在しません。\`node scripts/generate-lp-labels.mjs\` を実行してください。`);
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
