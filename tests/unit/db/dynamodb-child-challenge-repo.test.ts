/**
 * tests/unit/db/dynamodb-child-challenge-repo.test.ts
 *
 * #2824 / ADR-0055 Phase 2B: DynamoDB per-child child-challenge-repo 本実装の単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/child-challenge-repo.ts、
 * 挙動 SSOT) と機能等価であることを method ごとに検証する:
 *   - 正しい Command + key で send する (child partition Query / tenant Scan)
 *   - response を正しく型変換する (stripKeys)
 *   - SQLite 機能等価 (active/期間 filter / 完成済未請求 filter / insert default 値 /
 *     mutation の id→PK/SK 解決 / status 予約語ハンドリング / copy / tenant 削除)
 *
 * 背景: #2362 PR-7 で導入された stub が #2263/#2280 hotfix で read=空 / write=no-op 化され、
 *   marketplace challenge-set 取込が本番 DynamoDB Lambda で永続せず「N 件追加しました」と
 *   偽る CRITICAL バグの一因になった。本テストは本実装の機能等価性を回帰固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AWS SDK Mock (vi.hoisted で先にモック関数と Command クラスを確保)
const {
	mockSend,
	MockGetCommand,
	MockPutCommand,
	MockQueryCommand,
	MockUpdateCommand,
	MockDeleteCommand,
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
		MockDeleteCommand: class extends Cmd {},
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
	DeleteCommand: MockDeleteCommand,
	ScanCommand: MockScanCommand,
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/child-challenge-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;

/** child partition の DynamoDB item を組み立てる (PK/SK + 属性)。 */
function makeItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const id = (over.id as number) ?? 1;
	const childId = (over.childId as number) ?? CHILD_ID;
	return {
		PK: `T#${TENANT}#CHILD#${childId}`,
		SK: `CHILDCHAL#${String(id).padStart(8, '0')}`,
		id,
		childId,
		title: 'なわとびチャレンジ',
		description: null,
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: '2026-06-01',
		endDate: '2026-06-07',
		targetConfig: '{"metric":"count","baseTarget":5}',
		rewardConfig: '{"points":50}',
		status: 'active',
		isActive: 1,
		sourceTemplateId: null,
		currentValue: 0,
		targetValue: 5,
		completed: 0,
		completedAt: null,
		rewardClaimed: 0,
		rewardClaimedAt: null,
		createdAt: '2026-06-01T00:00:00.000Z',
		updatedAt: '2026-06-01T00:00:00.000Z',
		...over,
	};
}

const TODAY = '2026-06-04';

beforeEach(() => {
	mockSend.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

// ============================================================
// findByChildId
// ============================================================

describe('findByChildId', () => {
	it('child partition を Query し startDate 昇順で返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 2, title: 'B', startDate: '2026-06-08' }),
				makeItem({ id: 1, title: 'A', startDate: '2026-06-01' }),
			],
		});

		const { findByChildId } = await loadRepo();
		const result = await findByChildId(CHILD_ID, TENANT);

		expect(result.map((c) => c.title)).toEqual(['A', 'B']);
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, string>;
			};
		};
		expect(callArg.input.KeyConditionExpression).toContain('PK = :pk');
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(callArg.input.ExpressionAttributeValues?.[':prefix']).toBe('CHILDCHAL#');
	});

	it('LastEvaluatedKey でページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeItem({ id: 1, title: 'p1' })],
				LastEvaluatedKey: { PK: 'c', SK: 'c' },
			})
			.mockResolvedValueOnce({ Items: [makeItem({ id: 2, title: 'p2' })] });
		const { findByChildId } = await loadRepo();
		const result = await findByChildId(CHILD_ID, TENANT);
		expect(result).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('0 件のときは空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findByChildId } = await loadRepo();
		expect(await findByChildId(CHILD_ID, TENANT)).toEqual([]);
	});
});

// ============================================================
// findActiveByChildId
// ============================================================

