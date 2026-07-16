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

import { asChildId, type ChildId } from '$lib/domain/ids';
import {
	claimRewardAndGrantPoints,
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
	overrides: Partial<InsertChildChallengeInput> & { childId: ChildId },
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
		const inserted = await insert(buildInput({ childId: asChildId(1) }), TENANT);
		expect(Number(inserted.id)).toBeGreaterThan(0);
		expect(inserted.childId).toBe('1');
		expect(inserted.currentValue).toBe(0);
		expect(inserted.completed).toBe(0);

		const found = await findById(inserted.id, TENANT);
		expect(found?.id).toBe(inserted.id);
		expect(found?.title).toBe('みんなで頑張ろう');
	});

	it('findByChildId は child scope の instance のみ返す', async () => {
		await insert(buildInput({ childId: asChildId(1), title: 'Aの' }), TENANT);
		await insert(buildInput({ childId: asChildId(1), title: 'Bの' }), TENANT);
		await insert(buildInput({ childId: asChildId(2), title: 'Cの' }), TENANT);

		const child1 = await findByChildId(asChildId(1), TENANT);
		const child2 = await findByChildId(asChildId(2), TENANT);
		expect(child1.length).toBe(2);
		expect(child2.length).toBe(1);
		expect(child2[0]?.title).toBe('Cの');
	});

	it('findActiveByChildId は today が start..end 範囲内かつ active のみ返す', async () => {
		await insert(
			buildInput({
				childId: asChildId(1),
				startDate: '2026-05-20',
				endDate: '2026-05-30',
				title: 'active',
			}),
			TENANT,
		);
		await insert(
			buildInput({
				childId: asChildId(1),
				startDate: '2026-05-20',
				endDate: '2026-05-22',
				title: 'past',
			}),
			TENANT,
		);
		const active = await findActiveByChildId(asChildId(1), '2026-05-25', TENANT);
		expect(active.length).toBe(1);
		expect(active[0]?.title).toBe('active');
	});

	it('findAllByTenant は全 instance を返す', async () => {
		await insert(buildInput({ childId: asChildId(1) }), TENANT);
		await insert(buildInput({ childId: asChildId(2) }), TENANT);
		const all = await findAllByTenant(TENANT);
		expect(all.length).toBe(2);
	});

	it('insertBulk は複数 child に同時 insert', async () => {
		const inputs = [
			buildInput({ childId: asChildId(1), targetValue: 15 }),
			buildInput({ childId: asChildId(2), targetValue: 25 }),
		];
		const created = await insertBulk(inputs, TENANT);
		expect(created.length).toBe(2);
		expect(created[0]?.targetValue).toBe(15);
		expect(created[1]?.targetValue).toBe(25);
	});

	it('updateProgress + markCompleted で 進捗が更新される', async () => {
		const c = await insert(buildInput({ childId: asChildId(1), targetValue: 5 }), TENANT);
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
		const c = await insert(buildInput({ childId: asChildId(1) }), TENANT);
		await deleteChallenge(c.id, TENANT);
		const found = await findById(c.id, TENANT);
		expect(found).toBeUndefined();
	});

	it('copyAcrossChildren で source → target に 進捗 reset で複製', async () => {
		const src1 = await insert(
			buildInput({ childId: asChildId(1), title: '兄弟チャレンジ A', sourceTemplateId: 'tmpl' }),
			TENANT,
		);
		await updateProgress(src1.id, 3, TENANT); // source 側は進捗あり

		const copied = await copyAcrossChildren(asChildId(1), asChildId(2), TENANT);
		expect(copied.length).toBe(1);
		expect(copied[0]?.childId).toBe('2');
		expect(copied[0]?.title).toBe('兄弟チャレンジ A');
		expect(copied[0]?.sourceTemplateId).toBe('tmpl'); // sourceTemplateId は維持
		expect(copied[0]?.currentValue).toBe(0); // 進捗はリセット
		expect(copied[0]?.completed).toBe(0);
	});

	// #2488 (must-1 fix): findActiveOrUnclaimedByChildId は status='completed' AND rewardClaimed=0 も返す
	it('findActiveOrUnclaimedByChildId は active + 完成済かつ未請求の instance を返す', async () => {
		// 3 種類の instance を投入: active / completed+unclaimed / completed+claimed
		const activeOne = await insert(
			buildInput({
				childId: asChildId(1),
				startDate: '2026-05-20',
				endDate: '2026-05-30',
				title: 'active',
			}),
			TENANT,
		);
		const unclaimedCompleted = await insert(
			buildInput({
				childId: asChildId(1),
				startDate: '2026-05-20',
				endDate: '2026-05-30',
				title: 'unclaimed',
			}),
			TENANT,
		);
		await markCompleted(unclaimedCompleted.id, TENANT);

		const claimedCompleted = await insert(
			buildInput({
				childId: asChildId(1),
				startDate: '2026-05-20',
				endDate: '2026-05-30',
				title: 'claimed',
			}),
			TENANT,
		);
		await markCompleted(claimedCompleted.id, TENANT);
		await claimRewardAndGrantPoints(
			claimedCompleted.id,
			{ childId: asChildId(1), amount: 50, description: 'claimed' },
			TENANT,
		);

		const result = await findActiveOrUnclaimedByChildId(asChildId(1), '2026-05-25', TENANT);
		const titles = result.map((r) => r.title).sort();
		// active + unclaimed の 2 件のみ。claimed は除外
		expect(titles).toEqual(['active', 'unclaimed']);
		// 元の findActiveByChildId は active 1 件のみ返す (status=active filter)
		const activeOnly = await findActiveByChildId(asChildId(1), '2026-05-25', TENANT);
		expect(activeOnly.length).toBe(1);
		expect(activeOnly[0]?.title).toBe('active');
		void activeOne; // ref
	});

	it('cross-child scope: childId が異なる instance は別 row', async () => {
		await insert(
			buildInput({ childId: asChildId(1), title: '同じタイトル', sourceTemplateId: 'shared-1' }),
			TENANT,
		);
		await insert(
			buildInput({ childId: asChildId(2), title: '同じタイトル', sourceTemplateId: 'shared-1' }),
			TENANT,
		);
		const all = await findAllByTenant(TENANT);
		expect(all.length).toBe(2);
		// 同じ sourceTemplateId を持つ instance が異なる childId で 2 件存在 (兄弟連動の基盤)
		const sharedInstances = all.filter((c) => c.sourceTemplateId === 'shared-1');
		expect(sharedInstances.length).toBe(2);
		expect(new Set(sharedInstances.map((c) => c.childId))).toEqual(new Set(['1', '2']));
	});

	// #3284 / #3342 (#3333 の後継): flip + ledger insert の単一原子 primitive を better-sqlite3 の
	// 実 DB で検証する。ledger 行 (type='child_challenge' / reference_id=挑戦 id) が flip と同 txn で
	// 書かれ、二重 claim では ledger が増えない (= ポイント二重付与不能) こと、および ledger insert
	// 失敗時に flip ごと rollback される (両成功 or 両 rollback、lost-award 根治) ことを assert する。
	describe('claimRewardAndGrantPoints — flip + ledger 単一 txn (#3284/#3342)', () => {
		const ledgerRows = (challengeId: string) =>
			sqlite
				.prepare(
					"SELECT child_id, amount, type, reference_id FROM point_ledger WHERE type = 'child_challenge' AND reference_id = ?",
				)
				.all(Number(challengeId)) as {
				child_id: number;
				amount: number;
				type: string;
				reference_id: number;
			}[];

		it('completed=1 && 未請求 → 1 回目は flip + ledger 1 行、2 回目は 0 で ledger 増えない (二重付与不能)', async () => {
			const c = await insert(buildInput({ childId: asChildId(1), title: 'claim-atomic' }), TENANT);
			await markCompleted(c.id, TENANT);

			const first = await claimRewardAndGrantPoints(
				c.id,
				{ childId: asChildId(1), amount: 50, description: 'チャレンジ達成: claim-atomic' },
				TENANT,
			);
			expect(first).toBe(1);
			expect(ledgerRows(c.id)).toEqual([
				{ child_id: 1, amount: 50, type: 'child_challenge', reference_id: Number(c.id) },
			]);

			const second = await claimRewardAndGrantPoints(
				c.id,
				{ childId: asChildId(1), amount: 50, description: 'チャレンジ達成: claim-atomic' },
				TENANT,
			);
			expect(second).toBe(0);
			// AC (#3284): 同一 challenge を 2 回 claim → ledger は 1 行のみ (balance 1 回分)
			expect(ledgerRows(c.id)).toHaveLength(1);

			const after = await findById(c.id, TENANT);
			expect(after?.rewardClaimed).toBe(1);
		});

		it('未完了 (completed=0) → 条件不成立で 0 (ledger 無書込)', async () => {
			const c = await insert(buildInput({ childId: asChildId(1), title: 'not-completed' }), TENANT);
			const changed = await claimRewardAndGrantPoints(
				c.id,
				{ childId: asChildId(1), amount: 50, description: 'x' },
				TENANT,
			);
			expect(changed).toBe(0);
			expect(ledgerRows(c.id)).toHaveLength(0);
			const after = await findById(c.id, TENANT);
			expect(after?.rewardClaimed).toBe(0);
		});

		// #3342 (1) lost-award 根治の本丸: ledger insert が失敗 (冪等 UNIQUE 違反 #3284 を利用して
		// 意図的に誘発) した場合、flip も rollback され rewardClaimed=0 のまま = 再 claim 可能。
		// 旧 2 段構成では flip=1 が確定した後に ledger が throw し「恒久受取不能」になっていた。
		it('ledger insert 失敗時は flip ごと rollback (両成功 or 両 rollback、lost-award 根治)', async () => {
			const c = await insert(buildInput({ childId: asChildId(1), title: 'rollback' }), TENANT);
			await markCompleted(c.id, TENANT);
			// 事前に同一冪等キー (child, 'child_challenge', reference=c.id) の ledger 行を仕込み、
			// primitive 内の ledger insert を UNIQUE 違反で失敗させる
			sqlite
				.prepare(
					"INSERT INTO point_ledger (child_id, amount, type, description, reference_id) VALUES (1, 50, 'child_challenge', 'pre-existing', ?)",
				)
				.run(Number(c.id));

			await expect(
				claimRewardAndGrantPoints(
					c.id,
					{ childId: asChildId(1), amount: 50, description: 'dup' },
					TENANT,
				),
			).rejects.toThrow();

			// flip は rollback され未請求のまま (lost-award にならない)
			const after = await findById(c.id, TENANT);
			expect(after?.rewardClaimed).toBe(0);
			// ledger は事前 1 行のみ (二重付与なし)
			expect(ledgerRows(c.id)).toHaveLength(1);
		});
	});
});

