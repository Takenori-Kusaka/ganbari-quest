/**
 * tests/unit/db/dynamodb-child-activity-repo.test.ts
 *
 * #2818 / ADR-0055: DynamoDB per-child activity-repo 本実装の単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/child-activity-repo.ts、
 * 挙動 SSOT) と機能等価であることを method ごとに検証する:
 *   - 正しい Command + key で send する
 *   - response を正しく型変換する (stripKeys / priority backfill)
 *   - SQLite 機能等価 (dedup を支える findActivitiesByChild / visibleOnly / archive 挙動 /
 *     insert default 値 / countMainQuest 条件)
 *
 * 背景: PR #2455 で導入された stub が #2263 hotfix で read=空 / write=throw 化され、
 *   marketplace の per-child 取込が本番 DynamoDB Lambda で永続せず「N 件登録しました」と
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
	return import('../../../src/lib/server/db/dynamodb/child-activity-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;

/** child partition の DynamoDB item を組み立てる (PK/SK + 属性)。 */
function makeItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const id = (over.id as number) ?? 1;
	return {
		PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
		SK: `CHILDACT#${String(id).padStart(8, '0')}`,
		id,
		childId: CHILD_ID,
		name: 'なわとび',
		categoryId: 1,
		icon: '🏃',
		basePoints: 5,
		isVisible: 1,
		dailyLimit: null,
		sortOrder: 0,
		source: 'seed',
		nameKana: null,
		nameKanji: null,
		triggerHint: null,
		isMainQuest: 0,
		isArchived: 0,
		archivedReason: null,
		createdAt: '2026-06-04T00:00:00.000Z',
		sourcePresetId: null,
		priority: 'optional',
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
// findActivitiesByChild
// ============================================================

describe('findActivitiesByChild', () => {
	it('child partition を Query し sortOrder 昇順で返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 2, name: 'B', sortOrder: 1 }),
				makeItem({ id: 1, name: 'A', sortOrder: 0 }),
			],
		});

		const { findActivitiesByChild } = await loadRepo();
		const result = await findActivitiesByChild(CHILD_ID, TENANT);

		expect(result.map((a) => a.name)).toEqual(['A', 'B']);
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, string>;
			};
		};
		expect(callArg.input.KeyConditionExpression).toContain('PK = :pk');
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(callArg.input.ExpressionAttributeValues?.[':prefix']).toBe('CHILDACT#');
	});

	it('既定では archived を除外する (NULL/0 は active 扱い、#962 教訓)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, name: 'active', isArchived: 0 }),
				makeItem({ id: 2, name: 'nullarch', isArchived: null }),
				makeItem({ id: 3, name: 'archived', isArchived: 1 }),
			],
		});
		const { findActivitiesByChild } = await loadRepo();
		const result = await findActivitiesByChild(CHILD_ID, TENANT);
		expect(result.map((a) => a.name)).toEqual(['active', 'nullarch']);
	});

	it('includeArchived=true で archived も返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, name: 'active', isArchived: 0 }),
				makeItem({ id: 2, name: 'archived', isArchived: 1 }),
			],
		});
		const { findActivitiesByChild } = await loadRepo();
		const result = await findActivitiesByChild(CHILD_ID, TENANT, { includeArchived: true });
		expect(result.map((a) => a.name)).toEqual(['active', 'archived']);
	});

	it('visibleOnly=true で非表示を除外する', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, name: 'visible', isVisible: 1 }),
				makeItem({ id: 2, name: 'hidden', isVisible: 0 }),
			],
		});
		const { findActivitiesByChild } = await loadRepo();
		const result = await findActivitiesByChild(CHILD_ID, TENANT, { visibleOnly: true });
		expect(result.map((a) => a.name)).toEqual(['visible']);
	});

	it('priority 未設定 item は optional に backfill する', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeItem({ id: 1, priority: undefined })] });
		const { findActivitiesByChild } = await loadRepo();
		const result = await findActivitiesByChild(CHILD_ID, TENANT);
		expect(result[0]?.priority).toBe('optional');
	});

	it('LastEvaluatedKey でページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeItem({ id: 1, name: 'p1' })],
				LastEvaluatedKey: { PK: 'c', SK: 'c' },
			})
			.mockResolvedValueOnce({ Items: [makeItem({ id: 2, name: 'p2' })] });
		const { findActivitiesByChild } = await loadRepo();
		const result = await findActivitiesByChild(CHILD_ID, TENANT);
		expect(result).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('0 件のときは空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findActivitiesByChild } = await loadRepo();
		expect(await findActivitiesByChild(CHILD_ID, TENANT)).toEqual([]);
	});
});