describe('findActiveByChildId', () => {
	it('isActive=1 / status=active / 期間内のみ返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({
					id: 1,
					title: 'active-in',
					status: 'active',
					startDate: '2026-06-01',
					endDate: '2026-06-07',
				}),
				makeItem({ id: 2, title: 'completed', status: 'completed' }), // status≠active → 除外
				makeItem({ id: 3, title: 'inactive', isActive: 0 }), // isActive=0 → 除外
				makeItem({
					id: 4,
					title: 'past',
					status: 'active',
					startDate: '2026-05-01',
					endDate: '2026-05-07',
				}), // 期間外 → 除外
			],
		});
		const { findActiveByChildId } = await loadRepo();
		const result = await findActiveByChildId(CHILD_ID, TODAY, TENANT);
		expect(result.map((c) => c.title)).toEqual(['active-in']);
	});
});

// ============================================================
// findActiveOrUnclaimedByChildId (#2488 must-1)
// ============================================================

describe('findActiveOrUnclaimedByChildId', () => {
	it('active + 完成済かつ未請求を返し、受取済 completed を除外する', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, title: 'active', status: 'active' }),
				makeItem({ id: 2, title: 'completed-unclaimed', status: 'completed', rewardClaimed: 0 }),
				makeItem({ id: 3, title: 'completed-claimed', status: 'completed', rewardClaimed: 1 }), // 受取済 → 除外
				makeItem({ id: 4, title: 'expired', status: 'expired' }), // 対象外 status → 除外
			],
		});
		const { findActiveOrUnclaimedByChildId } = await loadRepo();
		const result = await findActiveOrUnclaimedByChildId(CHILD_ID, TODAY, TENANT);
		expect(result.map((c) => c.title)).toEqual(['active', 'completed-unclaimed']);
	});

	it('期間外は active でも除外する', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({
					id: 1,
					title: 'future',
					status: 'active',
					startDate: '2026-07-01',
					endDate: '2026-07-07',
				}),
			],
		});
		const { findActiveOrUnclaimedByChildId } = await loadRepo();
		expect(await findActiveOrUnclaimedByChildId(CHILD_ID, TODAY, TENANT)).toEqual([]);
	});
});

// ============================================================
// findAllByTenant
// ============================================================

describe('findAllByTenant', () => {
	it('tenant 配下を Scan し createdAt 昇順で返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 2, title: 'B', createdAt: '2026-06-02T00:00:00.000Z' }),
				makeItem({ id: 1, title: 'A', childId: 99, createdAt: '2026-06-01T00:00:00.000Z' }),
			],
		});
		const { findAllByTenant } = await loadRepo();
		const result = await findAllByTenant(TENANT);
		expect(result.map((c) => c.title)).toEqual(['A', 'B']);
		const scan = mockSend.mock.calls[0]?.[0] as {
			input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(scan.input.FilterExpression).toContain('begins_with(SK, :skPrefix)');
		expect(scan.input.ExpressionAttributeValues?.[':skPrefix']).toBe('CHILDCHAL#');
		expect(scan.input.ExpressionAttributeValues?.[':tenantPrefix']).toBe(`T#${TENANT}#CHILD#`);
	});

	it('Scan を LastEvaluatedKey でページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeItem({ id: 1 })],
				LastEvaluatedKey: { PK: 'x', SK: 'y' },
			})
			.mockResolvedValueOnce({ Items: [makeItem({ id: 2 })] });
		const { findAllByTenant } = await loadRepo();
		expect(await findAllByTenant(TENANT)).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});

// ============================================================
// findById
// ============================================================

