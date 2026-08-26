// tests/unit/db/sqlite/once-only-notice-contract-4435.test.ts
//
// #4435 (#4432 の逸脱是正): 「一度見せたら次から出さない」媒体 A (行に timestamp 列) の
// 3 例が満たすべき条件を SQLite 実装 (挙動 SSOT) で固定する。
// 条件 SSOT: docs/design/parallel-implementations.md §13 / docs/rationale/17-once-only-notice-rationale.md
//
//   条件 1 冪等: 2 回目の mark で「最初に見せた時刻」を上書きしない
//   条件 2 所有権: 別の子の行を既読にできない (family_id だけでは同一家族の別の子を閉じられる)
//
// 検出力 (failing-test-first, ADR-0061):
//   - WHERE の `IS NULL` guard を外す → [C1]/[M1]/[R1] が fail (shownAt が上書きされる)
//   - 既読後の fallback SELECT を外す → [M2]/[R2] が fail (再送が not-found になり 404 化する)

import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestSqlite } from '../../helpers/test-db';

const dbHolder: { db: ReturnType<typeof createTestDb>['db'] | null; sqlite: TestSqlite | null } = {
	db: null,
	sqlite: null,
};

vi.mock('$lib/server/db/client', () => ({
	get db() {
		if (!dbHolder.db) throw new Error('test db not initialized');
		return dbHolder.db;
	},
}));

import { asChildId } from '$lib/domain/ids';
// import after mock
import { children, parentMessages, specialRewards } from '$lib/server/db/schema';
import { markMessageShown } from '$lib/server/db/sqlite/message-repo';
import { markRewardShown } from '$lib/server/db/sqlite/special-reward-repo';

const TENANT = 't-4435';

/** 先に入れた shownAt を「過去の時刻」として直接書き込むための固定値。 */
const FIRST_SHOWN_AT = '2025-01-02T03:04:05.000Z';

describe('#4435 媒体 A の冪等性 / 所有権 (SQLite 挙動 SSOT)', () => {
	let childA: number;
	let childB: number;

	beforeEach(() => {
		const { sqlite, db } = createTestDb();
		dbHolder.sqlite = sqlite;
		dbHolder.db = db;

		childA = db
			.insert(children)
			.values({ nickname: 'あに', age: 9, theme: 'default', uiMode: 'elementary' })
			.returning()
			.get().id;
		childB = db
			.insert(children)
			.values({ nickname: 'おとうと', age: 6, theme: 'default', uiMode: 'elementary' })
			.returning()
			.get().id;
	});

	const db = () => {
		if (!dbHolder.db) throw new Error('no db');
		return dbHolder.db;
	};

	// ── parent_messages ─────────────────────────────────────────────

	const seedMessage = (childId: number) =>
		db()
			.insert(parentMessages)
			.values({ childId, body: 'おつかれさま', messageType: 'text' })
			.returning()
			.get();

	it('[M1] メッセージの既読化は冪等 — 2 回目の mark が初回表示時刻を上書きしない', async () => {
		const msg = seedMessage(childB);
		await markMessageShown(asChildId(childB), String(msg.id), TENANT);
		db()
			.update(parentMessages)
			.set({ shownAt: FIRST_SHOWN_AT })
			.where(eq(parentMessages.id, msg.id))
			.run();

		await markMessageShown(asChildId(childB), String(msg.id), TENANT);

		expect(db().select().from(parentMessages).get()?.shownAt).toBe(FIRST_SHOWN_AT);
	});

	it('[M2] 既読済みの再送は「見つからない」ではなく行を返す (所有権 404 と冪等の両立)', async () => {
		const msg = seedMessage(childB);
		await markMessageShown(asChildId(childB), String(msg.id), TENANT);

		// 再送 (postShown の retry) は成功扱い = 行が返る
		expect(await markMessageShown(asChildId(childB), String(msg.id), TENANT)).toBeTruthy();
		// 他人の子として送れば依然 undefined (= endpoint 404)
		expect(await markMessageShown(asChildId(childA), String(msg.id), TENANT)).toBeUndefined();
	});

	// ── special_rewards ─────────────────────────────────────────────

	const seedReward = (childId: number) =>
		db()
			.insert(specialRewards)
			.values({ childId, title: 'ごほうび', points: 10, category: 'privilege' })
			.returning()
			.get();

	it('[R1] 特別報酬の既読化は冪等 — 2 回目の mark が初回表示時刻を上書きしない', async () => {
		const reward = seedReward(childB);
		await markRewardShown(asChildId(childB), String(reward.id), TENANT);
		db()
			.update(specialRewards)
			.set({ shownAt: FIRST_SHOWN_AT })
			.where(eq(specialRewards.id, reward.id))
			.run();

		await markRewardShown(asChildId(childB), String(reward.id), TENANT);

		expect(db().select().from(specialRewards).get()?.shownAt).toBe(FIRST_SHOWN_AT);
	});

	it('[R2] 既読済みの再送は行を返し、別の子からの mark は undefined のまま', async () => {
		const reward = seedReward(childB);
		await markRewardShown(asChildId(childB), String(reward.id), TENANT);
		db()
			.update(specialRewards)
			.set({ shownAt: FIRST_SHOWN_AT })
			.where(eq(specialRewards.id, reward.id))
			.run();

		// 再送 (postShown の retry) は成功扱い = 行が返り、初回時刻を保ったまま返す
		const resent = await markRewardShown(asChildId(childB), String(reward.id), TENANT);
		expect(resent?.shownAt).toBe(FIRST_SHOWN_AT);
		// 他人の子として送れば既読済みでも undefined (= endpoint 404、所有権シグナルが生きている)
		expect(await markRewardShown(asChildId(childA), String(reward.id), TENANT)).toBeUndefined();
		// 他の子の mark で shownAt が動いていないことを DB 側でも確認する
		const row = db()
			.select()
			.from(specialRewards)
			.where(and(eq(specialRewards.id, reward.id), eq(specialRewards.childId, childB)))
			.get();
		expect(row?.shownAt).toBe(FIRST_SHOWN_AT);
	});
});