// #3284 AC: point_ledger の冪等キー (child_id, type, reference_id) を DB 層 (部分 UNIQUE index)
// が強制することを実 DB で検証する。referenceId 無しの付与 (combo / daily_mission 等) は制約対象外。
describe('point_ledger 冪等キー (idx_point_ledger_idempotency、#3284)', () => {
	beforeEach(() => {
		seedChildren();
	});

	it('同一 (child, type, reference) の 2 回目 insert は UNIQUE 違反で拒否される', () => {
		const stmt = sqlite.prepare(
			"INSERT INTO point_ledger (child_id, amount, type, description, reference_id) VALUES (1, 30, 'child_challenge', 'grant', 77)",
		);
		stmt.run();
		expect(() => stmt.run()).toThrow(/UNIQUE/);
		const rows = sqlite
			.prepare("SELECT COUNT(*) AS c FROM point_ledger WHERE type = 'child_challenge'")
			.get() as { c: number };
		expect(rows.c).toBe(1);
	});

	it('reference_id が NULL の付与 (combo 等) は複数 insert 可能 (部分 index 対象外)', () => {
		const stmt = sqlite.prepare(
			"INSERT INTO point_ledger (child_id, amount, type, description, reference_id) VALUES (1, 10, 'combo_bonus', 'combo', NULL)",
		);
		stmt.run();
		expect(() => stmt.run()).not.toThrow();
	});

	it('type が異なれば同一 (child, reference) でも insert 可能 (activity ログと cancel の対)', () => {
		sqlite
			.prepare(
				"INSERT INTO point_ledger (child_id, amount, type, description, reference_id) VALUES (1, 20, 'activity', 'earn', 5)",
			)
			.run();
		expect(() =>
			sqlite
				.prepare(
					"INSERT INTO point_ledger (child_id, amount, type, description, reference_id) VALUES (1, -20, 'cancel', 'キャンセル', 5)",
				)
				.run(),
		).not.toThrow();
	});
});