// ============================================================
// findActivityById
// ============================================================

describe('findActivityById', () => {
	it('child+id key で GetItem する', async () => {
		mockSend.mockResolvedValueOnce({ Item: makeItem({ id: 7, name: 'X' }) });
		const { findActivityById } = await loadRepo();
		const result = await findActivityById(7, CHILD_ID, TENANT);
		expect(result?.name).toBe('X');
		const callArg = mockSend.mock.calls[0]?.[0] as { input: { Key?: { PK: string; SK: string } } };
		expect(callArg.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(callArg.input.Key?.SK).toBe('CHILDACT#00000007');
	});

	it('不在のとき undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({ Item: undefined });
		const { findActivityById } = await loadRepo();
		expect(await findActivityById(7, CHILD_ID, TENANT)).toBeUndefined();
	});
});

// ============================================================
// countMainQuestActivities
// ============================================================

describe('countMainQuestActivities', () => {
	it('isMainQuest=1 かつ visible のみカウントする', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, isMainQuest: 1, isVisible: 1 }),
				makeItem({ id: 2, isMainQuest: 1, isVisible: 0 }), // 非表示 → 除外
				makeItem({ id: 3, isMainQuest: 0, isVisible: 1 }), // 非 main → 除外
				makeItem({ id: 4, isMainQuest: 1, isVisible: 1 }),
			],
		});
		const { countMainQuestActivities } = await loadRepo();
		expect(await countMainQuestActivities(CHILD_ID, TENANT)).toBe(2);
	});
});

// ============================================================
// insertActivity / insertActivitiesBulk
// ============================================================

describe('insertActivity', () => {
	it('counter 採番 → PutItem し SQLite default 値を埋めた row を返す', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 101 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand

		const { insertActivity } = await loadRepo();
		const result = await insertActivity(
			{ childId: CHILD_ID, name: 'すいえい', categoryId: 1, icon: '🏊', basePoints: 8 },
			TENANT,
		);

		expect(result.id).toBe(101);
		// SQLite schema default が埋まっている
		expect(result).toMatchObject({
			childId: CHILD_ID,
			name: 'すいえい',
			basePoints: 8,
			isVisible: 1,
			dailyLimit: null,
			sortOrder: 0,
			source: 'seed',
			isMainQuest: 0,
			isArchived: 0,
			archivedReason: null,
			priority: 'optional',
		});

		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(putCall.input.Item?.SK).toBe('CHILDACT#00000101');
		expect(putCall.input.Item?.name).toBe('すいえい');
		expect(putCall.input.Item?.isVisible).toBe(1);
	});

	it('isMainQuest / priority / sourcePresetId / triggerHint を反映する', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 5 } }).mockResolvedValueOnce({});
		const { insertActivity } = await loadRepo();
		const result = await insertActivity(
			{
				childId: CHILD_ID,
				name: 'べんきょう',
				categoryId: 2,
				icon: '📚',
				basePoints: 3,
				isMainQuest: 1,
				priority: 'must',
				sourcePresetId: 'kinder-starter',
				triggerHint: 'よる',
			},
			TENANT,
		);
		expect(result).toMatchObject({
			isMainQuest: 1,
			priority: 'must',
			sourcePresetId: 'kinder-starter',
			triggerHint: 'よる',
		});
	});
});

describe('insertActivitiesBulk', () => {
	it('空配列は何も send せず空を返す', async () => {
		const { insertActivitiesBulk } = await loadRepo();
		expect(await insertActivitiesBulk([], TENANT)).toEqual([]);
		expect(mockSend).not.toHaveBeenCalled();
	});

	it('複数 input を順次 insert し全 row を返す (取込永続の核心経路)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 1 } })
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ Attributes: { counter: 2 } })
			.mockResolvedValueOnce({});
		const { insertActivitiesBulk } = await loadRepo();
		const result = await insertActivitiesBulk(
			[
				{ childId: CHILD_ID, name: 'A', categoryId: 1, icon: '🏃', basePoints: 5 },
				{ childId: CHILD_ID, name: 'B', categoryId: 1, icon: '📚', basePoints: 5 },
			],
			TENANT,
		);
		expect(result.map((a) => a.name)).toEqual(['A', 'B']);
		expect(result.map((a) => a.id)).toEqual([1, 2]);
		// 2 insert = 4 send (nextId + Put × 2)
		expect(mockSend).toHaveBeenCalledTimes(4);
	});
});