describe('findById', () => {
	it('id 属性で Scan し 1 件返す (#3258: SK 形式非依存解決)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeItem({ id: 7, title: 'X' })] });
		const { findById } = await loadRepo();
		const result = await findById(7, TENANT);
		expect(result?.title).toBe('X');
		const scan = mockSend.mock.calls[0]?.[0] as {
			input: {
				FilterExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
				ExpressionAttributeNames?: Record<string, string>;
			};
		};
		// #3258: SK exact-match (CHILDCHAL#<padId>) ではなく id 属性で解決する
		// (auto:weekly 行 SK=CHILDCHAL#AUTO#... も id-addressable にするため)。
		expect(scan.input.FilterExpression).toContain('#id = :id');
		expect(scan.input.FilterExpression).not.toContain('SK = :sk');
		expect(scan.input.ExpressionAttributeValues?.[':id']).toBe(7);
		expect(scan.input.ExpressionAttributeNames?.['#id']).toBe('id');
	});

	it('不在のとき undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findById } = await loadRepo();
		expect(await findById(7, TENANT)).toBeUndefined();
	});
});

// ============================================================
// insert / insertBulk
// ============================================================

describe('insert', () => {
	it('counter 採番 → PutItem し SQLite default 値を埋めた row を返す', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 101 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand

		const { insert } = await loadRepo();
		const result = await insert(
			{
				childId: CHILD_ID,
				title: 'すいえいチャレンジ',
				startDate: '2026-06-01',
				endDate: '2026-06-07',
				targetConfig: '{"metric":"count"}',
				rewardConfig: '{"points":30}',
				targetValue: 3,
			},
			TENANT,
		);

		expect(result.id).toBe(101);
		// SQLite schema default が埋まっている
		expect(result).toMatchObject({
			childId: CHILD_ID,
			title: 'すいえいチャレンジ',
			description: null,
			challengeType: 'cooperative',
			periodType: 'weekly',
			status: 'active',
			isActive: 1,
			sourceTemplateId: null,
			currentValue: 0,
			targetValue: 3,
			completed: 0,
			completedAt: null,
			rewardClaimed: 0,
			rewardClaimedAt: null,
		});

		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(putCall.input.Item?.SK).toBe('CHILDCHAL#00000101');
		expect(putCall.input.Item?.title).toBe('すいえいチャレンジ');
		expect(putCall.input.Item?.status).toBe('active');
	});

	it('sourceTemplateId / description / periodType を反映する', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 5 } }).mockResolvedValueOnce({});
		const { insert } = await loadRepo();
		const result = await insert(
			{
				childId: CHILD_ID,
				title: 'お手伝い',
				description: '毎日のお手伝い',
				periodType: 'monthly',
				startDate: '2026-06-01',
				endDate: '2026-06-30',
				targetConfig: '{}',
				rewardConfig: '{}',
				sourceTemplateId: 'japan-annual-events',
				targetValue: 20,
			},
			TENANT,
		);
		expect(result).toMatchObject({
			description: '毎日のお手伝い',
			periodType: 'monthly',
			sourceTemplateId: 'japan-annual-events',
			targetValue: 20,
		});
	});
});

describe('insertBulk', () => {
	it('空配列は何も send せず空を返す', async () => {
		const { insertBulk } = await loadRepo();
		expect(await insertBulk([], TENANT)).toEqual([]);
		expect(mockSend).not.toHaveBeenCalled();
	});

	it('複数 input を順次 insert し全 row を返す (取込永続の核心経路)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 1 } })
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ Attributes: { counter: 2 } })
			.mockResolvedValueOnce({});
		const { insertBulk } = await loadRepo();
		const base = {
			childId: CHILD_ID,
			startDate: '2026-06-01',
			endDate: '2026-06-07',
			targetConfig: '{}',
			rewardConfig: '{}',
			targetValue: 5,
		};
		const result = await insertBulk(
			[
				{ ...base, title: 'A' },
				{ ...base, title: 'B' },
			],
			TENANT,
		);
		expect(result.map((c) => c.title)).toEqual(['A', 'B']);
		expect(result.map((c) => c.id)).toEqual([1, 2]);
		// 2 insert = 4 send (nextId + Put × 2)
		expect(mockSend).toHaveBeenCalledTimes(4);
	});
});

// ============================================================
// updateProgress / markCompleted / claimReward
// ============================================================

