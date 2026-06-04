// tests/unit/services/activity-legacy-table-write-zero-dynamodb.test.ts
//
// #2458-A2 → #2824 Wave 4A regression test (dynamodb backend):
//   旧 `activities` partition (SK=MASTER) への write が物理的に発生しないことを保証する。
//
// 経緯:
//   - #2458-A2 では「全 write method が NotImplementedError throw」でこの不変条件を担保していた
//     (= そもそも write しないので MASTER partition も触らない)。
//   - #2824 で本番 main Lambda (DATA_SOURCE=dynamodb) のコアループ gap を根治するため write 8
//     method を本実装化した。write は child_activities (CHILDACT#) / activity_logs (LOG#) /
//     point_ledger (POINT#) に書く。旧 `activities` partition (SK=MASTER) には依然として
//     一切 write しない。
//
// 本テストはこの不変条件 (write が成功し、かつ SK=MASTER への Put/Update が 0 件) を構造的に
// ガードする。assertion は「throw する」(旧) から「write は成功するが MASTER partition を
// 触らない」(現) へ強化されており、弱体化ではない (ADR-0006)。
//
// AWS SDK は hoisted mock で置き換え、全 send 呼び出しの Item.SK / Key.SK を検査する。
//
// 関連:
//   - PR #2487 (#2458-A1 sqlite facade rewrite)
//   - PR #2820 (dynamodb/child-activity-repo.ts 本実装、委譲先)
//   - ADR-0055 §3.1 per-child primary data model

import { beforeEach, describe, expect, it, vi } from 'vitest';

// AWS SDK Mock setup (vi.hoisted で先にモック関数とコマンドクラスを確保)
const {
	mockSend,
	MockGetCommand,
	MockPutCommand,
	MockQueryCommand,
	MockDeleteCommand,
	MockUpdateCommand,
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
		MockGetCommand: class GetCmd extends Cmd {},
		MockPutCommand: class PutCmd extends Cmd {},
		MockQueryCommand: class QueryCmd extends Cmd {},
		MockDeleteCommand: class DeleteCmd extends Cmd {},
		MockUpdateCommand: class UpdateCmd extends Cmd {},
		MockScanCommand: class ScanCmd extends Cmd {},
		MockBatchWriteCommand: class BatchWriteCmd extends Cmd {},
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
	DeleteCommand: MockDeleteCommand,
	UpdateCommand: MockUpdateCommand,
	ScanCommand: MockScanCommand,
	BatchWriteCommand: MockBatchWriteCommand,
}));

vi.mock('$lib/server/db/dynamodb/client', () => ({
	getDocClient: () => ({ send: mockSend }),
	TABLE_NAME: 'test-table',
}));

import * as dynamoActivityRepo from '$lib/server/db/dynamodb/activity-repo';

const TENANT = 't-dynamodb-2824-write-zero';

/**
 * mockSend の全呼び出しが旧 `activities` partition (SK=MASTER) を一切 Put/Update/Delete して
 * いないことを検証する。Put は Item.SK、Update/Delete は Key.SK を見る。
 */
function expectNoMasterPartitionWrite() {
	for (const call of mockSend.mock.calls) {
		const cmd = call[0] as { constructor?: { name?: string }; input?: Record<string, unknown> };
		const name = cmd.constructor?.name ?? '';
		const input = cmd.input ?? {};
		const itemSk = (input.Item as { SK?: string } | undefined)?.SK;
		const keySk = (input.Key as { SK?: string } | undefined)?.SK;
		// 旧 activities partition は SK === 'MASTER'。write 系 Command が MASTER を触っていないこと。
		if (name === 'PutCmd' || name === 'UpdateCmd' || name === 'DeleteCmd') {
			expect(itemSk).not.toBe('MASTER');
			expect(keySk).not.toBe('MASTER');
		}
	}
}

