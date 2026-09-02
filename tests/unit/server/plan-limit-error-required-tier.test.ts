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
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import { planLimitError } from '$lib/server/errors';

async function bodyOf(res: Response) {
	return (await res.json()) as {
		error: { code: string; message: string; userMessage: string };
	};
}

describe('#4710 planLimitError — userMessage は要求 tier を言う', () => {
	it('requiredTier=standard → スタンダード以上の案内', async () => {
		const res = planLimitError('standard', 'export requires standard');
		expect(res.status).toBe(403);
		const body = await bodyOf(res);
		expect(body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
		expect(body.error.userMessage).toBe(PLAN_GATE_LABELS.standardOrAboveGenericWithUpgrade);
	});

	it('requiredTier=family → プレミアム限定の案内 (スタンダード契約者に「スタンダードにしてください」と言わない)', async () => {
		const res = planLimitError('family', 'ai suggest requires premium');
		const body = await bodyOf(res);
		expect(body.error.userMessage).toBe(PLAN_GATE_LABELS.familyLimitedGenericWithUpgrade);
		// standard 契約者が読む文なので、standard へのアップグレード案内であってはならない
		expect(body.error.userMessage).not.toBe(PLAN_GATE_LABELS.standardOrAboveGenericWithUpgrade);
	});

	it('message (開発者向け) は userMessage と混ざらない', async () => {
		const res = planLimitError('family', 'ai suggest requires premium');
		const body = await bodyOf(res);
		expect(body.error.message).toBe('ai suggest requires premium');
	});
});
