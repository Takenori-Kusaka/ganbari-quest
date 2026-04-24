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
 * SSOT 外の野良用語リスト (#1149)。
 *
 * LP に混入してはならない非正規用語。正規用語は `src/lib/domain/labels.ts` の
 * PLAN_LABELS / PLAN_SHORT_LABELS を参照。検出された場合は CI を red にして
 * 「labels.ts を参照して正規名に差し替える」ことを強制する。
 *
 * 追加時は `term` と `canonical` (推奨置換) を両方書くこと。canonical は
 * エラーメッセージにそのまま出る → 開発者が次に取る行動が自明になる。
 */
const BANNED_TERMS = [
	{ term: 'フリープラン', canonical: '無料プラン (PLAN_LABELS.free)' },
	{
		term: 'カスタマーポータル',
		canonical: 'お支払い管理 / マイページ 等、SSOT に定義した日本語ラベル',
	},
	{
		term: 'サブスクリプション',
		canonical: '定期プラン / 月額プラン 等、SSOT に定義した日本語ラベル',
	},
];

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
 * #1293: 価格プロミスバンドの最低有料価格 + 安心シグナル検証。
 * 全プラン網羅は pricing.html 側の strict チェックに委ねる。
 *
 * @param {string} html
 * @param {ReturnType<typeof parsePlanFeatures>} ssot
 * @returns {string[]}
 */
function verifyMinPaidPricePolicy(html, ssot) {
	/** @type {string[]} */
	const errors = [];
	const { price: standardPrice } = ssot.meta.standard;
	if (!htmlContains(html, standardPrice)) {
		errors.push(
			`[standard] price "${standardPrice}" が HTML に現れない (価格プロミスバンドに最低有料価格は必須)`,
		);
	}
	const TRIAL_SIGNALS = ['7 日間無料', '7日間無料'];
	if (!TRIAL_SIGNALS.some((s) => htmlContains(html, s))) {
		errors.push(
			`安心シグナル「7 日間無料」(または「7日間無料」) が HTML に現れない (#1293 価格プロミスバンド要件)`,
		);
	}
	if (!htmlContains(html, 'いつでも解約')) {
		errors.push(`安心シグナル「いつでも解約」が HTML に現れない (#1293 価格プロミスバンド要件)`);
	}
	return errors;
}

/**
 * 全プラン価格 (+ 条件次第で年額) を検証する既定ポリシー。
 *
 * @param {string} html
 * @param {ReturnType<typeof parsePlanFeatures>} ssot
 * @param {boolean} checkYearlyPrice
 * @returns {string[]}
 */
function verifyAllPricesPolicy(html, ssot, checkYearlyPrice) {
	/** @type {string[]} */
	const errors = [];
	for (const plan of /** @type {const} */ (['free', 'standard', 'family'])) {
		const { price, yearlyPrice } = ssot.meta[plan];
		if (!htmlContains(html, price)) {
			errors.push(`[${plan}] price "${price}" が HTML に現れない`);
		}
		if (checkYearlyPrice && yearlyPrice) {
			const yearlyMatch = yearlyPrice.match(/年額\s*¥[\d,]+/);
			if (yearlyMatch && !htmlContains(html, yearlyMatch[0])) {
				errors.push(`[${plan}] yearlyPrice "${yearlyMatch[0]}" が HTML に現れない`);
			}
		}
	}
	return errors;
}

/**
 * 1 つの LP HTML ファイルを検証する。
 *
 * @param {string} filePath
 * @param {ReturnType<typeof parsePlanFeatures>} ssot
 * @param {{ strictFeatures: boolean; checkYearlyPrice: boolean; checkFeatures?: boolean; pricePolicy?: 'all' | 'minPaid' }} opts
 *   strictFeatures=true: 全 feature が含まれる必要
 *   checkYearlyPrice=true: 年額価格もチェックする（pamphlet / index は月額のみなので除外）
 *   checkFeatures=false: features チェック自体をスキップ（#1141 以降の index.html
 *     のように feature を要約して書き直す summary セクション用。pricing.html への
 *     リンクがあり詳細は別ページで担保される場合に使う）
 *   pricePolicy='all': 全プランの price が HTML に現れる必要（既定）
 *   pricePolicy='minPaid': 最低有料価格（standard の price）のみチェック（#1293: 価格プロミスバンド）
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 既存コード、別Issueで対応予定
function verifyHtmlFile(
	filePath,
	ssot,
	{ strictFeatures, checkYearlyPrice, checkFeatures = true, pricePolicy = 'all' },
) {
	const rel = path.relative(REPO_ROOT, filePath);
	if (!fs.existsSync(filePath)) {
		return { rel, errors: [`${rel} が存在しない`] };
	}
	const html = fs.readFileSync(filePath, 'utf-8');

	/** @type {string[]} */
	const errors = [];

	// --- 価格チェック ---
	const priceErrors =
		pricePolicy === 'minPaid'
			? verifyMinPaidPricePolicy(html, ssot)
			: verifyAllPricesPolicy(html, ssot, checkYearlyPrice);
	errors.push(...priceErrors);

	// --- 特典リストチェック ---
	if (checkFeatures) {
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
	}

	return { rel, errors };
}

