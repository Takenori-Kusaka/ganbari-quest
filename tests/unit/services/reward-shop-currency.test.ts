// #4172 — 「ごほうびショップに商品を置く」ことと「子供にポイントを渡す」ことを分離する。
//
// ## 何が起きていたか
//
// `special_rewards` は**ごほうびショップの棚そのもの**（`26-ゲーミフィケーション設計書.md §12`）。
// ところが棚に 1 行 INSERT する経路が、同時に `point_ledger` へ同額を加算していた。
//
//   - 親が「ゲーム 30 分 = 500pt」を陳列する → **子供の残高が 500pt 増える**
//     → ごほうびが自分の代金を自分で払う。「活動して貯める」という経済が成立しない
//   - 活動 5 回ごとに `${n}かいきろく達成！` が**自動で棚に並び**、同時に 50pt が発行される
//     → 親が一度も関与しない商品 (`grantedBy: null`) が、親の陳列物と同じ棚に積まれ続ける
//
// 同じ棚に載る 3 経路でポイント加算の有無が食い違っていたことが、取り違えの証拠になっている。
// marketplace 取込だけは「大量の点数を一気に与えるのは設計上望ましくない」として
// **意図的に加算を外していた**（`reward-set-import-service.ts`）。
//
// ## なぜ既存テストが 1 件も落ちなかったか
//
// `special-reward-service.test.ts` に**残高を検証する assertion が 0 件**だった。
// 棚への INSERT は検証されていたが、その副作用である通貨発行は誰も見ていなかった。
//
// 本 file はその欠落を埋める。ADR-0061 failing-test-first: 修正前に落ちることを確認してから直す。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import * as schema from '../../../src/lib/server/db/schema';
import { assertSuccess } from '../helpers/assert-result';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
} from '../helpers/test-db';

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

import { getBalance } from '../../../src/lib/server/db/point-repo';
import {
	addReward,
	getChildSpecialRewards,
	SPECIAL_REWARD_INTERVAL,
} from '../../../src/lib/server/services/special-reward-service';

const TENANT = 'default';
const CHILD = asChildId(1);

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

beforeEach(() => {
	resetAllTables(sqlite);
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 8, theme: 'blue' }).run();
	testDb
		.insert(schema.childActivities)
		.values({ childId: 1, name: 'てつだい', categoryId: 1, icon: '🧹', basePoints: 10 })
		.run();
});

/**
 * 旧実装は `countActiveActivityLogs() % SPECIAL_REWARD_INTERVAL === 0` でのみ発火したため、
 * **記録が実在しないと何も起きず、テストが空振りで緑になる**（初版で踏んだ）。
 * 機構は撤去済だが、発火条件だけは与えたうえで「何も起きない」ことを確かめる。
 */
function seedActivityLogs(count: number): void {
	for (let i = 0; i < count; i++) {
		testDb
			.insert(schema.activityLogs)
			.values({ childId: 1, activityId: 1, points: 10, recordedDate: `2026-08-0${i + 1}` })
			.run();
	}
}

describe('#4172 ショップへの陳列は通貨を発行しない', () => {
	it('[RC1] 親がごほうびを棚に置いても、子供の残高は変わらない', async () => {
		const before = await getBalance(CHILD, TENANT);

		assertSuccess(
			await addReward(
				{
					childId: CHILD,
					grantedBy: 'parent-1',
					title: 'ゲーム 30 分',
					points: 500,
					category: 'other',
				},
				TENANT,
			),
		);

		// 「棚に置く」= 商品の陳列。子供が活動して貯めた残高とは無関係でなければならない。
		expect(
			await getBalance(CHILD, TENANT),
			'ごほうびを陳列しただけで残高が増えています (ごほうびが自分の代金を自分で払っている)',
		).toBe(before);
	});

	it('[RC2] 棚には並ぶ (陳列そのものは壊していない)', async () => {
		assertSuccess(
			await addReward(
				{
					childId: CHILD,
					grantedBy: 'parent-1',
					title: 'ゲーム 30 分',
					points: 500,
					category: 'other',
				},
				TENANT,
			),
		);

		// [RC1] を「INSERT ごと消す」ことで通してしまわないよう、棚への陳列は残ることを固定する。
		const { rewards } = await getChildSpecialRewards(CHILD, TENANT);
		expect(rewards.map((r) => r.title)).toContain('ゲーム 30 分');
	});

	it('[RC3] 活動記録の経路から自動ごほうび生成が消えている', () => {
		// **初版は撤去した関数を直接呼んで `toBeNull()` を assert していた。**
		// その形だと「常に null を返す殻」を残さないと通らず、**呼出元 0 の関数が
		// 契約テストのためだけに生き残る** — この Issue が問題視した構造そのものになる。
		//
		// 実際に守りたいのは「活動を記録しても棚と残高が動かない」であり、それは
		// **記録経路が生成機構を呼ばないこと**で成り立つ。そこを直接固定する。
		for (const path of [
			'src/lib/server/services/activity-log-service.ts',
			'src/lib/server/services/activity-record-dsql.ts',
		]) {
			const src = readFileSync(join(process.cwd(), path), 'utf-8');
			expect(src, `${path} が自動ごほうび生成を呼んでいます`).not.toContain(
				'checkAndGrantFixedIntervalReward',
			);
		}

		const service = readFileSync(
			join(process.cwd(), 'src/lib/server/services/special-reward-service.ts'),
			'utf-8',
		);
		// 殻ごと消えていること (再追加も、null を返すだけの残置も許さない)。
		expect(service, '自動ごほうび生成が service 側に残っています').not.toContain(
			'checkAndGrantFixedIntervalReward',
		);
		expect(service, '自動生成カテゴリの書き込みが残っています').not.toMatch(
			/insertSpecialReward\([^)]*auto_milestone/s,
		);
	});

	it('[RC3b] 活動記録が積まれても棚と残高は動かない', async () => {
		seedActivityLogs(SPECIAL_REWARD_INTERVAL);

		expect(
			(await getChildSpecialRewards(CHILD, TENANT)).rewards.length,
			'活動記録の回数だけで、親が置いていない商品が棚に増えています',
		).toBe(0);
		expect(
			await getBalance(CHILD, TENANT),
			'達成表現が独立した通貨を発行しています (§2.4 唯一の出口はごほうびショップのみ)',
		).toBe(0);
	});

	it('[RC4] 既に生成された auto_milestone の行は、子供の棚に出ない', async () => {
		// 既存家庭の棚は既に汚れている。物理削除は履歴を壊すので、表示から除外する (AC4)。
		testDb
			.insert(schema.specialRewards)
			.values({
				childId: 1,
				grantedBy: null,
				title: '365かいきろく達成！',
				points: 50,
				icon: '🎁',
				category: 'auto_milestone',
			})
			.run();

		const shop = await getChildSpecialRewards(CHILD, TENANT);
		expect(
			shop.rewards.map((r) => r.title),
			'過去に自動生成された記念が、親の陳列物と同じ棚に並んだままです',
		).not.toContain('365かいきろく達成！');
	});
});
