/**
 * tests/unit/db/dynamodb-battle-repo.test.ts
 *
 * #2824 Wave 5A / ADR-0055: DynamoDB battle-repo 本実装の単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/battle-repo.ts、挙動 SSOT) と
 * 機能等価であることを method ごとに検証する:
 *   - 正しい Command + key で send する (child partition battle / enemy collection)
 *   - response を正しく型変換する (stripKeys / SQLite default 補完)
 *   - SQLite 機能等価 (findTodayBattle GetItem / findRecentBattles 降順 limit /
 *     countConsecutiveLosses の completed 先頭 5 件 lose 連続 / insertDailyBattle default /
 *     completeBattle の battleId Scan 解決 / upsertCollectionEntry の存在分岐 ADD/Put /
 *     deleteByTenantId 2 経路)
 *
 * 背景: 本 repo は #2263 hotfix (PR #2280) で read=空 / write=no-op 化され、LP machine-tour ④
 *   feature-rpg-battle 訴求の日次バトル進行・勝敗・ポイント報酬・敵図鑑が本番 DynamoDB Lambda で
 *   永続せず、毎アクセスで未挑戦に戻り報酬も図鑑も消える状態だった。本テストは本実装の機能
 *   等価性を回帰固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AWS SDK Mock (vi.hoisted で先にモック関数と Command クラスを確保)
const {
	mockSend,
	MockGetCommand,
	MockPutCommand,
	MockQueryCommand,
	MockUpdateCommand,
	MockScanCommand,
} = vi.hoisted(() => {
	const send = vi.fn();
	class Cmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	return {
		mockSend: send,
		MockGetCommand: class extends Cmd {},
		MockPutCommand: class extends Cmd {},
		MockQueryCommand: class extends Cmd {},
		MockUpdateCommand: class extends Cmd {},
		MockScanCommand: class extends Cmd {},
	};
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
	DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
	GetCommand: MockGetCommand,
	PutCommand: MockPutCommand,
	QueryCommand: MockQueryCommand,
	UpdateCommand: MockUpdateCommand,
	ScanCommand: MockScanCommand,
	// bulk-delete.ts が import する Command。deleteByTenantId 経路で使用。
	BatchWriteCommand: class {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	},
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/battle-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;
const DATE = '2026-06-01';
const BATTLE_ID = 7;
const ENEMY_ID = 3;

/** child partition の daily_battle DynamoDB item を組み立てる。 */
function makeBattleItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const id = (over.id as number) ?? BATTLE_ID;
	const date = (over.date as string) ?? DATE;
	return {
		PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
		SK: `BATTLE#${date}`,
		id,
		childId: CHILD_ID,
		enemyId: ENEMY_ID,
		date,
		status: 'pending',
		outcome: null,
		rewardPoints: 0,
		turnsUsed: 0,
		playerStatsJson: '{"hp":100,"atk":10,"def":5,"spd":5,"rec":2}',
		createdAt: '2026-06-01T00:00:00.000Z',
		updatedAt: '2026-06-01T00:00:00.000Z',
		...over,
	};
}

/** child partition の enemy_collection DynamoDB item を組み立てる。 */
function makeCollectionItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const enemyId = (over.enemyId as number) ?? ENEMY_ID;
	return {
		PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
		SK: `ENEMYCOL#${String(enemyId).padStart(8, '0')}`,
		id: 1,
		childId: CHILD_ID,
		enemyId,
		firstDefeatedAt: '2026-06-01T09:00:00.000Z',
		defeatCount: 1,
		...over,
	};
}

