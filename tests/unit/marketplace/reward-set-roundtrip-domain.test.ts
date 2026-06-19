// tests/unit/marketplace/reward-set-roundtrip-domain.test.ts
// #3132: reward の points 値域が「アプリが許容する domain 値域 ⊆ export schema 値域」を満たし、
// export → restore round-trip が境界値で破綻しないことを固定する (統合 blocker #3131 の回帰防止)。
//
// 旧 bug: E2E seed が直接 SQL で points=99999 (domain 上限 10000 超過) を投入し、
// export → restore が reward-set-schema (maxValue 10000) の検証エラーで round-trip 破綻。
// domain (grantSpecialRewardSchema) と export schema (reward-set) の points 上限が一致することを
// assert し、片方だけ変えた場合に CI で検出する。

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { grantSpecialRewardSchema, REWARD_CATEGORIES } from '$lib/domain/validation/special-reward';
import { RewardSetPayloadSchema } from '$lib/marketplace/schemas/reward-set-schema';

const CAT = REWARD_CATEGORIES[0];
const POINTS_MAX = 10000;

const rewardSetPayload = (points: number) => ({
	rewards: [{ title: 'テスト', points, icon: '🎁', category: CAT }],
});
const domainReward = (points: number) => ({ childId: 1, title: 'テスト', points, category: CAT });

describe('#3132 reward points 値域: domain ⊆ export schema (round-trip 整合)', () => {
	it('export schema (reward-set) は points=10000 (上限境界) を受理する', () => {
		expect(v.safeParse(RewardSetPayloadSchema, rewardSetPayload(POINTS_MAX)).success).toBe(true);
	});

	it('export schema は points=10001 (上限超過) を拒否する', () => {
		expect(v.safeParse(RewardSetPayloadSchema, rewardSetPayload(POINTS_MAX + 1)).success).toBe(
			false,
		);
	});

	it('domain (grantSpecialRewardSchema) も points=10000 受理 / 10001 拒否 (export schema と同一上限)', () => {
		expect(grantSpecialRewardSchema.safeParse(domainReward(POINTS_MAX)).success).toBe(true);
		expect(grantSpecialRewardSchema.safeParse(domainReward(POINTS_MAX + 1)).success).toBe(false);
	});

	it('round-trip 不変条件: アプリが許容する最大 reward (domain max) は export schema を必ず通る', () => {
		// domain が受理する最大 points は export schema でも受理される (= domain 値域 ⊆ export schema 値域)。
		// どちらか一方の上限を変更すると本 test が落ち、round-trip 破綻の再混入を CI で検出する。
		expect(grantSpecialRewardSchema.safeParse(domainReward(POINTS_MAX)).success).toBe(true);
		expect(v.safeParse(RewardSetPayloadSchema, rewardSetPayload(POINTS_MAX)).success).toBe(true);
	});
});
