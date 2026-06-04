/**
 * tests/unit/db/dynamodb-activity-repo-writes.test.ts
 *
 * #2824 Wave 4A / ADR-0055: DynamoDB activity-repo の write 8 method 本実装の単体テスト。
 *
 * 背景: 本番 main Lambda (`ganbari-quest-app`、DATA_SOURCE=dynamodb + AUTH_MODE=cognito)
 *   で activity-repo の write 8 method が `NotImplementedError` throw のままだった。これにより
 *   子供の活動記録 (insertActivityLog) / ポイント付与 (insertPointLedger) / family-master
 *   activity CRUD がコアループごと throw する CRITICAL gap になっていた。本テストは本実装が:
 *     - insertActivityLog: LOG#<date>#<id> key + 非正規化 (activityName/Icon/categoryId) で Put し、
 *       既存 read (findActivityLogs / 集計) が読める形式である
 *     - insertPointLedger: POINT#<createdAt>#<id> key で Put し read 側が読める形式である
 *     - insertActivity 等の family-master CRUD: child_activities (per-child) 経由で永続する
 *   ことを method ごとに検証し、stub 後退を回帰固定する。
 *
 * AWS SDK は vi.hoisted mock で置換する (reward-redemption / child-activity test と同型)。
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
	MockBatchWriteCommand,
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
		MockBatchWriteCommand: class extends Cmd {},
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
	BatchWriteCommand: MockBatchWriteCommand,
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/activity-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;

/** child_activities instance の DynamoDB item を組み立てる (PK/SK + 属性)。 */
function makeChildActivityItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const id = (over.id as number) ?? 7;
	const childId = (over.childId as number) ?? CHILD_ID;
	return {
		PK: `T#${TENANT}#CHILD#${childId}`,
		SK: `CHILDACT#${String(id).padStart(8, '0')}`,
		id,
		childId,
		name: 'なわとび',
		categoryId: 3,
		icon: '🪢',
		basePoints: 10,
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
// insertActivityLog (CRITICAL — 子供の活動記録の本経路)
// ============================================================

describe('insertActivityLog', () => {
	it('counter 採番 → child_activities lookup → LOG# key + 非正規化付きで Put し log を返す', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 101 } }) // nextId(activityLog)
			.mockResolvedValueOnce({ Item: makeChildActivityItem({ id: 7 }) }) // findActivityById (GetItem)
			.mockResolvedValueOnce({}); // PutCommand

		const { insertActivityLog } = await loadRepo();
		const log = await insertActivityLog(
			{
				childId: CHILD_ID,
				activityId: 7,
				points: 10,
				streakDays: 3,
				streakBonus: 2,
				recordedDate: '2026-06-04',
				recordedAt: '2026-06-04T09:00:00.000Z',
			},
			TENANT,
		);

		expect(log).toMatchObject({
			id: 101,
			childId: CHILD_ID,
			activityId: 7,
			points: 10,
			streakDays: 3,
			streakBonus: 2,
			recordedDate: '2026-06-04',
			cancelled: 0,
		});

		const put = mockSend.mock.calls[2]?.[0] as { input: { Item?: Record<string, unknown> } };
		// read 側が begins_with(SK, 'LOG#…') で読む key 形式
		expect(put.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(put.input.Item?.SK).toBe('LOG#2026-06-04#00000101');
		// 非正規化 (read findActivityLogs / category 集計の JOIN 代替) が item に保存される
		expect(put.input.Item?.activityName).toBe('なわとび');
		expect(put.input.Item?.activityIcon).toBe('🪢');
		expect(put.input.Item?.categoryId).toBe(3);
		expect(put.input.Item?.cancelled).toBe(0);
	});

	it('child_activities が見つからなくても throw せず空文字 / 0 で非正規化する (防御)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 1 } })
			.mockResolvedValueOnce({ Item: undefined }) // activity 不在
			.mockResolvedValueOnce({});
		const { insertActivityLog } = await loadRepo();
		const log = await insertActivityLog(
			{
				childId: CHILD_ID,
				activityId: 99,
				points: 5,
				streakDays: 0,
				streakBonus: 0,
				recordedDate: '2026-06-04',
				recordedAt: '2026-06-04T09:00:00.000Z',
			},
			TENANT,
		);
		expect(log.id).toBe(1);
		const put = mockSend.mock.calls[2]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(put.input.Item?.activityName).toBe('');
		expect(put.input.Item?.activityIcon).toBe('');
		expect(put.input.Item?.categoryId).toBe(0);
	});
});