beforeEach(() => {
	mockSend.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

// ============================================================
// findTodayBattle
// ============================================================

describe('findTodayBattle', () => {
	it('child + date key で GetItem する', async () => {
		mockSend.mockResolvedValueOnce({ Item: makeBattleItem() });
		const { findTodayBattle } = await loadRepo();
		const battle = await findTodayBattle(CHILD_ID, DATE, TENANT);
		expect(battle?.id).toBe(BATTLE_ID);
		expect(battle?.date).toBe(DATE);
		const callArg = mockSend.mock.calls[0]?.[0] as { input: { Key?: { PK: string; SK: string } } };
		expect(callArg.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(callArg.input.Key?.SK).toBe(`BATTLE#${DATE}`);
	});

	it('不在のとき undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({ Item: undefined });
		const { findTodayBattle } = await loadRepo();
		expect(await findTodayBattle(CHILD_ID, DATE, TENANT)).toBeUndefined();
	});

	it('outcome / rewardPoints / turnsUsed 欠落 item を SQLite default に補完する', async () => {
		const item = makeBattleItem();
		delete item.outcome;
		delete item.rewardPoints;
		delete item.turnsUsed;
		mockSend.mockResolvedValueOnce({ Item: item });
		const { findTodayBattle } = await loadRepo();
		const battle = await findTodayBattle(CHILD_ID, DATE, TENANT);
		expect(battle?.outcome).toBeNull();
		expect(battle?.rewardPoints).toBe(0);
		expect(battle?.turnsUsed).toBe(0);
	});
});

// ============================================================
// findRecentBattles
// ============================================================

describe('findRecentBattles', () => {
	it('child partition を SK 降順 (date desc) で Query し limit を渡す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeBattleItem({ id: 9, date: '2026-06-03' }),
				makeBattleItem({ id: 8, date: '2026-06-02' }),
			],
		});
		const { findRecentBattles } = await loadRepo();
		const battles = await findRecentBattles(CHILD_ID, 10, TENANT);
		expect(battles.map((b) => b.id)).toEqual([9, 8]);
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: {
				ScanIndexForward?: boolean;
				Limit?: number;
				ExpressionAttributeValues?: Record<string, string>;
			};
		};
		// desc(date) = SK 降順。
		expect(callArg.input.ScanIndexForward).toBe(false);
		expect(callArg.input.Limit).toBe(10);
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(callArg.input.ExpressionAttributeValues?.[':prefix']).toBe('BATTLE#');
	});

	it('limit を超えた page では打ち切る (slice)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeBattleItem({ id: 9, date: '2026-06-03' }),
				makeBattleItem({ id: 8, date: '2026-06-02' }),
				makeBattleItem({ id: 7, date: '2026-06-01' }),
			],
		});
		const { findRecentBattles } = await loadRepo();
		const battles = await findRecentBattles(CHILD_ID, 2, TENANT);
		expect(battles).toHaveLength(2);
		expect(battles.map((b) => b.id)).toEqual([9, 8]);
	});

	it('0 件のとき空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findRecentBattles } = await loadRepo();
		expect(await findRecentBattles(CHILD_ID, 10, TENANT)).toEqual([]);
	});
});

// ============================================================
// countConsecutiveLosses
// ============================================================

describe('countConsecutiveLosses', () => {
	it('completed の先頭から lose が続く数を数える (date desc)', async () => {
		// SK 降順 Query なので新しい順に並ぶ。先頭 2 件が lose、3 件目が win。
		mockSend.mockResolvedValueOnce({
			Items: [
				makeBattleItem({ id: 3, date: '2026-06-03', status: 'completed', outcome: 'lose' }),
				makeBattleItem({ id: 2, date: '2026-06-02', status: 'completed', outcome: 'lose' }),
				makeBattleItem({ id: 1, date: '2026-06-01', status: 'completed', outcome: 'win' }),
			],
		});
		const { countConsecutiveLosses } = await loadRepo();
		expect(await countConsecutiveLosses(CHILD_ID, TENANT)).toBe(2);
	});

	it('pending は無視し completed のみで連敗数を数える', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeBattleItem({ id: 4, date: '2026-06-04', status: 'pending', outcome: null }),
				makeBattleItem({ id: 3, date: '2026-06-03', status: 'completed', outcome: 'lose' }),
				makeBattleItem({ id: 2, date: '2026-06-02', status: 'completed', outcome: 'win' }),
			],
		});
		const { countConsecutiveLosses } = await loadRepo();
		// completed のみ抽出 → [lose, win] → 連敗 1。
		expect(await countConsecutiveLosses(CHILD_ID, TENANT)).toBe(1);
	});

	it('先頭が win なら 0', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeBattleItem({ id: 3, date: '2026-06-03', status: 'completed', outcome: 'win' })],
		});
		const { countConsecutiveLosses } = await loadRepo();
		expect(await countConsecutiveLosses(CHILD_ID, TENANT)).toBe(0);
	});

	it('directly 5 件を超える completed は先頭 5 件だけ評価する (SQLite limit(5) 等価)', async () => {
		// 6 件全部 lose。SQLite は limit(5) なので最大 5 を返す。
		const items = [6, 5, 4, 3, 2, 1].map((id) =>
			makeBattleItem({
				id,
				date: `2026-06-0${id}`,
				status: 'completed',
				outcome: 'lose',
			}),
		);
		mockSend.mockResolvedValueOnce({ Items: items });
		const { countConsecutiveLosses } = await loadRepo();
		expect(await countConsecutiveLosses(CHILD_ID, TENANT)).toBe(5);
	});

	it('履歴 0 件なら 0', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { countConsecutiveLosses } = await loadRepo();
		expect(await countConsecutiveLosses(CHILD_ID, TENANT)).toBe(0);
	});
});

