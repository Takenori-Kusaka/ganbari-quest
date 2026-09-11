// tests/unit/domain/plan-price-ssot.test.ts (#4533)
//
// プラン単価の SSOT (src/lib/domain/constants/plan-price.ts) が
// 集計 (ops-analytics / cohort-analysis / ops / stripe-metrics)、課金 (stripe/config)、
// 表示 (terms.ts / labels.ts / plan-features.ts / LP) の全経路に伝播していることを機械検証する。
//
// これが無いと「値上げしたのに /ops の MRR だけ旧単価のまま」「Stripe 実請求額と料金表が食い違う」
// という二重管理 (#4477 履歴保持日数と同 class) が再発する。単価は画面に警告が出ないまま
// ずれるため、ずれを検出できるのはここだけ。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// LP 生成側の実処理 (.mjs script) をそのまま検査する
import { buildPriceTerms } from '../../../scripts/generate-lp-labels.mjs';
import {
	formatYen,
	PLAN_MRR_UNIT_YEN,
	PLAN_PRICE_YEN,
	planMrrUnitYen,
} from '../../../src/lib/domain/constants/plan-price';
import {
	ALL_SUBSCRIPTION_PLANS,
	SUBSCRIPTION_PLAN,
} from '../../../src/lib/domain/constants/subscription-plan';
import { OPS_LABELS, SUBSCRIPTION_PAGE_LABELS } from '../../../src/lib/domain/labels';
import { PRICING_PAGE_META } from '../../../src/lib/domain/plan-features';
import { PRICE_TERMS } from '../../../src/lib/domain/terms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(__dirname, '../../../', rel), 'utf-8');

const HISTORICAL_SNAPSHOT_DECL = 'const HISTORICAL_YEARLY_AMOUNTS';
const STRIPE_METRICS = 'src/lib/server/services/stripe-metrics-service.ts';

/**
 * `HISTORICAL_YEARLY_AMOUNTS` の宣言ブロックだけを source から取り除く。
 *
 * ここは「過去に実際に請求された額」の snapshot であり、**意図的に SSOT を参照しない**
 * (下の describe で「参照していないこと」を別途 assert する)。単価 literal の一括検査から
 * 除外しないと、正しい実装が落ちてしまう。
 */
function stripIntentionalSnapshot(src: string): string {
	const start = src.indexOf(HISTORICAL_SNAPSHOT_DECL);
	if (start === -1) return src;
	const end = src.indexOf('};', start);
	if (end === -1) return src;
	return src.slice(0, start) + src.slice(end + 2);
}

