// tests/unit/server/db/demo/sibling-challenge-repo.test.ts
// #2097 Phase B-5b: sibling-challenge fixture が読み出せること、active challenge と
// 進捗が demo きょうだいチャレンジ画面で表示されることを検証。

import { describe, expect, it } from 'vitest';
import * as siblingChallengeRepo from '../../../../../src/lib/server/db/demo/sibling-challenge-repo';
import {
	DEMO_SIBLING_CHALLENGE_PROGRESSES,
	DEMO_SIBLING_CHALLENGES,
	TODAY,
} from '../../../../../src/lib/server/demo/demo-data';

describe('demo/sibling-challenge-repo (Phase B-5b)', () => {
	it('DEMO_SIBLING_CHALLENGES fixture は active + completed を含む', () => {
		expect(DEMO_SIBLING_CHALLENGES.length).toBeGreaterThanOrEqual(2);
		expect(DEMO_SIBLING_CHALLENGES.some((c) => c.status === 'active')).toBe(true);
		expect(DEMO_SIBLING_CHALLENGES.some((c) => c.status === 'completed')).toBe(true);
	});

	it('DEMO_SIBLING_CHALLENGE_PROGRESSES fixture は 8 件以上 (active 2 challenge × 4 子供)', () => {
		expect(DEMO_SIBLING_CHALLENGE_PROGRESSES.length).toBeGreaterThanOrEqual(8);
	});

	it('findAllChallenges は fixture 全件を返す', async () => {
		const challenges = await siblingChallengeRepo.findAllChallenges('demo');
		expect(challenges.length).toBe(DEMO_SIBLING_CHALLENGES.length);
	});

	it('findActiveChallenges (TODAY) は active かつ期間内 challenge のみ返す', async () => {
		const active = await siblingChallengeRepo.findActiveChallenges(TODAY, 'demo');
		expect(active.length).toBeGreaterThan(0);
		expect(active.every((c) => c.isActive === 1)).toBe(true);
		expect(active.every((c) => c.startDate <= TODAY && TODAY <= c.endDate)).toBe(true);
	});

	it('findActiveChallenges (遠い未来) は空 (期間外)', async () => {
		const active = await siblingChallengeRepo.findActiveChallenges('2099-01-01', 'demo');
		expect(active).toEqual([]);
	});

	it('findChallengeById は existing id で SiblingChallenge を返す', async () => {
		const challenge = await siblingChallengeRepo.findChallengeById(1, 'demo');
		expect(challenge).toBeDefined();
		expect(challenge?.id).toBe(1);
	});

	it('findChallengeById は 未登録 id で undefined', async () => {
		expect(await siblingChallengeRepo.findChallengeById(99999, 'demo')).toBeUndefined();
	});

	it('findProgressByChallenge は challengeId=1 で 4 子供分 (active enroll) を返す', async () => {
		const progresses = await siblingChallengeRepo.findProgressByChallenge(1, 'demo');
		expect(progresses.length).toBeGreaterThanOrEqual(4);
		expect(progresses.every((p) => p.challengeId === 1)).toBe(true);
	});

	it('findProgressByChild は 904 (junior、全 active 参加) で複数件返す', async () => {
		const progresses = await siblingChallengeRepo.findProgressByChild(904, 'demo');
		expect(progresses.length).toBeGreaterThanOrEqual(2);
		expect(progresses.every((p) => p.childId === 904)).toBe(true);
	});

	it('findProgress は (challengeId, childId) ペアで進捗を返す', async () => {
		const progress = await siblingChallengeRepo.findProgress(1, 904, 'demo');
		expect(progress).toBeDefined();
		expect(progress?.challengeId).toBe(1);
		expect(progress?.childId).toBe(904);
	});

	it('insertChallenge は input を SiblingChallenge として返す (no-op)', async () => {
		const before = DEMO_SIBLING_CHALLENGES.length;
		const challenge = await siblingChallengeRepo.insertChallenge(
			{
				title: 'test',
				startDate: '2026-04-01',
				endDate: '2026-04-07',
				targetConfig: '{}',
				rewardConfig: '{}',
			},
			'demo',
		);
		expect(challenge.title).toBe('test');
		// ADR-0048 §決定 §2: fixture immutable
		expect(DEMO_SIBLING_CHALLENGES.length).toBe(before);
	});
});