// ============================================================
// insertDailyBattle
// ============================================================

describe('insertDailyBattle', () => {
	it('counter 採番 → PutItem し採番 id を返す (SQLite default 値)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 101 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand

		const { insertDailyBattle } = await loadRepo();
		const stats = { hp: 100, atk: 10, def: 5, spd: 5, rec: 2 };
		const id = await insertDailyBattle(CHILD_ID, ENEMY_ID, DATE, stats, TENANT);

		expect(id).toBe(101);
		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(putCall.input.Item?.SK).toBe(`BATTLE#${DATE}`);
		expect(putCall.input.Item?.status).toBe('pending');
		expect(putCall.input.Item?.outcome).toBeNull();
		expect(putCall.input.Item?.rewardPoints).toBe(0);
		expect(putCall.input.Item?.turnsUsed).toBe(0);
		// playerStats は JSON 文字列で保存 (SQLite playerStatsJson と一致)。
		expect(putCall.input.Item?.playerStatsJson).toBe(JSON.stringify(stats));
	});
});

// ============================================================
// completeBattle
// ============================================================

describe('completeBattle', () => {
	it('battleId を Scan で PK/SK 解決し status / outcome / reward を更新する', async () => {
		// 1) findBattleItemById Scan
		mockSend.mockResolvedValueOnce({
			Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: `BATTLE#${DATE}` }],
		});
		// 2) UpdateCommand
		mockSend.mockResolvedValueOnce({});

		const { completeBattle } = await loadRepo();
		await completeBattle(BATTLE_ID, 'win', 50, 4, TENANT);

		expect(mockSend).toHaveBeenCalledTimes(2);
		const scan = mockSend.mock.calls[0]?.[0] as {
			input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(scan.input.FilterExpression).toContain('id = :id');
		expect(scan.input.ExpressionAttributeValues?.[':id']).toBe(BATTLE_ID);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(upd.input.UpdateExpression).toContain('#status = :status');
		expect(upd.input.ExpressionAttributeValues?.[':status']).toBe('completed');
		expect(upd.input.ExpressionAttributeValues?.[':outcome']).toBe('win');
		expect(upd.input.ExpressionAttributeValues?.[':rp']).toBe(50);
		expect(upd.input.ExpressionAttributeValues?.[':tu']).toBe(4);
	});

	it('battle が見つからないとき Update せず no-op (SQLite UPDATE no-match と等価)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { completeBattle } = await loadRepo();
		await completeBattle(BATTLE_ID, 'lose', 0, 3, TENANT);
		// Scan のみ、Update 0 件。
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('対象 battle が 2 ページ目に来る Scan でも見つけて Update する (#2842 Limit:1+Filter 誤用回帰)', async () => {
		// DynamoDB Scan の Limit は filter 適用「前」の評価上限。Limit なし + ExclusiveStartKey で
		// 全ページ走査し、対象が先頭 page に無くても必ず到達することを固定する。
		mockSend
			// page 1: filter 全落ちで Items 空 + 続きあり
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p1', SK: 'p1' } })
			// page 2: 対象 battle が一致
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: `BATTLE#${DATE}` }],
			})
			// UpdateCommand
			.mockResolvedValueOnce({});

		const { completeBattle } = await loadRepo();
		await completeBattle(BATTLE_ID, 'win', 50, 4, TENANT);

		expect(mockSend).toHaveBeenCalledTimes(3);
		const page1 = mockSend.mock.calls[0]?.[0] as { input: { ExclusiveStartKey?: unknown } };
		const page2 = mockSend.mock.calls[1]?.[0] as { input: { ExclusiveStartKey?: unknown } };
		expect(page1.input.ExclusiveStartKey).toBeUndefined();
		expect(page2.input.ExclusiveStartKey).toEqual({ PK: 'p1', SK: 'p1' });
		const upd = mockSend.mock.calls[2]?.[0] as { input: { Key?: { PK: string; SK: string } } };
		expect(upd.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(upd.input.Key?.SK).toBe(`BATTLE#${DATE}`);
	});

	it('findBattleItemById Scan に Limit を付けない (#2842)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: `BATTLE#${DATE}` }],
		});
		mockSend.mockResolvedValueOnce({});
		const { completeBattle } = await loadRepo();
		await completeBattle(BATTLE_ID, 'win', 50, 4, TENANT);
		const scan = mockSend.mock.calls[0]?.[0] as { input: { Limit?: number } };
		expect(scan.input.Limit).toBeUndefined();
	});
});

