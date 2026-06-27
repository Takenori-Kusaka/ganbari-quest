// tests/unit/server/db/sqlite/child-challenge-repo.test.ts
// per-child challenge instance repository (sqlite 実装) のユニットテスト (#2362 PR-7, ADR-0055, User §6)

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../../../src/lib/server/db/schema';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
} from '../../../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));

import {
	claimReward,
	copyAcrossChildren,
	deleteChallenge,
	findActiveByChildId,
	findActiveOrUnclaimedByChildId,
	findAllByTenant,
	findByChildId,
	findById,
	insert,
	insertBulk,
	markCompleted,
	updateProgress,
} from '../../../../../src/lib/server/db/sqlite/child-challenge-repo';
import type { InsertChildChallengeInput } from '../../../../../src/lib/server/db/types';

const TENANT = 'test-tenant';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

function resetDb() {
	resetAllTables(sqlite);
}

function seedChildren() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'たろう', age: 7, theme: 'sky' }).run();
	testDb.insert(schema.children).values({ nickname: 'はなこ', age: 5, theme: 'pink' }).run();
}

function buildInput(
	overrides: Partial<InsertChildChallengeInput> & { childId: number },
): InsertChildChallengeInput {
	return {
		childId: overrides.childId,
		title: overrides.title ?? 'みんなで頑張ろう',
		description: overrides.description ?? 'desc',
		challengeType: overrides.challengeType ?? 'cooperative',
		periodType: overrides.periodType ?? 'weekly',
		startDate: overrides.startDate ?? '2026-05-25',
		endDate: overrides.endDate ?? '2026-06-01',
		targetConfig: overrides.targetConfig ?? JSON.stringify({ metric: 'count', baseTarget: 5 }),
		rewardConfig: overrides.rewardConfig ?? JSON.stringify({ points: 50 }),
		sourceTemplateId: overrides.sourceTemplateId ?? null,
		targetValue: overrides.targetValue ?? 5,
	};
}