describe('updateProgress', () => {
	it('id を Scan で解決し currentValue を Update する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDCHAL#00000003' }],
			}) // resolve
			.mockResolvedValueOnce({}); // Update
		const { updateProgress } = await loadRepo();
		await updateProgress(3, 4, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(2);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: {
				Key?: { SK: string };
				UpdateExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(upd.input.Key?.SK).toBe('CHILDCHAL#00000003');
		expect(upd.input.UpdateExpression).toContain('currentValue = :cv');
		expect(upd.input.ExpressionAttributeValues?.[':cv']).toBe(4);
	});

	it('id 不在のとき Update を発行しない (Scan のみ)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { updateProgress } = await loadRepo();
		await updateProgress(999, 1, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

describe('markCompleted', () => {
	it('completed=1 / status=completed を予約語回避で Update する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDCHAL#00000001' }],
			})
			.mockResolvedValueOnce({});
		const { markCompleted } = await loadRepo();
		await markCompleted(1, TENANT);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: {
				UpdateExpression?: string;
				ExpressionAttributeNames?: Record<string, string>;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(upd.input.UpdateExpression).toContain('completed = :one');
		expect(upd.input.UpdateExpression).toContain('#status = :completed');
		expect(upd.input.ExpressionAttributeNames?.['#status']).toBe('status');
		expect(upd.input.ExpressionAttributeValues?.[':completed']).toBe('completed');
	});
});

describe('claimReward', () => {
	it('rewardClaimed=1 を条件付き Update し true を返す (#3284 ConditionExpression)', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDCHAL#00000001' }],
			})
			.mockResolvedValueOnce({});
		const { claimReward } = await loadRepo();
		const claimed = await claimReward(1, TENANT);
		expect(claimed).toBe(true);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: {
				UpdateExpression?: string;
				ConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(upd.input.UpdateExpression).toContain('rewardClaimed = :one');
		expect(upd.input.ExpressionAttributeValues?.[':one']).toBe(1);
		// #3284: 既に受取済 (rewardClaimed=1) を弾く原子ゲート
		expect(upd.input.ConditionExpression).toBe('rewardClaimed <> :one');
	});

	it('既に受取済 (ConditionalCheckFailed) では false を返す (二重付与防止、SQLite changes=0 と対称)', async () => {
		const condErr = new Error('conditional check failed');
		condErr.name = 'ConditionalCheckFailedException';
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDCHAL#00000001' }],
			})
			.mockRejectedValueOnce(condErr);
		const { claimReward } = await loadRepo();
		const claimed = await claimReward(1, TENANT);
		expect(claimed).toBe(false);
	});
});

// ============================================================
// update (meta)
// ============================================================