describe('plan price SSOT (#4533)', () => {
	describe('formatYen', () => {
		it('3 桁区切りを入れる', () => {
			expect(formatYen(500)).toBe('¥500');
			expect(formatYen(5000)).toBe('¥5,000');
			expect(formatYen(7800)).toBe('¥7,800');
			expect(formatYen(0)).toBe('¥0');
		});
	});

	describe('MRR 単価は請求額からの導出値', () => {
		it('月額はそのまま、年額は 12 分割の四捨五入', () => {
			expect(PLAN_MRR_UNIT_YEN[SUBSCRIPTION_PLAN.MONTHLY]).toBe(
				PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.MONTHLY],
			);
			expect(PLAN_MRR_UNIT_YEN[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]).toBe(
				PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.FAMILY_MONTHLY],
			);
			expect(PLAN_MRR_UNIT_YEN[SUBSCRIPTION_PLAN.YEARLY]).toBe(
				Math.round(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.YEARLY] / 12),
			);
			expect(PLAN_MRR_UNIT_YEN[SUBSCRIPTION_PLAN.FAMILY_YEARLY]).toBe(
				Math.round(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.FAMILY_YEARLY] / 12),
			);
		});

		it('lifetime (買い切り) は経常収益を生まないので 0', () => {
			expect(PLAN_MRR_UNIT_YEN[SUBSCRIPTION_PLAN.LIFETIME]).toBe(0);
		});

		it('全 5 プランを網羅する (新プラン追加時に穴を作らせない)', () => {
			for (const plan of ALL_SUBSCRIPTION_PLANS) {
				expect(PLAN_PRICE_YEN[plan]).toBeTypeOf('number');
				expect(PLAN_MRR_UNIT_YEN[plan]).toBeTypeOf('number');
			}
			expect(Object.keys(PLAN_MRR_UNIT_YEN).sort()).toEqual([...ALL_SUBSCRIPTION_PLANS].sort());
		});

		it('planMrrUnitYen は未設定 / 未知の plan を 0 に落とす', () => {
			expect(planMrrUnitYen(SUBSCRIPTION_PLAN.MONTHLY)).toBe(
				PLAN_MRR_UNIT_YEN[SUBSCRIPTION_PLAN.MONTHLY],
			);
			expect(planMrrUnitYen(null)).toBe(0);
			expect(planMrrUnitYen(undefined)).toBe(0);
			expect(planMrrUnitYen('unknown-plan')).toBe(0);
		});
	});

	// SSOT の値を変えたら追随することを「現在値から組み立てた文字列と一致するか」で確かめる。
	// 直書きに戻すと SSOT を変えた瞬間にこの assert が落ちる (変異試験の対象)。
	describe('表示文字列に金額が直書きされていない (変異試験の対象)', () => {
		it('atom (PRICE_TERMS) は SSOT を整形したもの', () => {
			expect(PRICE_TERMS.standard).toBe(formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.MONTHLY]));
			expect(PRICE_TERMS.family).toBe(formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]));
			expect(PRICE_TERMS.standardYearly).toBe(formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.YEARLY]));
			expect(PRICE_TERMS.familyYearly).toBe(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.FAMILY_YEARLY]),
			);
			expect(PRICE_TERMS.standardYenFull).toBe(`${PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.MONTHLY]}円`);
			expect(PRICE_TERMS.familyYenFull).toBe(
				`${PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]}円`,
			);
		});

		it('料金カード (plan-features.ts) の価格', () => {
			expect(PRICING_PAGE_META.standard.price).toBe(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.MONTHLY]),
			);
			expect(PRICING_PAGE_META.family.price).toBe(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]),
			);
		});

		it('/admin/subscription のプランラベル', () => {
			expect(SUBSCRIPTION_PAGE_LABELS.planLabelMonthly).toContain(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.MONTHLY]),
			);
			expect(SUBSCRIPTION_PAGE_LABELS.planLabelYearly).toContain(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.YEARLY]),
			);
			expect(SUBSCRIPTION_PAGE_LABELS.planLabelFamilyMonthly).toContain(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]),
			);
			expect(SUBSCRIPTION_PAGE_LABELS.planLabelFamilyYearly).toContain(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.FAMILY_YEARLY]),
			);
		});

		it('/ops プラン内訳の行ラベル', () => {
			// #4505: 行ラベルは plan 値ごとの表 (planRowLabels) に統合済。
			expect(OPS_LABELS.planRowLabels[SUBSCRIPTION_PLAN.MONTHLY]).toContain(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.MONTHLY]),
			);
			expect(OPS_LABELS.planRowLabels[SUBSCRIPTION_PLAN.YEARLY]).toContain(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.YEARLY]),
			);
			expect(OPS_LABELS.planRowLabels[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]).toContain(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.FAMILY_MONTHLY]),
			);
			expect(OPS_LABELS.planRowLabels[SUBSCRIPTION_PLAN.FAMILY_YEARLY]).toContain(
				formatYen(PLAN_PRICE_YEN[SUBSCRIPTION_PLAN.FAMILY_YEARLY]),
			);
		});
	});

	// 集計・課金側は「単価表を自前で持たない」ことを source 検査で固定する。
	// 値の一致だけを見ると、同じ値のローカル表を再び置かれても検出できない (#4514 で実際に起きた)。
	describe('単価を使う実装が SSOT を import している (変異試験の対象)', () => {
		const CONSUMERS = [
			'src/lib/server/services/ops-analytics-service.ts',
			// #4505: /ops プラン内訳の単価掛けは domain の行組み立てに移した (画面が掛け直さない形)。
			'src/lib/domain/ops-plan-rows.ts',
			'src/lib/server/services/cohort-analysis-service.ts',
			'src/lib/server/services/stripe-metrics-service.ts',
			'src/lib/server/stripe/config.ts',
		];

		it.each(CONSUMERS)('%s が constants/plan-price から import している', (rel) => {
			expect(readSrc(rel)).toMatch(/from '\$lib\/domain\/constants\/plan-price'/);
		});

		it.each(CONSUMERS)('%s に単価の数値 literal が残っていない', (rel) => {
			const src = stripIntentionalSnapshot(readSrc(rel))
				// 行コメント / ブロックコメント内の言及 (「単価は plan-price.ts が SSOT」等) は対象外
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/^[\t ]*\/\/.*$/gm, '');
			// SSOT に入っている全金額 (0 を除く) が、実装本体に数値として現れないこと
			const amounts = [...new Set(Object.values(PLAN_PRICE_YEN))].filter((n) => n > 0);
			expect(amounts.length).toBeGreaterThan(0);
			for (const amount of amounts) {
				expect(src).not.toMatch(new RegExp(`\\b${amount}\\b`));
			}
		});

		it('/ops 画面が単価を再計算していない (server が渡した値を描画するだけ)', () => {
			const src = readSrc('src/routes/ops/+page.svelte');
			const amounts = [...new Set(Object.values(PLAN_PRICE_YEN))].filter((n) => n > 0);
			for (const amount of amounts) {
				expect(src).not.toMatch(new RegExp(`\\b${amount}\\b`));
			}
		});
	});

	// 値だけを突き合わせる assert は「同じ値の直書きを再導入する」変異を素通りさせる
	// (現在値と一致してしまうため)。表示側も source 検査で「SSOT を参照する形」を固定する。
	describe('表示側の source が SSOT 参照の形になっている (変異試験の対象)', () => {
		/** コメント (行 / ブロック) を落とした source。SSOT への言及は検査対象外にする。 */
		const stripComments = (src: string) =>
			src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '');

		it('terms.ts の PRICE_TERMS が金額を直書きしていない', () => {
			const src = readSrc('src/lib/domain/terms.ts');
			const block = src.slice(src.indexOf('export const PRICE_TERMS'));
			const body = stripComments(block.slice(0, block.indexOf('} as const;')));
			// 金額由来の key は formatYen(...) / `${PLAN_PRICE_YEN[...]}円` のいずれかで組み立てる
			for (const key of [
				'standard',
				'family',
				'standardYearly',
				'familyYearly',
				'standardYenFull',
				'familyYenFull',
			]) {
				const m = body.match(new RegExp(`^\\s*${key}:\\s*(.+?),\\s*$`, 'm'));
				expect(m?.[1], `PRICE_TERMS.${key} が読めない`).toBeDefined();
				expect(m?.[1]).toMatch(/PLAN_PRICE_YEN\[SUBSCRIPTION_PLAN\.\w+\]/);
			}
		});

		it.each([
			'src/lib/domain/terms.ts',
			'src/lib/domain/labels.ts',
			'src/lib/domain/plan-features.ts',
		])('%s に円記号付きの金額 literal が残っていない', (rel) => {
			const src = stripComments(readSrc(rel));
			const amounts = [...new Set(Object.values(PLAN_PRICE_YEN))].filter((n) => n > 0);
			for (const amount of amounts) {
				// `¥500` / `¥5,000` の両表記を見る (formatYen の出力形)
				expect(src).not.toContain(`¥${amount}`);
				expect(src).not.toContain(formatYen(amount));
			}
		});
	});

	// SSOT 集約 PR で literal を残すと、次の人が「集約漏れ」だと思って潰す (#4533 で実際に起きた)。
	// 「意図的に SSOT を参照しない」ことを機械で守り、善意の集約から保護する。
	describe('過去の請求額 snapshot は SSOT を参照しない (変異試験の対象)', () => {
		const snapshotBlock = () => {
			const src = readSrc(STRIPE_METRICS);
			const start = src.indexOf(HISTORICAL_SNAPSHOT_DECL);
			expect(start, `${HISTORICAL_SNAPSHOT_DECL} が見つからない`).toBeGreaterThan(-1);
			const end = src.indexOf('};', start);
			return src.slice(start, end);
		};

		it('HISTORICAL_YEARLY_AMOUNTS は数値 literal を持つ', () => {
			// 年額は #2719 で新規販売停止済 = ここに残るのは旧価格の契約者だけ。
			// 現行定価から導出すると、料金改定の瞬間に旧価格契約者の MRR が新価格で再計算される。
			const values = [...snapshotBlock().matchAll(/\]:\s*([^,\n]+)/g)].map((m) =>
				(m[1] ?? '').trim(),
			);
			expect(values.length).toBeGreaterThan(0);
			for (const value of values) {
				expect(value, '過去の請求額は literal で固定する').toMatch(/^\d+$/);
			}
		});

		it('HISTORICAL_YEARLY_AMOUNTS が PLAN_PRICE_YEN を参照していない', () => {
			expect(snapshotBlock()).not.toContain('PLAN_PRICE_YEN');
		});

		it('なぜ SSOT を参照しないかが doc コメントに書かれている', () => {
			// 理由が書かれていなければ、次の人は再び「集約漏れ」として潰す。
			const src = readSrc(STRIPE_METRICS);
			const doc = src.slice(0, src.indexOf(HISTORICAL_SNAPSHOT_DECL));
			expect(doc).toContain('PLAN_PRICE_YEN');
			expect(doc).toMatch(/参照してはいけない|参照しない/);
		});
	});

	describe('Stripe 実請求額と MRR 集計が同じ数値を見る', () => {
		it('stripe/config.ts の amount が SSOT 参照である', () => {
			const src = readSrc('src/lib/server/stripe/config.ts');
			const assignments = [...src.matchAll(/^\s*amount:\s*([^,\n]+)/gm)]
				.map((m) => (m[1] ?? '').trim())
				// 型宣言 (`amount: number;`) は対象外
				.filter((v) => !v.startsWith('number'));
			expect(assignments.length).toBeGreaterThan(0);
			for (const value of assignments) {
				expect(value).toMatch(/^PLAN_PRICE_YEN\[SUBSCRIPTION_PLAN\.\w+\]$/);
			}
		});
	});

	describe('LP 生成 script が同じ値 SSOT から同じ atom を組み立てる', () => {
		it('generate-lp-labels.mjs の PRICE_TERMS は terms.ts と一致する', () => {
			expect(buildPriceTerms()).toEqual({
				standard: PRICE_TERMS.standard,
				family: PRICE_TERMS.family,
				standardYearly: PRICE_TERMS.standardYearly,
				familyYearly: PRICE_TERMS.familyYearly,
				standardYenFull: PRICE_TERMS.standardYenFull,
				familyYenFull: PRICE_TERMS.familyYenFull,
			});
		});
	});
});
