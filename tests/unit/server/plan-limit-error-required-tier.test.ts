// tests/unit/server/plan-limit-error-required-tier.test.ts
// #4710 AC2: 403 の userMessage が **要求 tier を正しく言う**。
//
// 旧実装は `ERROR_DEFINITIONS.PLAN_LIMIT_EXCEEDED.userMessage` に
// 「この機能はスタンダードプラン以上でご利用いただけます」を固定で持っており、
// **プレミアム限定機能 (AI 提案) を standard 契約者が叩いても同じ文が返っていた**。
// 「スタンダードにしてください」と言われた顧客は既にスタンダードなので、次の行動が取れない。
//
// AC3 と同じ性質: 「言っていること」と「実際の条件」が別々の真実になっていた。

import { describe, expect, it } from 'vitest';
import { FEATURE_LABELS, PLAN_GATE_LABELS } from '$lib/domain/labels';
import { planLimitError } from '$lib/server/errors';

async function bodyOf(res: Response) {
	return (await res.json()) as {
		error: { code: string; message: string; userMessage: string };
	};
}

describe('#4710 / #4767 planLimitError — 顧客向け文言は 1 本で、要求 tier と導線を言う', () => {
	it('requiredTier=standard → 機能名 + スタンダード以上 + アップグレード導線', async () => {
		const res = planLimitError('standard', FEATURE_LABELS.dataExport);
		expect(res.status).toBe(403);
		const body = await bodyOf(res);
		expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
		expect(body.error.message).toBe(
			PLAN_GATE_LABELS.requiredTierWithUpgradeFor(FEATURE_LABELS.dataExport, 'standard'),
		);
		// 何の機能が / 何が必要で / 次に何をするか の 3 つが 1 文に入る
		expect(body.error.message).toContain(FEATURE_LABELS.dataExport);
		expect(body.error.message).toContain(PLAN_GATE_LABELS.upgradeCta);
	});

	it('requiredTier=family → プレミアム限定の案内 (スタンダード契約者に「スタンダードにしてください」と言わない)', async () => {
		const res = planLimitError('family', FEATURE_LABELS.aiActivitySuggest);
		const body = await bodyOf(res);
		expect(body.error.message).toBe(
			PLAN_GATE_LABELS.requiredTierWithUpgradeFor(FEATURE_LABELS.aiActivitySuggest, 'family'),
		);
		// standard 契約者が読む文なので、standard へのアップグレード案内であってはならない
		expect(body.error.message).not.toBe(
			PLAN_GATE_LABELS.requiredTierWithUpgradeFor(FEATURE_LABELS.aiActivitySuggest, 'standard'),
		);
		expect(body.error.message).not.toContain(PLAN_GATE_LABELS.standardOrAboveGenericWithUpgrade);
	});

	// #4767 PO 回答 #4: 旧実装は message (開発者向け) と userMessage (顧客向け) を分けていたが、
	// **client が読むのは message** だったため導線入りの文が誰にも届いていなかった。
	// 単一チャネル = 2 つの field は常に同じ文字列。
	it('message と userMessage は同一 (顧客に届く文字列は 1 本)', async () => {
		for (const tier of ['standard', 'family'] as const) {
			const body = await bodyOf(planLimitError(tier, FEATURE_LABELS.cloudExport));
			expect(body.error.userMessage).toBe(body.error.message);
		}
	});
});