// ============================================================
// read 整合 round-trip: insert した LOG が既存 read で読めること
// ============================================================

describe('read 整合 (insertActivityLog → findActivityLogs / findDailyLog round-trip)', () => {
	it('insert した LOG item を findActivityLogs が ActivityLogSummary に正しく map する', async () => {
		// 1) insert (counter / lookup / put)
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 55 } })
			.mockResolvedValueOnce({ Item: makeChildActivityItem({ id: 7 }) })
			.mockResolvedValueOnce({});
		const repo = await loadRepo();
		await repo.insertActivityLog(
			{
				childId: CHILD_ID,
				activityId: 7,
				points: 10,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-06-04',
				recordedAt: '2026-06-04T09:00:00.000Z',
			},
			TENANT,
		);
		const putItem = (mockSend.mock.calls[2]?.[0] as { input: { Item: Record<string, unknown> } })
			.input.Item;

		// 2) その item を findActivityLogs の Query response として返す (= DynamoDB に書かれた item)
		mockSend.mockResolvedValueOnce({ Items: [putItem] });
		const summaries = await repo.findActivityLogs(CHILD_ID, TENANT);
		expect(summaries).toHaveLength(1);
		// 非正規化 field が ActivityLogSummary に正しく現れる (read が壊れない)
		expect(summaries[0]).toMatchObject({
			id: 55,
			activityName: 'なわとび',
			activityIcon: '🪢',
			categoryId: 3,
			points: 10,
			streakDays: 1,
			streakBonus: 0,
			recordedAt: '2026-06-04T09:00:00.000Z',
		});

		// 3) 同 item を findDailyLog の Query response として返す (date+activity 一致で読める)
		mockSend.mockResolvedValueOnce({ Items: [putItem] });
		const daily = await repo.findDailyLog(CHILD_ID, 7, '2026-06-04', TENANT);
		expect(daily?.id).toBe(55);
		expect(daily?.cancelled).toBe(0);
	});

	it('insert した LOG item を findTodayLogsWithCategory が categoryId 付きで読む', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 60 } })
			.mockResolvedValueOnce({ Item: makeChildActivityItem({ id: 7, categoryId: 4 }) })
			.mockResolvedValueOnce({});
		const repo = await loadRepo();
		await repo.insertActivityLog(
			{
				childId: CHILD_ID,
				activityId: 7,
				points: 10,
				streakDays: 0,
				streakBonus: 0,
				recordedDate: '2026-06-04',
				recordedAt: '2026-06-04T09:00:00.000Z',
			},
			TENANT,
		);
		const putItem = (mockSend.mock.calls[2]?.[0] as { input: { Item: Record<string, unknown> } })
			.input.Item;

		mockSend.mockResolvedValueOnce({ Items: [putItem] });
		const logs = await repo.findTodayLogsWithCategory(CHILD_ID, '2026-06-04', TENANT);
		expect(logs).toEqual([{ activityId: 7, categoryId: 4 }]);
	});
});

// ============================================================
// insertPointLedger (CRITICAL — ポイント付与の本経路)
// ============================================================