// ============================================================
// findCollection
// ============================================================

describe('findCollection', () => {
	it('child partition の ENEMYCOL# item を Query する', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeCollectionItem({ enemyId: 3 }),
				makeCollectionItem({ enemyId: 5, defeatCount: 4 }),
			],
		});
		const { findCollection } = await loadRepo();
		const collection = await findCollection(CHILD_ID, TENANT);
		expect(collection.map((c) => c.enemyId)).toEqual([3, 5]);
		expect(collection[1]?.defeatCount).toBe(4);
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, string> };
		};
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(callArg.input.ExpressionAttributeValues?.[':prefix']).toBe('ENEMYCOL#');
	});

	it('defeatCount 欠落を SQLite default 1 に補完する', async () => {
		const item = makeCollectionItem();
		delete item.defeatCount;
		mockSend.mockResolvedValueOnce({ Items: [item] });
		const { findCollection } = await loadRepo();
		const collection = await findCollection(CHILD_ID, TENANT);
		expect(collection[0]?.defeatCount).toBe(1);
	});

	it('0 件のとき空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findCollection } = await loadRepo();
		expect(await findCollection(CHILD_ID, TENANT)).toEqual([]);
	});

	it('LastEvaluatedKey でページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeCollectionItem({ enemyId: 3 })],
				LastEvaluatedKey: { PK: 'c', SK: 'c' },
			})
			.mockResolvedValueOnce({ Items: [makeCollectionItem({ enemyId: 5 })] });
		const { findCollection } = await loadRepo();
		const collection = await findCollection(CHILD_ID, TENANT);
		expect(collection).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});

// ============================================================
// upsertCollectionEntry
// ============================================================

