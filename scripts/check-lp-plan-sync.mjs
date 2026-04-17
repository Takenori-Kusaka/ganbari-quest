#!/usr/bin/env node
/**
 * scripts/check-lp-plan-sync.mjs (#764)
 *
 * LP (site/*.html) のプラン情報が `src/lib/domain/plan-features.ts` の SSOT と
 * 同期しているかを検証する。TS コンパイラを使わず regex で軽量にパースする。
 *
 * チェック対象:
 *  1. `site/pricing.html` — 網羅的な料金ページ。
 *     - PRICING_PAGE_META の全プランの `price` / `yearlyPrice` が HTML に現れる
 *     - PRICING_PAGE_FEATURES の全 feature 文字列が HTML に現れる（完全一致 substring）
 *  2. `site/index.html` — LP トップの料金セクション。
 *     - PRICING_PAGE_META の全プランの `price` が HTML に現れる
 *     - 簡略版のため feature リストは緩やかにチェック（各プランの feature が少なくとも 1 つ現れる）
 *  3. `site/pamphlet.html` — パンフレット版。
 *     - 同上
 *
 * 使用法:
 *   node scripts/check-lp-plan-sync.mjs           # レポートのみ
 *   node scripts/check-lp-plan-sync.mjs --check   # 差分があれば exit 1（CI 用）
 *
 * 背景:
 *   価格・特典リストは 5 箇所（plan-features.ts, pricing.html, index.html,
 *   pamphlet.html, PremiumWelcome.svelte）で並行実装されており、更新漏れが頻発する。
 *   アプリ側 Svelte は #762 で plan-features.ts を SSOT 化済み。LP 側はこの
 *   チェッカで drift を検知する。詳細は parallel-implementations.md §9 参照。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const PLAN_FEATURES_TS = path.join(REPO_ROOT, 'src/lib/domain/plan-features.ts');
const SITE_PRICING_HTML = path.join(REPO_ROOT, 'site/pricing.html');
const SITE_INDEX_HTML = path.join(REPO_ROOT, 'site/index.html');
const SITE_PAMPHLET_HTML = path.join(REPO_ROOT, 'site/pamphlet.html');

const args = process.argv.slice(2);
const CHECK_MODE = args.includes('--check');

/**
 * `plan-features.ts` から PRICING_PAGE_META と PRICING_PAGE_FEATURES を抽出する。
 * TS コンパイラを使わないので regex ベース。変更に追従するため失敗時は詳細な
 * エラーを投げて早期検知する。
 */