describe('insertPointLedger', () => {
	it('counter 採番 → POINT# key で Put する (read が読める形式)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 201 } }) // nextId(pointLedger)
			.mockResolvedValueOnce({}); // PutCommand
		const { insertPointLedger } = await loadRepo();
		await insertPointLedger(
			{
				childId: CHILD_ID,
				amount: 10,
				type: 'activity',
				description: 'なわとび',
				referenceId: 55,
			},
			TENANT,
		);

		const put = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(put.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		// read 側が begins_with(SK, 'POINT#…') で読む key 形式 (POINT#<createdAt>#<paddedId>)
		expect(String(put.input.Item?.SK)).toMatch(/^POINT#.+#00000201$/);
		expect(put.input.Item?.amount).toBe(10);
		expect(put.input.Item?.type).toBe('activity');
		expect(put.input.Item?.description).toBe('なわとび');
		expect(put.input.Item?.referenceId).toBe(55);
		// createdAt は YYYY-MM-DD… (countPointLedgerEntriesByTypeAndDate の begins_with 用)
		expect(String(put.input.Item?.createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('referenceId 省略時は null で保存する', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insertPointLedger } = await loadRepo();
		await insertPointLedger(
			{ childId: CHILD_ID, amount: 3, type: 'combo_bonus', description: 'combo' },
			TENANT,
		);
		const put = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(put.input.Item?.referenceId).toBeNull();
	});
});

// ============================================================
// family-master CRUD (child_activities per-child 経由)
// ============================================================

describe('insertActivity (family-master → child_activities)', () => {
	it('tenant の最初の child に bind し child_activities へ Put、Activity shape を返す', async () => {
		mockSend
			// findFirstChild Scan (PROFILE)
			.mockResolvedValueOnce({
				Items: [
					{ id: 900 },
					{ id: 42 },
					{ id: 100 },
				],
			})
			// childActivityRepo.insertActivity: nextId(childActivity)
			.mockResolvedValueOnce({ Attributes: { counter: 9 } })
			// childActivityRepo.insertActivity: PutCommand
			.mockResolvedValueOnce({});

		const { insertActivity } = await loadRepo();
		const activity = await insertActivity(
			{
				name: 'すいえい',
				categoryId: 3,
				icon: '🏊',
				basePoints: 15,
				ageMin: null,
				ageMax: null,
			},
			TENANT,
		);

		// 最初の child (id 昇順で 42) に bind される
		expect(activity).toMatchObject({
			id: 9,
			name: 'すいえい',
			categoryId: 3,
			icon: '🏊',
			basePoints: 15,
			isVisible: 1,
			priority: 'optional',
			// family-master 列は per-child instance に無いため null で埋める
			ageMin: null,
			ageMax: null,
			gradeLevel: null,
		});
		const put = mockSend.mock.calls[2]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(put.input.Item?.PK).toBe(`T#${TENANT}#CHILD#42`);
		expect(put.input.Item?.SK).toBe('CHILDACT#00000009');
	});

	it('tenant に child が無いとき throw する', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] }); // findFirstChild Scan = 0 件
		const { insertActivity } = await loadRepo();
		await expect(
			insertActivity(
				{ name: 'x', categoryId: 1, icon: '🏃', basePoints: 5, ageMin: null, ageMax: null },
				TENANT,
			),
		).rejects.toThrow(/child が存在しない/);
	});
});

describe('updateActivity (family-master → child_activities)', () => {
	it('id 逆引き → child scope で UpdateItem し Activity shape を返す', async () => {
		mockSend
			// resolveChildIdForActivity Scan
			.mockResolvedValueOnce({ Items: [{ childId: CHILD_ID }] })
			// childActivityRepo.updateActivity UpdateItem (ALL_NEW)
			.mockResolvedValueOnce({ Attributes: makeChildActivityItem({ id: 7, name: 'なわとび改' }) });
		const { updateActivity } = await loadRepo();
		const row = await updateActivity(7, { name: 'なわとび改', ageMin: 5 }, TENANT);
		expect(row?.name).toBe('なわとび改');
		// ageMin は child_activities に無いため drop される (UpdateExpression に含まれない)
		const upd = mockSend.mock.calls[1]?.[0] as { input: { UpdateExpression?: string } };
		expect(upd.input.UpdateExpression).toContain('#name = :name');
		expect(upd.input.UpdateExpression).not.toContain('ageMin');
	});

	it('id 逆引きで child が見つからないとき undefined を返し Update しない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] }); // resolve Scan 0 件
		const { updateActivity } = await loadRepo();
		expect(await updateActivity(999, { name: 'x' }, TENANT)).toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

describe('setActivityVisibility (family-master → child_activities)', () => {
	it('id 逆引き → isVisible を SET し Activity shape を返す', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [{ childId: CHILD_ID }] })
			.mockResolvedValueOnce({ Attributes: makeChildActivityItem({ id: 7, isVisible: 0 }) });
		const { setActivityVisibility } = await loadRepo();
		const row = await setActivityVisibility(7, false, TENANT);
		expect(row?.isVisible).toBe(0);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(upd.input.ExpressionAttributeValues?.[':v']).toBe(0);
	});
});

