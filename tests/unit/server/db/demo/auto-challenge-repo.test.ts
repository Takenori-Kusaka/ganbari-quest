// tests/unit/server/db/demo/auto-challenge-repo.test.ts
// #2097 Phase B-4: demo Auto-Challenge Repo の Fake (read) + Stub (write) hybrid 検証。
// ADR-0048 §決定 §2 — fixture は immutable、write は no-op。

import { describe, expect, it } from 'vitest';
import * as autoChallengeRepo from '../../../../../src/lib/server/db/demo/auto-challenge-repo';
import { DEMO_AUTO_CHALLENGES } from '../../../../../src/lib/server/demo/demo-data';

// 当週 challenge を持つ全 4 子供 (901 baby は除外、ADR-0011 で親の準備モード)
const CHILD_IDS_WITH_CHALLENGE = [902, 903, 904, 906] as const;

describe('demo/auto-challenge-repo', () => {
	describe('findActiveByChild', () => {
		it.each(
			CHILD_IDS_WITH_CHALLENGE,
		)('child %i は当週 active challenge を返す', async (childId) => {
			const active = await autoChallengeRepo.findActiveByChild(childId, 'demo');
			expect(active).toBeDefined();
			expect(active?.childId).toBe(childId);
			expect(active?.status).toBe('active');
		});

		it('child 901 (baby) は active challenge を持たず undefined を返す', async () => {
			expect(await autoChallengeRepo.findActiveByChild(901, 'demo')).toBeUndefined();
		});

		it('未定義 child に対し undefined を返す', async () => {
			expect(await autoChallengeRepo.findActiveByChild(99999, 'demo')).toBeUndefined();
		});
	});

	describe('findByChildAndWeek', () => {
		it.each(
			CHILD_IDS_WITH_CHALLENGE,
		)('child %i の当週 weekStart で active challenge を取得できる', async (childId) => {
			const active = await autoChallengeRepo.findActiveByChild(childId, 'demo');
			expect(active).toBeDefined();
			if (!active) return;

			const found = await autoChallengeRepo.findByChildAndWeek(childId, active.weekStart, 'demo');
			expect(found).toBeDefined();
			expect(found?.id).toBe(active.id);
			expect(found?.weekStart).toBe(active.weekStart);
		});

		it('該当しない週は undefined を返す', async () => {
			expect(await autoChallengeRepo.findByChildAndWeek(902, '1990-01-01', 'demo')).toBeUndefined();
		});
	});

	describe('findByChild (履歴)', () => {
		it('child 902 は 2 件以上の履歴を持つ (当週 active + 過去 completed)', async () => {
			const history = await autoChallengeRepo.findByChild(902, 'demo');
			expect(history.length).toBeGreaterThanOrEqual(2);
			expect(history.every((c) => c.childId === 902)).toBe(true);
		});

		it('child 903 は 3 件の履歴を持つ (当週 active + 過去 2 週 completed)', async () => {
			const history = await autoChallengeRepo.findByChild(903, 'demo');
			expect(history).toHaveLength(3);
			expect(history.filter((c) => c.status === 'active')).toHaveLength(1);
			expect(history.filter((c) => c.status === 'completed')).toHaveLength(2);
		});

		it('child 904 は 3 件の履歴を持つ (当週 active + 過去 2 週 completed)', async () => {
			const history = await autoChallengeRepo.findByChild(904, 'demo');
			expect(history).toHaveLength(3);
		});

		it('child 906 は 2 件以上の履歴を持つ (当週 active + 過去 completed)', async () => {
			const history = await autoChallengeRepo.findByChild(906, 'demo');
			expect(history.length).toBeGreaterThanOrEqual(2);
		});

		it('weekStart desc で返る (sqlite 実装と整合)', async () => {
			const history = await autoChallengeRepo.findByChild(903, 'demo');
			for (let i = 1; i < history.length; i++) {
				const prev = history[i - 1];
				const curr = history[i];
				if (!prev || !curr) continue;
				expect(prev.weekStart >= curr.weekStart).toBe(true);
			}
		});

		it('limit を尊重する', async () => {
			const limited = await autoChallengeRepo.findByChild(903, 'demo', 1);
			expect(limited).toHaveLength(1);
		});

		it('未定義 child は空配列を返す', async () => {
			expect(await autoChallengeRepo.findByChild(99999, 'demo')).toEqual([]);
		});
	});

	describe('write API (Stub)', () => {
		it('insert は契約を満たすオブジェクトを返すが fixture を変更しない', async () => {
			const before = DEMO_AUTO_CHALLENGES.length;
			const beforeCount = DEMO_AUTO_CHALLENGES.find((c) => c.id === 9020)?.currentCount;

			const r = await autoChallengeRepo.insert(
				{ childId: 902, weekStart: '2099-12-28', categoryId: 1, targetCount: 5 },
				'demo',
			);
			expect(r.childId).toBe(902);
			expect(r.weekStart).toBe('2099-12-28');
			expect(r.targetCount).toBe(5);
			expect(r.currentCount).toBe(0);
			expect(r.status).toBe('active');
			expect(r.tenantId).toBe('demo');

			// ADR-0048 §決定 §2: fixture は immutable
			expect(DEMO_AUTO_CHALLENGES.length).toBe(before);
			expect(DEMO_AUTO_CHALLENGES.find((c) => c.id === 9020)?.currentCount).toBe(beforeCount);
		});

		it('update は no-op (例外を投げない)', async () => {
			await expect(
				autoChallengeRepo.update(9020, { currentCount: 999 }, 'demo'),
			).resolves.toBeUndefined();
			// fixture は変更されない
			expect(DEMO_AUTO_CHALLENGES.find((c) => c.id === 9020)?.currentCount).not.toBe(999);
		});

		it('expireOldChallenges は 0 を返す (stateless)', async () => {
			expect(await autoChallengeRepo.expireOldChallenges('2099-01-01', 'demo')).toBe(0);
		});

		it('deleteByTenantId は no-op', async () => {
			await expect(autoChallengeRepo.deleteByTenantId('demo')).resolves.toBeUndefined();
		});
	});
});