describe('sqlite/child-challenge-repo', () => {
	beforeEach(() => {
		seedChildren();
	});

	it('insert + findById で 1 件取得できる', async () => {
		const inserted = await insert(buildInput({ childId: 1 }), TENANT);
		expect(inserted.id).toBeGreaterThan(0);
		expect(inserted.childId).toBe(1);
		expect(inserted.currentValue).toBe(0);
		expect(inserted.completed).toBe(0);

		const found = await findById(inserted.id, TENANT);
		expect(found?.id).toBe(inserted.id);
		expect(found?.title).toBe('みんなで頑張ろう');
	});

	it('findByChildId は child scope の instance のみ返す', async () => {
		await insert(buildInput({ childId: 1, title: 'Aの' }), TENANT);
		await insert(buildInput({ childId: 1, title: 'Bの' }), TENANT);
		await insert(buildInput({ childId: 2, title: 'Cの' }), TENANT);

		const child1 = await findByChildId(1, TENANT);
		const child2 = await findByChildId(2, TENANT);
		expect(child1.length).toBe(2);
		expect(child2.length).toBe(1);
		expect(child2[0]?.title).toBe('Cの');
	});

	it('findActiveByChildId は today が start..end 範囲内かつ active のみ返す', async () => {
		await insert(
			buildInput({ childId: 1, startDate: '2026-05-20', endDate: '2026-05-30', title: 'active' }),
			TENANT,
		);
		await insert(
			buildInput({ childId: 1, startDate: '2026-05-20', endDate: '2026-05-22', title: 'past' }),
			TENANT,
		);
		const active = await findActiveByChildId(1, '2026-05-25', TENANT);
		expect(active.length).toBe(1);
		expect(active[0]?.title).toBe('active');
	});

	it('findAllByTenant は全 instance を返す', async () => {
		await insert(buildInput({ childId: 1 }), TENANT);
		await insert(buildInput({ childId: 2 }), TENANT);
		const all = await findAllByTenant(TENANT);
		expect(all.length).toBe(2);
	});

	it('insertBulk は複数 child に同時 insert', async () => {
		const inputs = [
			buildInput({ childId: 1, targetValue: 15 }),
			buildInput({ childId: 2, targetValue: 25 }),
		];
		const created = await insertBulk(inputs, TENANT);
		expect(created.length).toBe(2);
		expect(created[0]?.targetValue).toBe(15);
		expect(created[1]?.targetValue).toBe(25);
	});

	it('updateProgress + markCompleted で 進捗が更新される', async () => {
		const c = await insert(buildInput({ childId: 1, targetValue: 5 }), TENANT);
		await updateProgress(c.id, 3, TENANT);
		const after = await findById(c.id, TENANT);
		expect(after?.currentValue).toBe(3);
		expect(after?.completed).toBe(0);

		await markCompleted(c.id, TENANT);
		const completed = await findById(c.id, TENANT);
		expect(completed?.completed).toBe(1);
		expect(completed?.status).toBe('completed');
		expect(completed?.completedAt).toBeTruthy();
	});

	it('deleteChallenge で 1 件削除', async () => {
		const c = await insert(buildInput({ childId: 1 }), TENANT);
		await deleteChallenge(c.id, TENANT);
		const found = await findById(c.id, TENANT);
		expect(found).toBeUndefined();
	});

	it('copyAcrossChildren で source → target に 進捗 reset で複製', async () => {
		const src1 = await insert(
			buildInput({ childId: 1, title: '兄弟チャレンジ A', sourceTemplateId: 'tmpl' }),
			TENANT,
		);
		await updateProgress(src1.id, 3, TENANT); // source 側は進捗あり

		const copied = await copyAcrossChildren(1, 2, TENANT);
		expect(copied.length).toBe(1);
		expect(copied[0]?.childId).toBe(2);
		expect(copied[0]?.title).toBe('兄弟チャレンジ A');
		expect(copied[0]?.sourceTemplateId).toBe('tmpl'); // sourceTemplateId は維持
		expect(copied[0]?.currentValue).toBe(0); // 進捗はリセット
		expect(copied[0]?.completed).toBe(0);
	});

	// #2488 (must-1 fix): findActiveOrUnclaimedByChildId は status='completed' AND rewardClaimed=0 も返す
	it('findActiveOrUnclaimedByChildId は active + 完成済かつ未請求の instance を返す', async () => {
		// 3 種類の instance を投入: active / completed+unclaimed / completed+claimed
		const activeOne = await insert(
			buildInput({ childId: 1, startDate: '2026-05-20', endDate: '2026-05-30', title: 'active' }),
			TENANT,
		);
		const unclaimedCompleted = await insert(
			buildInput({
				childId: 1,
				startDate: '2026-05-20',
				endDate: '2026-05-30',
				title: 'unclaimed',
			}),
			TENANT,
		);
		await markCompleted(unclaimedCompleted.id, TENANT);

		const claimedCompleted = await insert(
			buildInput({
				childId: 1,
				startDate: '2026-05-20',
				endDate: '2026-05-30',
				title: 'claimed',
			}),
			TENANT,
		);
		await markCompleted(claimedCompleted.id, TENANT);
		await claimReward(claimedCompleted.id, TENANT);

		const result = await findActiveOrUnclaimedByChildId(1, '2026-05-25', TENANT);
		const titles = result.map((r) => r.title).sort();
		// active + unclaimed の 2 件のみ。claimed は除外
		expect(titles).toEqual(['active', 'unclaimed']);
		// 元の findActiveByChildId は active 1 件のみ返す (status=active filter)
		const activeOnly = await findActiveByChildId(1, '2026-05-25', TENANT);
		expect(activeOnly.length).toBe(1);
		expect(activeOnly[0]?.title).toBe('active');
		void activeOne; // ref
	});

	it('cross-child scope: childId が異なる instance は別 row', async () => {
		await insert(
			buildInput({ childId: 1, title: '同じタイトル', sourceTemplateId: 'shared-1' }),
			TENANT,
		);
		await insert(
			buildInput({ childId: 2, title: '同じタイトル', sourceTemplateId: 'shared-1' }),
			TENANT,
		);
		const all = await findAllByTenant(TENANT);
		expect(all.length).toBe(2);
		// 同じ sourceTemplateId を持つ instance が異なる childId で 2 件存在 (兄弟連動の基盤)
		const sharedInstances = all.filter((c) => c.sourceTemplateId === 'shared-1');
		expect(sharedInstances.length).toBe(2);
		expect(new Set(sharedInstances.map((c) => c.childId))).toEqual(new Set([1, 2]));
	});

	// #3284: claimReward は reward_claimed=0 の行のみ 0→1 に条件付き flip し、実際に flip したかを返す。
	// 並行 / 再試行の 2 回目は false を返す (= ledger 二重 insert を呼び出し側が防げる冪等ゲート)。
	describe('#3284 claimReward 冪等ゲート (二重付与防止)', () => {
		it('初回 claim は true、2 回目以降は false を返す (条件付き 0→1 flip)', async () => {
			const c = await insert(
				buildInput({
					childId: 1,
					title: 'claim-idem',
					startDate: '2026-06-01',
					endDate: '2026-06-07',
				}),
				TENANT,
			);
			await markCompleted(c.id, TENANT);

			const first = await claimReward(c.id, TENANT);
			expect(first).toBe(true); // 0→1 に flip

			const second = await claimReward(c.id, TENANT);
			expect(second).toBe(false); // 既に 1 → no-op (二重付与窓なし)

			const third = await claimReward(c.id, TENANT);
			expect(third).toBe(false);

			// flag は 1 のまま (冪等)
			const row = await findById(c.id, TENANT);
			expect(row?.rewardClaimed).toBe(1);
		});
	});
});