describe('deleteActivity (family-master → child_activities)', () => {
	it('id 逆引き → DeleteItem (ALL_OLD) し削除した Activity を返す', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [{ childId: CHILD_ID }] })
			.mockResolvedValueOnce({ Attributes: makeChildActivityItem({ id: 7 }) });
		const { deleteActivity } = await loadRepo();
		const row = await deleteActivity(7, TENANT);
		expect(row?.id).toBe(7);
		const del = mockSend.mock.calls[1]?.[0] as { input: { Key?: Record<string, unknown> } };
		expect(del.input.Key?.SK).toBe('CHILDACT#00000007');
	});

	it('id 逆引きで child 不在のとき undefined', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { deleteActivity } = await loadRepo();
		expect(await deleteActivity(999, TENANT)).toBeUndefined();
	});
});

// ============================================================
// archiveActivities / restoreArchivedActivities (child_activities 委譲)
// ============================================================

describe('archiveActivities / restoreArchivedActivities (child_activities 委譲)', () => {
	it('archiveActivities: tenant Scan で id 解決 → isArchived=1 + reason を SET', async () => {
		mockSend
			// child-activity-repo.archiveActivities の scanChildActivities Scan
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDACT#00000007' }],
			})
			.mockResolvedValueOnce({}); // UpdateItem
		const { archiveActivities } = await loadRepo();
		await archiveActivities([7], 'trial_expired', TENANT);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(upd.input.UpdateExpression).toContain('isArchived = :one');
		expect(upd.input.ExpressionAttributeValues?.[':reason']).toBe('trial_expired');
	});

	it('archiveActivities: ids 空のとき何も send しない', async () => {
		const { archiveActivities } = await loadRepo();
		await archiveActivities([], 'trial_expired', TENANT);
		expect(mockSend).not.toHaveBeenCalled();
	});

	it('restoreArchivedActivities: reason 一致を Scan → isArchived=0 + reason REMOVE', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CHILDACT#00000007' }],
			})
			.mockResolvedValueOnce({}); // UpdateItem
		const { restoreArchivedActivities } = await loadRepo();
		await restoreArchivedActivities('trial_expired', TENANT);
		const upd = mockSend.mock.calls[1]?.[0] as { input: { UpdateExpression?: string } };
		expect(upd.input.UpdateExpression).toContain('isArchived = :zero');
		expect(upd.input.UpdateExpression).toContain('REMOVE archivedReason');
	});
});

// ============================================================
// interface 適合 (stub 後退していないこと)
// ============================================================

describe('write 8 method が stub (NotImplementedError throw) に後退していない', () => {
	it('全 write method を export している', async () => {
		const repo = await loadRepo();
		for (const m of [
			'insertActivity',
			'updateActivity',
			'setActivityVisibility',
			'deleteActivity',
			'archiveActivities',
			'restoreArchivedActivities',
			'insertActivityLog',
			'insertPointLedger',
		]) {
			expect(typeof (repo as Record<string, unknown>)[m]).toBe('function');
		}
	});

	it('insertActivityLog は throw せず実 Put する (旧 stub なら throw だった)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 1 } })
			.mockResolvedValueOnce({ Item: undefined })
			.mockResolvedValueOnce({});
		const { insertActivityLog } = await loadRepo();
		const log = await insertActivityLog(
			{
				childId: CHILD_ID,
				activityId: 1,
				points: 1,
				streakDays: 0,
				streakBonus: 0,
				recordedDate: '2026-06-04',
				recordedAt: '2026-06-04T00:00:00.000Z',
			},
			TENANT,
		);
		expect(log.id).toBe(1);
		expect(mockSend).toHaveBeenCalled();
	});

	it('insertPointLedger は throw せず実 Put する (旧 stub なら throw だった)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insertPointLedger } = await loadRepo();
		await expect(
			insertPointLedger({ childId: CHILD_ID, amount: 1, type: 'activity', description: 'x' }, TENANT),
		).resolves.toBeUndefined();
		expect(mockSend).toHaveBeenCalled();
	});
});