// ============================================================
// updateActivity / setActivityVisibility
// ============================================================

describe('updateActivity', () => {
	it('指定 field のみ UpdateExpression に含め ALL_NEW を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Attributes: makeItem({ id: 1, name: 'updated', basePoints: 9 }),
		});
		const { updateActivity } = await loadRepo();
		const result = await updateActivity(1, CHILD_ID, { name: 'updated', basePoints: 9 }, TENANT);
		expect(result?.name).toBe('updated');
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: { UpdateExpression?: string; ConditionExpression?: string };
		};
		expect(callArg.input.UpdateExpression).toContain('#name = :name');
		expect(callArg.input.UpdateExpression).toContain('#basePoints = :basePoints');
		expect(callArg.input.ConditionExpression).toBe('attribute_exists(PK)');
	});

	it('更新 field 0 件のときは現在値を Get して返す (SQLite .set({}) 等価)', async () => {
		mockSend.mockResolvedValueOnce({ Item: makeItem({ id: 1, name: 'unchanged' }) });
		const { updateActivity } = await loadRepo();
		const result = await updateActivity(1, CHILD_ID, {}, TENANT);
		expect(result?.name).toBe('unchanged');
		const callArg = mockSend.mock.calls[0]?.[0] as { input: { Key?: unknown } };
		expect(callArg.input.Key).toBeDefined(); // GetCommand 経路
	});

	it('別 child / 不在 (ConditionalCheckFailed) のとき undefined を返す', async () => {
		const err = new Error('cond');
		err.name = 'ConditionalCheckFailedException';
		mockSend.mockRejectedValueOnce(err);
		const { updateActivity } = await loadRepo();
		expect(await updateActivity(1, CHILD_ID, { name: 'x' }, TENANT)).toBeUndefined();
	});
});

describe('setActivityVisibility', () => {
	it('isVisible を 0/1 に更新する', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: makeItem({ id: 1, isVisible: 0 }) });
		const { setActivityVisibility } = await loadRepo();
		const result = await setActivityVisibility(1, CHILD_ID, false, TENANT);
		expect(result?.isVisible).toBe(0);
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(callArg.input.ExpressionAttributeValues?.[':v']).toBe(0);
	});

	it('不在 (ConditionalCheckFailed) で undefined', async () => {
		const err = new Error('cond');
		err.name = 'ConditionalCheckFailedException';
		mockSend.mockRejectedValueOnce(err);
		const { setActivityVisibility } = await loadRepo();
		expect(await setActivityVisibility(1, CHILD_ID, true, TENANT)).toBeUndefined();
	});
});

// ============================================================
// deleteActivity
// ============================================================

describe('deleteActivity', () => {
	it('DeleteItem (ALL_OLD) で削除した row を返す', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: makeItem({ id: 3, name: 'gone' }) });
		const { deleteActivity } = await loadRepo();
		const result = await deleteActivity(3, CHILD_ID, TENANT);
		expect(result?.name).toBe('gone');
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: { Key?: { SK: string }; ReturnValues?: string };
		};
		expect(callArg.input.Key?.SK).toBe('CHILDACT#00000003');
		expect(callArg.input.ReturnValues).toBe('ALL_OLD');
	});

	it('不在のとき undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: undefined });
		const { deleteActivity } = await loadRepo();
		expect(await deleteActivity(3, CHILD_ID, TENANT)).toBeUndefined();
	});
});

// ============================================================
// copyActivitiesAcrossChildren
// ============================================================

describe('copyActivitiesAcrossChildren', () => {
	it('source の活動を target child に複製する (兄弟共通化)', async () => {
		// 1) findActivitiesByChild(source) Query
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, name: 'A' }), makeItem({ id: 2, name: 'B' })],
		});
		// 2) insertActivitiesBulk → nextId + Put × 2
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 10 } })
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ Attributes: { counter: 11 } })
			.mockResolvedValueOnce({});

		const { copyActivitiesAcrossChildren } = await loadRepo();
		const result = await copyActivitiesAcrossChildren(CHILD_ID, 99, TENANT);
		expect(result.map((a) => a.name)).toEqual(['A', 'B']);
		expect(result.every((a) => a.childId === 99)).toBe(true);
	});

	it('source 0 件のとき何も insert しない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { copyActivitiesAcrossChildren } = await loadRepo();
		expect(await copyActivitiesAcrossChildren(CHILD_ID, 99, TENANT)).toEqual([]);
		expect(mockSend).toHaveBeenCalledTimes(1); // Query のみ
	});
});