function parsePlanFeatures() {
	const src = fs.readFileSync(PLAN_FEATURES_TS, 'utf-8');

	// PRICING_PAGE_FEATURES: Record<PlanKey, readonly string[]> = {
	//   free: ['a', 'b'],
	//   standard: ['c', 'd'],
	//   family: ['e', 'f'],
	// }
	const featuresBlockMatch = src.match(
		/export const PRICING_PAGE_FEATURES[^{]*{([\s\S]*?)\n} as const;/,
	);
	if (!featuresBlockMatch) {
		throw new Error('PRICING_PAGE_FEATURES block not found in plan-features.ts');
	}
	const featuresBlock = featuresBlockMatch[1];

	/** @type {Record<'free'|'standard'|'family', string[]>} */
	const features = { free: [], standard: [], family: [] };
	for (const plan of /** @type {const} */ (['free', 'standard', 'family'])) {
		const planMatch = featuresBlock.match(new RegExp(`${plan}:\\s*\\[([\\s\\S]*?)\\]`));
		if (!planMatch) {
			throw new Error(`PRICING_PAGE_FEATURES.${plan} array not found`);
		}
		const items = [...planMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
		features[plan] = items;
	}

	// PRICING_PAGE_META: Record<PlanKey, PricingPageMeta> = {
	//   free: { ..., price: '¥0', unit: '', ... },
	//   standard: { ..., price: '¥500', unit: '/月', yearlyPrice: '年額 ¥5,000 ...' },
	//   ...
	// }
	const metaBlockMatch = src.match(/export const PRICING_PAGE_META[^{]*{([\s\S]*?)\n} as const;/);
	if (!metaBlockMatch) {
		throw new Error('PRICING_PAGE_META block not found in plan-features.ts');
	}
	const metaBlock = metaBlockMatch[1];

	/** @type {Record<'free'|'standard'|'family', { price: string; yearlyPrice?: string }>} */
	const meta = { free: { price: '' }, standard: { price: '' }, family: { price: '' } };
	for (const plan of /** @type {const} */ (['free', 'standard', 'family'])) {
		const planMatch = metaBlock.match(new RegExp(`${plan}:\\s*{([\\s\\S]*?)^\\s*}`, 'm'));
		if (!planMatch) {
			throw new Error(`PRICING_PAGE_META.${plan} block not found`);
		}
		const body = planMatch[1];
		const priceMatch = body.match(/price:\s*'([^']+)'/);
		if (!priceMatch) {
			throw new Error(`PRICING_PAGE_META.${plan}.price not found`);
		}
		meta[plan].price = priceMatch[1];

		const yearlyMatch = body.match(/yearlyPrice:\s*'([^']+)'/);
		if (yearlyMatch) {
			meta[plan].yearlyPrice = yearlyMatch[1];
		}
	}

	return { features, meta };
}

/**
 * HTML 内に文字列が含まれるかチェックする。HTML エンティティ（&#165; など）
 * を ¥ に復元し、プラン情報に出てくる文字クラスのみ正規化する。
 */
function htmlContains(haystack, needle) {
	const normalized = haystack
		.replace(/&#165;/g, '¥')
		.replace(/&#xA5;/gi, '¥')
		.replace(/&yen;/g, '¥')
		.replace(/&#10003;/g, '✓')
		.replace(/&#x2713;/gi, '✓');
	return normalized.includes(needle);
}

/**
 * 1 つの LP HTML ファイルを検証する。
 *
 * @param {string} filePath
 * @param {ReturnType<typeof parsePlanFeatures>} ssot
 * @param {{ strictFeatures: boolean; checkYearlyPrice: boolean }} opts
 *   strictFeatures=true: 全 feature が含まれる必要
 *   checkYearlyPrice=true: 年額価格もチェックする（pamphlet は月額のみなので除外）
 */
function verifyHtmlFile(filePath, ssot, { strictFeatures, checkYearlyPrice }) {
	const rel = path.relative(REPO_ROOT, filePath);
	if (!fs.existsSync(filePath)) {
		return { rel, errors: [`${rel} が存在しない`] };
	}
	const html = fs.readFileSync(filePath, 'utf-8');

	/** @type {string[]} */
	const errors = [];

	// --- 価格チェック ---
	for (const plan of /** @type {const} */ (['free', 'standard', 'family'])) {
		const { price, yearlyPrice } = ssot.meta[plan];
		if (!htmlContains(html, price)) {
			errors.push(`[${plan}] price "${price}" が HTML に現れない`);
		}
		// yearlyPrice は標準/ファミリーのみ。全文字列はマーケ文言を含むので
		// 「年額 ¥5,000」部分（price 数値）だけ緩くチェックする。pamphlet は月額のみ。
		if (checkYearlyPrice && yearlyPrice) {
			const yearlyMatch = yearlyPrice.match(/年額\s*¥[\d,]+/);
			if (yearlyMatch && !htmlContains(html, yearlyMatch[0])) {
				errors.push(`[${plan}] yearlyPrice "${yearlyMatch[0]}" が HTML に現れない`);
			}
		}
	}

	// --- 特典リストチェック ---
	for (const plan of /** @type {const} */ (['free', 'standard', 'family'])) {
		const features = ssot.features[plan];
		if (strictFeatures) {
			// 完全一致: 全 feature が HTML に substring として存在する必要
			for (const feature of features) {
				if (!htmlContains(html, feature)) {
					errors.push(`[${plan}] feature "${feature}" が HTML に現れない`);
				}
			}
		} else {
			// 緩和: 少なくとも 1 feature は現れる（プランセクションの存在確認）
			const anyMatch = features.some((f) => htmlContains(html, f));
			if (!anyMatch) {
				errors.push(
					`[${plan}] features のうち少なくとも 1 つは HTML に現れる必要がある（SSOT と完全に乖離）`,
				);
			}
		}
	}

	return { rel, errors };
}

function main() {
	const ssot = parsePlanFeatures();

	const results = [
		verifyHtmlFile(SITE_PRICING_HTML, ssot, { strictFeatures: true, checkYearlyPrice: true }),
		verifyHtmlFile(SITE_INDEX_HTML, ssot, { strictFeatures: false, checkYearlyPrice: true }),
		verifyHtmlFile(SITE_PAMPHLET_HTML, ssot, { strictFeatures: false, checkYearlyPrice: false }),
	];

	let totalErrors = 0;
	for (const result of results) {
		if (result.errors.length === 0) {
			console.log(`✓ ${result.rel}: SSOT と同期`);
		} else {
			console.error(`✗ ${result.rel}: ${result.errors.length} 件の不整合`);
			for (const err of result.errors) {
				console.error(`    ${err}`);
			}
			totalErrors += result.errors.length;
		}
	}

	if (totalErrors > 0) {
		console.error('');
		console.error(`✗ LP と plan-features.ts が ${totalErrors} 箇所で drift しています。`);
		console.error(
			'  LP 側（site/*.html）を src/lib/domain/plan-features.ts に合わせて更新してください。',
		);
		if (CHECK_MODE) {
			process.exit(1);
		}
	} else {
		console.log('');
		console.log('✓ 全 LP ファイルが plan-features.ts と同期されています');
	}
}

main();