describe('upsertCollectionEntry', () => {
	it('既存エントリは defeatCount を ADD で +1 する (SQLite UPDATE 分岐)', async () => {
		mockSend
			.mockResolvedValueOnce({ Item: makeCollectionItem({ defeatCount: 2 }) }) // GetItem 既存
			.mockResolvedValueOnce({}); // UpdateCommand
		const { upsertCollectionEntry } = await loadRepo();
		await upsertCollectionEntry(CHILD_ID, ENEMY_ID, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(2);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(upd.input.UpdateExpression).toBe('ADD defeatCount :one');
		expect(upd.input.ExpressionAttributeValues?.[':one']).toBe(1);
	});

	it('新規エントリは counter 採番 → PutItem (SQLite INSERT 分岐、default defeat_count=1)', async () => {
		mockSend
			.mockResolvedValueOnce({ Item: undefined }) // GetItem 不在
			.mockResolvedValueOnce({ Attributes: { counter: 11 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand
		const { upsertCollectionEntry } = await loadRepo();
		await upsertCollectionEntry(CHILD_ID, ENEMY_ID, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(3);
		const put = mockSend.mock.calls[2]?.[0] as {
			input: { Item?: Record<string, unknown>; ConditionExpression?: string };
		};
		expect(put.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(put.input.Item?.SK).toBe(`ENEMYCOL#${String(ENEMY_ID).padStart(8, '0')}`);
		expect(put.input.Item?.id).toBe(11);
		expect(put.input.Item?.defeatCount).toBe(1);
		// 競合二重 Put ガード。
		expect(put.input.ConditionExpression).toBe('attribute_not_exists(PK)');
	});

	it('新規 Put が競合 (ConditionalCheckFailed) しても no-op で握りつぶす', async () => {
		const err = new Error('cond');
		err.name = 'ConditionalCheckFailedException';
		mockSend
			.mockResolvedValueOnce({ Item: undefined }) // GetItem 不在
			.mockResolvedValueOnce({ Attributes: { counter: 11 } }) // nextId
			.mockRejectedValueOnce(err); // PutCommand 競合
		const { upsertCollectionEntry } = await loadRepo();
		await expect(upsertCollectionEntry(CHILD_ID, ENEMY_ID, TENANT)).resolves.toBeUndefined();
	});

	it('ConditionalCheckFailed 以外の Put error は rethrow する', async () => {
		mockSend
			.mockResolvedValueOnce({ Item: undefined })
			.mockResolvedValueOnce({ Attributes: { counter: 11 } })
			.mockRejectedValueOnce(new Error('throughput exceeded'));
		const { upsertCollectionEntry } = await loadRepo();
		await expect(upsertCollectionEntry(CHILD_ID, ENEMY_ID, TENANT)).rejects.toThrow(
			'throughput exceeded',
		);
	});
});

// ============================================================
// deleteByTenantId
// ============================================================

describe('deleteByTenantId', () => {
	it('battles (BATTLE# 配下) と enemy collection (ENEMYCOL# 配下) の 2 経路を Scan + 削除する', async () => {
		// deleteItemsByPkPrefix は内部で Scan → BatchWrite。各経路 1 回 Scan (0 件返す)。
		mockSend.mockResolvedValue({ Items: [] });
		const { deleteByTenantId } = await loadRepo();
		await deleteByTenantId(TENANT);
		expect(mockSend).toHaveBeenCalledTimes(2);
		const scan1 = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		const scan2 = mockSend.mock.calls[1]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		const skPrefixes = [
			scan1.input.ExpressionAttributeValues?.[':skPrefix'],
			scan2.input.ExpressionAttributeValues?.[':skPrefix'],
		];
		expect(skPrefixes).toContain('BATTLE#');
		expect(skPrefixes).toContain('ENEMYCOL#');
		// 両経路とも child partition prefix。
		expect(scan1.input.ExpressionAttributeValues?.[':pkPrefix']).toBe(`T#${TENANT}#CHILD#`);
	});
});

// ============================================================
// interface 適合 (SQLite との機能等価性)
// ============================================================

describe('interface 適合 (IBattleRepo)', () => {
	it('全メソッドを export している (stub に後退していない)', async () => {
		const repo = await loadRepo();
		for (const m of [
			'findTodayBattle',
			'findRecentBattles',
			'countConsecutiveLosses',
			'insertDailyBattle',
			'completeBattle',
			'findCollection',
			'upsertCollectionEntry',
			'deleteByTenantId',
		]) {
			expect(typeof (repo as Record<string, unknown>)[m]).toBe('function');
		}
	});

	it('write method が no-op stub でない (insertDailyBattle が実 send し counter 値を返す)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insertDailyBattle } = await loadRepo();
		const id = await insertDailyBattle(
			CHILD_ID,
			ENEMY_ID,
			DATE,
			{ hp: 100, atk: 10, def: 5, spd: 5, rec: 2 },
			TENANT,
		);
		// stub なら id=0 を返していた。本実装は counter 値を返す。
		expect(id).toBe(1);
		expect(mockSend).toHaveBeenCalled();
	});
});