// ============================================================
// archive / restore
// ============================================================

describe('archiveActivities', () => {
	it('id 群を Scan で解決し isArchived=1 + reason を Update する', async () => {
		// scan: tenant 配下の CHILDACT# を返す (PK/SK projection)
		mockSend.mockResolvedValueOnce({
			Items: [
				{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDACT#00000001' },
				{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDACT#00000002' },
			],
		});
		mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({}); // 2 Update

		const { archiveActivities } = await loadRepo();
		await archiveActivities([1, 2], 'downgrade_user_selected', TENANT);

		// 1 Scan + 2 Update
		expect(mockSend).toHaveBeenCalledTimes(3);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(upd.input.UpdateExpression).toContain('isArchived = :one');
		expect(upd.input.ExpressionAttributeValues?.[':reason']).toBe('downgrade_user_selected');
	});

	it('id にマッチしない CHILDACT は Update しない (id filter)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDACT#00000009' }],
		});
		const { archiveActivities } = await loadRepo();
		await archiveActivities([1], 'downgrade_user_selected', TENANT);
		// Scan のみ、Update 0 件 (id=9 は対象 [1] に含まれない)
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('空 ids は no-op', async () => {
		const { archiveActivities } = await loadRepo();
		await archiveActivities([], 'downgrade_user_selected', TENANT);
		expect(mockSend).not.toHaveBeenCalled();
	});
});

describe('restoreArchivedActivities', () => {
	it('reason 一致を Scan し isArchived=0 + reason REMOVE する', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDACT#00000001' }],
		});
		mockSend.mockResolvedValueOnce({});
		const { restoreArchivedActivities } = await loadRepo();
		await restoreArchivedActivities('downgrade_user_selected', TENANT);
		const scan = mockSend.mock.calls[0]?.[0] as {
			input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(scan.input.FilterExpression).toContain('archivedReason = :reason');
		expect(scan.input.ExpressionAttributeValues?.[':reason']).toBe('downgrade_user_selected');
		const upd = mockSend.mock.calls[1]?.[0] as { input: { UpdateExpression?: string } };
		expect(upd.input.UpdateExpression).toContain('REMOVE archivedReason');
	});
});

// ============================================================
// findChildById
// ============================================================

describe('findChildById', () => {
	it('child profile を GetItem する', async () => {
		mockSend.mockResolvedValueOnce({
			Item: {
				PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
				SK: 'PROFILE',
				id: CHILD_ID,
				nickname: 'けんた',
			},
		});
		const { findChildById } = await loadRepo();
		const result = await findChildById(CHILD_ID, TENANT);
		expect(result?.nickname).toBe('けんた');
	});

	it('不在のとき undefined', async () => {
		mockSend.mockResolvedValueOnce({ Item: undefined });
		const { findChildById } = await loadRepo();
		expect(await findChildById(CHILD_ID, TENANT)).toBeUndefined();
	});
});

// ============================================================
// interface 適合 (SQLite との機能等価性)
// ============================================================

describe('interface 適合 (IChildActivityRepo)', () => {
	it('全メソッドを export している (stub に後退していない)', async () => {
		const repo = await loadRepo();
		for (const m of [
			'findActivitiesByChild',
			'findActivityById',
			'countMainQuestActivities',
			'insertActivity',
			'insertActivitiesBulk',
			'updateActivity',
			'setActivityVisibility',
			'deleteActivity',
			'copyActivitiesAcrossChildren',
			'archiveActivities',
			'restoreArchivedActivities',
			'findChildById',
		]) {
			expect(typeof (repo as Record<string, unknown>)[m]).toBe('function');
		}
	});

	it('write method が throw stub でない (insertActivitiesBulk が実 send する)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insertActivitiesBulk } = await loadRepo();
		const result = await insertActivitiesBulk(
			[{ childId: CHILD_ID, name: 'X', categoryId: 1, icon: '🏃', basePoints: 5 }],
			TENANT,
		);
		// stub なら throw していた。本実装は row を返す。
		expect(result).toHaveLength(1);
		expect(mockSend).toHaveBeenCalled();
	});
});