describe('update', () => {
	it('渡された field のみ UpdateExpression に含める (status 予約語回避)', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDCHAL#00000001' }],
			})
			.mockResolvedValueOnce({});
		const { update } = await loadRepo();
		await update(1, { title: 'updated', status: 'expired', isActive: 0 }, TENANT);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: {
				UpdateExpression?: string;
				ExpressionAttributeNames?: Record<string, string>;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(upd.input.UpdateExpression).toContain('#title = :title');
		expect(upd.input.UpdateExpression).toContain('#status = :status');
		expect(upd.input.UpdateExpression).toContain('#isActive = :isActive');
		expect(upd.input.ExpressionAttributeNames?.['#status']).toBe('status');
		expect(upd.input.ExpressionAttributeValues?.[':status']).toBe('expired');
		expect(upd.input.ExpressionAttributeValues?.[':isActive']).toBe(0);
		// 未指定 field は含まれない
		expect(upd.input.UpdateExpression).not.toContain(':targetConfig');
	});

	it('field 0 件でも updatedAt のみ更新する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDCHAL#00000001' }],
			})
			.mockResolvedValueOnce({});
		const { update } = await loadRepo();
		await update(1, {}, TENANT);
		const upd = mockSend.mock.calls[1]?.[0] as { input: { UpdateExpression?: string } };
		expect(upd.input.UpdateExpression).toContain('#updatedAt = :now');
	});

	it('id 不在のとき Update を発行しない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { update } = await loadRepo();
		await update(999, { title: 'x' }, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

// ============================================================
// deleteChallenge
// ============================================================

describe('deleteChallenge', () => {
	it('id を Scan で解決し DeleteItem する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDCHAL#00000003' }],
			})
			.mockResolvedValueOnce({});
		const { deleteChallenge } = await loadRepo();
		await deleteChallenge(3, TENANT);
		const del = mockSend.mock.calls[1]?.[0] as { input: { Key?: { SK: string } } };
		expect(del.input.Key?.SK).toBe('CHILDCHAL#00000003');
	});

	it('id 不在のとき Delete を発行しない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { deleteChallenge } = await loadRepo();
		await deleteChallenge(999, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

// ============================================================
// copyAcrossChildren
// ============================================================

describe('copyAcrossChildren', () => {
	it('source の challenge を target child に複製し進捗をリセットする', async () => {
		// 1) findByChildId(source) Query
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, title: 'A', currentValue: 3, completed: 1, sourceTemplateId: 'tpl-1' }),
				makeItem({ id: 2, title: 'B', startDate: '2026-06-08' }),
			],
		});
		// 2) insertBulk → nextId + Put × 2
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 10 } })
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ Attributes: { counter: 11 } })
			.mockResolvedValueOnce({});

		const { copyAcrossChildren } = await loadRepo();
		const result = await copyAcrossChildren(CHILD_ID, 99, TENANT);
		expect(result.map((c) => c.title)).toEqual(['A', 'B']);
		expect(result.every((c) => c.childId === 99)).toBe(true);
		// 進捗リセット + sourceTemplateId 維持
		expect(result[0]?.currentValue).toBe(0);
		expect(result[0]?.completed).toBe(0);
		expect(result[0]?.sourceTemplateId).toBe('tpl-1');
	});

	it('source 0 件のとき何も insert しない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { copyAcrossChildren } = await loadRepo();
		expect(await copyAcrossChildren(CHILD_ID, 99, TENANT)).toEqual([]);
		expect(mockSend).toHaveBeenCalledTimes(1); // Query のみ
	});
});

// ============================================================
// deleteByTenantId
// ============================================================

describe('deleteByTenantId', () => {
	it('tenant 配下を Scan し全件 Delete する', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				{ PK: `T#${TENANT}#CHILD#1`, SK: 'CHILDCHAL#00000001' },
				{ PK: `T#${TENANT}#CHILD#2`, SK: 'CHILDCHAL#00000002' },
			],
		});
		mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
		const { deleteByTenantId } = await loadRepo();
		await deleteByTenantId(TENANT);
		// 1 Scan + 2 Delete
		expect(mockSend).toHaveBeenCalledTimes(3);
		const del = mockSend.mock.calls[1]?.[0] as { input: { Key?: { PK: string } } };
		expect(del.input.Key?.PK).toBe(`T#${TENANT}#CHILD#1`);
	});
});

// ============================================================
// #3258: auto:weekly 行 (SK=CHILDCHAL#AUTO#<weekStart>) の id 解決 — silent no-op 根治
// ============================================================
//
// 旧実装は resolveKeyById/findById が SK=CHILDCHAL#<padId(id)> の exact match のみで解決し、
// auto:weekly 行 (SK=CHILDCHAL#AUTO#...) を never match → updateProgress/markCompleted/
// claimReward/update/delete が DynamoDB prod で silent no-op になり、コア体験 (チャレンジ→ごほうび)
// が有料ユーザで永久停止していた。本 block は auto 行が id で解決され mutation が実 SK に作用する
// (= read/write key 解決の対称性) を回帰固定する。