/**
 * SSOT 外の野良用語が LP HTML に混入していないかを検証する (#1149)。
 * 検出した場合は行番号付きで列挙する — grep で該当箇所へ飛びやすいように。
 *
 * @param {string} filePath
 * @returns {{ rel: string; errors: string[] }}
 */
function verifyNoBannedTerms(filePath) {
	const rel = path.relative(REPO_ROOT, filePath);
	if (!fs.existsSync(filePath)) {
		return { rel, errors: [] };
	}
	const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
	/** @type {string[]} */
	const errors = [];
	for (const { term, canonical } of BANNED_TERMS) {
		lines.forEach((line, idx) => {
			if (line.includes(term)) {
				errors.push(`L${idx + 1}: 野良用語 "${term}" を検出 → 正規用語: ${canonical}`);
			}
		});
	}
	return { rel, errors };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 既存コード、別Issueで対応予定
function main() {
	const ssot = parsePlanFeatures();

	const lpFiles = [SITE_PRICING_HTML, SITE_INDEX_HTML, SITE_PAMPHLET_HTML];

	const results = [
		verifyHtmlFile(SITE_PRICING_HTML, ssot, { strictFeatures: true, checkYearlyPrice: true }),
		// #1293 以降、index.html の料金セクションは「価格プロミスバンド」に簡素化された
		// (freemium × 低価格帯での price disambiguation / 配置原則は lp-content-map.md 参照)。
		// 最低有料価格と安心シグナル文言のみ pricePolicy='minPaid' で検証し、
		// 全プラン網羅・年額・feature 詳細は pricing.html 側で strict チェックする。
		verifyHtmlFile(SITE_INDEX_HTML, ssot, {
			strictFeatures: false,
			checkYearlyPrice: false,
			checkFeatures: false,
			pricePolicy: 'minPaid',
		}),
		verifyHtmlFile(SITE_PAMPHLET_HTML, ssot, { strictFeatures: false, checkYearlyPrice: false }),
	];

	const bannedResults = lpFiles.map(verifyNoBannedTerms);

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

	let totalBanned = 0;
	for (const result of bannedResults) {
		if (result.errors.length === 0) {
			console.log(`✓ ${result.rel}: 野良用語なし`);
		} else {
			console.error(`✗ ${result.rel}: 野良用語 ${result.errors.length} 件検出`);
			for (const err of result.errors) {
				console.error(`    ${err}`);
			}
			totalBanned += result.errors.length;
		}
	}

	if (totalErrors > 0 || totalBanned > 0) {
		console.error('');
		if (totalErrors > 0) {
			console.error(`✗ LP と plan-features.ts が ${totalErrors} 箇所で drift しています。`);
			console.error(
				'  LP 側（site/*.html）を src/lib/domain/plan-features.ts に合わせて更新してください。',
			);
		}
		if (totalBanned > 0) {
			console.error(`✗ LP に SSOT 外の野良用語が ${totalBanned} 箇所混入しています (#1149)。`);
			console.error(
				'  src/lib/domain/labels.ts の PLAN_LABELS を参照し、正規用語に置換してください。',
			);
		}
		if (CHECK_MODE) {
			process.exit(1);
		}
	} else {
		console.log('');
		console.log('✓ 全 LP ファイルが plan-features.ts と同期され、野良用語もありません');
	}
}

main();
