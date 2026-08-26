// tests/unit/domain/trial-period.test.ts
// #4707: トライアル期間の暦日述語 SSOT (tier 判定と表示判定が共有する)

import { describe, expect, it } from 'vitest';
import { isTrialEndDateActiveJST, trialDaysRemainingJST } from '$lib/domain/trial-period';

describe('trial-period (#4707)', () => {
	const END = '2026-08-26';

	it.each([
		['2026-08-25T15:00:00Z', true], // 08-26 00:00 JST 最終日開始
		['2026-08-26T00:00:00Z', true], // 08-26 09:00 JST (UTC 日付切替、旧 tier 判定が free に落ちた境界)
		['2026-08-26T14:59:59Z', true], // 08-26 23:59:59 JST
		['2026-08-26T15:00:00Z', false], // 08-27 00:00 JST
		['2026-08-20T12:00:00Z', true], // 期間中
		['2026-09-01T00:00:00Z', false], // 終了後
	])('isTrialEndDateActiveJST(%s) → %s', (instant, expected) => {
		expect(isTrialEndDateActiveJST(END, new Date(instant))).toBe(expected);
	});

	it('trialDaysRemainingJST: 当日 = 0 / 前日 = 1 / 翌日 = -1 (JST 暦日差)', () => {
		expect(trialDaysRemainingJST(END, new Date('2026-08-26T14:59:59Z'))).toBe(0);
		expect(trialDaysRemainingJST(END, new Date('2026-08-24T15:00:00Z'))).toBe(1); // 08-25 00:00 JST
		expect(trialDaysRemainingJST(END, new Date('2026-08-25T15:00:00Z'))).toBe(0); // 08-26 00:00 JST (最終日)
		expect(trialDaysRemainingJST(END, new Date('2026-08-26T15:00:00Z'))).toBe(-1);
		expect(trialDaysRemainingJST(END, new Date('2026-08-19T03:00:00Z'))).toBe(7);
	});
});