describe('#3258 auto:weekly 行の id 解決 (read/write 対称性)', () => {
	const AUTO_SK = 'CHILDCHAL#AUTO#2026-06-01';
	const AUTO_KEY = { PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: AUTO_SK };

	it('updateProgress は auto 行を id で解決し実 SK で Update する (silent no-op でない)', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [AUTO_KEY] }) // resolveKeyById
			.mockResolvedValueOnce({}); // Update
		const { updateProgress } = await loadRepo();
		await updateProgress(50, 3, TENANT);

		// no-op でなく Update まで発行する (resolve + Update = 2 send)
		expect(mockSend).toHaveBeenCalledTimes(2);
		// 解決は SK 形式非依存の id 属性 match で行う (auto 行 SK を exact-match で外さない)
		const resolve = mockSend.mock.calls[0]?.[0] as {
			input: {
				FilterExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
				ExpressionAttributeNames?: Record<string, string>;
			};
		};
		expect(resolve.input.FilterExpression).toContain('#id = :id');
		expect(resolve.input.FilterExpression).not.toContain('SK = :sk');
		expect(resolve.input.ExpressionAttributeValues?.[':id']).toBe(50);
		expect(resolve.input.ExpressionAttributeNames?.['#id']).toBe('id');
		// Update は auto 行の実 SK を対象にする (CHILDCHAL#AUTO#...)
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: { Key?: { SK: string }; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(upd.input.Key?.SK).toBe(AUTO_SK);
		expect(upd.input.ExpressionAttributeValues?.[':cv']).toBe(3);
	});

	it('markCompleted / claimReward も auto 行に作用する (進捗→完了→報酬の貫通)', async () => {
		const repo = await loadRepo();
		// markCompleted
		mockSend.mockResolvedValueOnce({ Items: [AUTO_KEY] }).mockResolvedValueOnce({});
		await repo.markCompleted(50, TENANT);
		expect((mockSend.mock.calls[1]?.[0] as { input: { Key?: { SK: string } } }).input.Key?.SK).toBe(
			AUTO_SK,
		);

		mockSend.mockReset();
		// claimReward
		mockSend.mockResolvedValueOnce({ Items: [AUTO_KEY] }).mockResolvedValueOnce({});
		await repo.claimReward(50, TENANT);
		expect((mockSend.mock.calls[1]?.[0] as { input: { Key?: { SK: string } } }).input.Key?.SK).toBe(
			AUTO_SK,
		);
	});

	it('findById も auto 行を id で取得する (read=write 対称、SK 形式非依存)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 50, SK: AUTO_SK, title: 'AUTO-WEEKLY' })],
		});
		const { findById } = await loadRepo();
		const result = await findById(50, TENANT);
		expect(result?.title).toBe('AUTO-WEEKLY');
	});
});

// ============================================================
// interface 適合 (SQLite との機能等価性)
// ============================================================

describe('interface 適合 (IChildChallengeRepo)', () => {
	it('全メソッドを export している (stub に後退していない)', async () => {
		const repo = await loadRepo();
		for (const m of [
			'findByChildId',
			'findActiveByChildId',
			'findActiveOrUnclaimedByChildId',
			'findAllByTenant',
			'findById',
			'insert',
			'insertBulk',
			'updateProgress',
			'markCompleted',
			'claimReward',
			'update',
			'deleteChallenge',
			'copyAcrossChildren',
			'deleteByTenantId',
		]) {
			expect(typeof (repo as Record<string, unknown>)[m]).toBe('function');
		}
	});

	it('write method が no-op stub でない (insertBulk が実 send する)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insertBulk } = await loadRepo();
		const result = await insertBulk(
			[
				{
					childId: CHILD_ID,
					title: 'X',
					startDate: '2026-06-01',
					endDate: '2026-06-07',
					targetConfig: '{}',
					rewardConfig: '{}',
					targetValue: 5,
				},
			],
			TENANT,
		);
		// stub なら row.id=0 を返していた。本実装は採番された row を返す。
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe(1);
		expect(mockSend).toHaveBeenCalled();
	});
});