describe('#2824 dynamodb: write は本実装され、旧 activities partition (SK=MASTER) への write は 0 件', () => {
	beforeEach(() => {
		mockSend.mockReset();
	});

	it('insertActivity: child_activities (CHILDACT#) に Put、MASTER partition 不可触', async () => {
		mockSend
			// findFirstChild Scan (PROFILE)
			.mockResolvedValueOnce({ Items: [{ id: 5 }] })
			// childActivityRepo.insertActivity nextId
			.mockResolvedValueOnce({ Attributes: { counter: 1 } })
			// childActivityRepo.insertActivity Put
			.mockResolvedValueOnce({});

		const row = await dynamoActivityRepo.insertActivity(
			{
				name: 'たいそうした',
				categoryId: 1,
				icon: '🤸',
				basePoints: 5,
				ageMin: 3,
				ageMax: 12,
				triggerHint: null,
			},
			TENANT,
		);

		expect(row.id).toBe(1);
		const put = mockSend.mock.calls[2]?.[0] as { input: { Item?: { SK?: string } } };
		expect(put.input.Item?.SK).toMatch(/^CHILDACT#/);
		expectNoMasterPartitionWrite();
	});

	it('insertActivityLog: activity_logs (LOG#) に Put、MASTER partition 不可触', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 1 } }) // nextId(activityLog)
			.mockResolvedValueOnce({ Item: undefined }) // child_activities lookup
			.mockResolvedValueOnce({}); // Put

		await dynamoActivityRepo.insertActivityLog(
			{
				childId: 1,
				activityId: 100,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-06-04',
				recordedAt: '2026-06-04T10:00:00Z',
			},
			TENANT,
		);

		const put = mockSend.mock.calls[2]?.[0] as { input: { Item?: { SK?: string } } };
		expect(put.input.Item?.SK).toMatch(/^LOG#/);
		expectNoMasterPartitionWrite();
	});

	it('insertPointLedger: point_ledger (POINT#) に Put、MASTER partition 不可触', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 1 } }) // nextId(pointLedger)
			.mockResolvedValueOnce({}); // Put

		await dynamoActivityRepo.insertPointLedger(
			{ childId: 1, amount: 100, type: 'combo_bonus', description: 'test' },
			TENANT,
		);

		const put = mockSend.mock.calls[1]?.[0] as { input: { Item?: { SK?: string } } };
		expect(put.input.Item?.SK).toMatch(/^POINT#/);
		expectNoMasterPartitionWrite();
	});

	it('updateActivity: child_activities を Update、MASTER partition 不可触', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [{ childId: 5 }] }) // resolveChildIdForActivity Scan
			.mockResolvedValueOnce({
				Attributes: { PK: `T#${TENANT}#CHILD#5`, SK: 'CHILDACT#00000001', id: 1, name: '更新後' },
			}); // Update ALL_NEW

		const row = await dynamoActivityRepo.updateActivity(1, { name: '更新後' }, TENANT);
		expect(row?.name).toBe('更新後');
		const upd = mockSend.mock.calls[1]?.[0] as { input: { Key?: { SK?: string } } };
		expect(upd.input.Key?.SK).toMatch(/^CHILDACT#/);
		expectNoMasterPartitionWrite();
	});

	it('archiveActivities: child_activities を Update、MASTER partition 不可触', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [{ PK: `T#${TENANT}#CHILD#5`, SK: 'CHILDACT#00000001' }] })
			.mockResolvedValueOnce({}); // Update
		await dynamoActivityRepo.archiveActivities([1], 'trial_expired', TENANT);
		expectNoMasterPartitionWrite();
	});
});

describe('#2824 dynamodb: read 経路は引き続き Scan/Query (write は発生しない)', () => {
	beforeEach(() => {
		mockSend.mockReset();
	});

	it('findActivities: Scan 1 回呼ばれる (write は発生しない)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
		const list = await dynamoActivityRepo.findActivities(TENANT, {});
		expect(list).toEqual([]);
		expect(mockSend).toHaveBeenCalledTimes(1);
		const call = mockSend.mock.calls[0]?.[0];
		expect(call?.constructor?.name).toBe('ScanCmd');
	});

	it('findActivityById: Get 1 回呼ばれる (write は発生しない)', async () => {
		mockSend.mockResolvedValueOnce({ Item: undefined });
		const result = await dynamoActivityRepo.findActivityById(1, TENANT);
		expect(result).toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});
