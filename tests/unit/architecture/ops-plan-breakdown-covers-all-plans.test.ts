// tests/unit/architecture/ops-plan-breakdown-covers-all-plans.test.ts (#4505 / ADR-0061)
//
// **`/ops` のプラン内訳は、存在する全プランを必ず 1 行ずつ出す。**
//
// # なぜ必要か
//
// 集計 (ops-service) と描画 (ops/+page.svelte) が別々にプランを手で並べていたため、
// プレミアム (family-monthly / family-yearly) を足したときに描画側だけ追従漏れし、
// **プレミアム契約のテナントがどの行にも出ず、合計 MRR からも欠落**した (#4505 実測)。
// 経営数値の欠落は画面が壊れて見えないので、気づく手段がない。
//
// 行をプラン集合から作る形に変えたので、その形が保たれていることを機械で保証する。
//
// # 何を fail させるか
//
// - `ALL_SUBSCRIPTION_PLANS` のどれかが内訳の行に現れない
// - `/ops` の内訳テーブルがプランごとの行を手で並べる形に戻る

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAN_MRR_UNIT_YEN } from '$lib/domain/constants/plan-price';
import { ALL_SUBSCRIPTION_PLANS } from '$lib/domain/constants/subscription-plan';
import { OPS_LABELS } from '$lib/domain/labels';
import { buildOpsPlanRows } from '$lib/domain/ops-plan-rows';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OPS_PAGE = join(REPO_ROOT, 'src/routes/ops/+page.svelte');

const COUNTS = {
	monthly: 2,
	yearly: 1,
	familyMonthly: 3,
	familyYearly: 1,
	lifetime: 5,
};

describe('#4505 /ops プラン内訳は全プランを必ず出す', () => {
	it('行が ALL_SUBSCRIPTION_PLANS を過不足なく覆う', () => {
		const rows = buildOpsPlanRows(COUNTS);
		expect(rows.map((r) => r.plan).sort()).toEqual([...ALL_SUBSCRIPTION_PLANS].sort());
	});

	it('各行のテナント数と MRR が集計値 × 単価 SSOT と一致する', () => {
		const rows = buildOpsPlanRows(COUNTS);
		const byPlan = Object.fromEntries(rows.map((r) => [r.plan, r]));

		expect(byPlan['family-monthly']?.tenants).toBe(3);
		expect(byPlan['family-monthly']?.mrr).toBe(3 * PLAN_MRR_UNIT_YEN['family-monthly']);
		// 買い切りは月次収益に寄与しない (画面では「-」)
		expect(byPlan.lifetime?.mrr).toBe(0);
		// 合計は各行の和 = service の totalMrr と同じ組み立て方
		const total = rows.reduce((sum, r) => sum + r.mrr, 0);
		expect(total).toBe(
			2 * PLAN_MRR_UNIT_YEN.monthly +
				1 * PLAN_MRR_UNIT_YEN.yearly +
				3 * PLAN_MRR_UNIT_YEN['family-monthly'] +
				1 * PLAN_MRR_UNIT_YEN['family-yearly'],
		);
	});

	it('全プランに行ラベルがある (プランを足したら型で表の追加が要求される)', () => {
		for (const plan of ALL_SUBSCRIPTION_PLANS) {
			expect(OPS_LABELS.planRowLabels[plan], `${plan} の行ラベルが無い`).toBeTruthy();
		}
	});

	it('/ops の内訳テーブルが行を手で並べる形に戻っていない', () => {
		const src = readFileSync(OPS_PAGE, 'utf-8');
		// 行は each で組み立てる (プランごとの td を書かない)
		expect(src).toContain('{#each planRows as row');
		for (const legacyRow of ['planMonthly', 'planYearly', 'planPremiumMonthly', 'planLifetime']) {
			expect(
				src.includes(`OPS_LABELS.${legacyRow}}`),
				`OPS_LABELS.${legacyRow} を直接描いています。行はプラン集合から組み立ててください (#4505)`,
			).toBe(false);
		}
	});
});
