// tests/unit/services/activity-legacy-table-write-zero-dynamodb.test.ts
//
// #2458-A2 regression test (dynamodb backend): dynamodb activity-repo の全 write
// method が NotImplementedError を throw することを保証する。
//
// ADR-0048 で DynamoDB backend は production 未使用 (main Lambda は sqlite local
// file + S3 backup)。本テストは「旧 activities partition (SK=MASTER) への write が
// 物理的に発生しない」ことを構造的にガードする。再実装時は ADR-0055 per-child
// schema (dynamodb/child-activity-repo.ts) 経由で実装し直す必要がある。
//
// AWS SDK は hoisted mock で置き換え、mockSend が呼ばれなかったことも assert する
// (NotImplementedError は DynamoDB Client に到達する前に throw されるべき)。
//
// 関連:
//   - PR #2487 (#2458-A1 sqlite facade rewrite、reference pattern)
//   - ADR-0055 §3.1 per-child primary data model
//   - ADR-0048 §2 demo Lambda stateless 原則
//   - tests/unit/db/dynamodb-push-subscription-repo.test.ts (mock pattern reference)

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
	class GetCmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class PutCmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class QueryCmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class DeleteCmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class UpdateCmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class ScanCmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class BatchWriteCmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	return {
		mockSend: send,
		MockGetCommand: GetCmd,
		MockPutCommand: PutCmd,
		MockQueryCommand: QueryCmd,
		MockDeleteCommand: DeleteCmd,
		MockUpdateCommand: UpdateCmd,
		MockScanCommand: ScanCmd,
		MockBatchWriteCommand: BatchWriteCmd,
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

const TENANT = 't-dynamodb-2458-write-zero';

describe('#2458-A2 dynamodb: 旧 activities partition への write 0 件保証', () => {
	beforeEach(() => {
		mockSend.mockClear();
	});

	it('insertActivity: NotImplementedError throw + DynamoDB Client 未到達', async () => {
		await expect(
			dynamoActivityRepo.insertActivity(
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
			),
		).rejects.toThrow(/insertActivity not implemented/);

		// AC: AWS SDK send() が呼ばれていない (write が物理的に発生しない)
		expect(mockSend).not.toHaveBeenCalled();
	});

	it('updateActivity: NotImplementedError throw + DynamoDB Client 未到達', async () => {
		await expect(dynamoActivityRepo.updateActivity(1, { name: '更新後' }, TENANT)).rejects.toThrow(
			/updateActivity not implemented/,
		);

		expect(mockSend).not.toHaveBeenCalled();
	});

	it('setActivityVisibility: NotImplementedError throw + DynamoDB Client 未到達', async () => {
		await expect(dynamoActivityRepo.setActivityVisibility(1, false, TENANT)).rejects.toThrow(
			/setActivityVisibility not implemented/,
		);

		expect(mockSend).not.toHaveBeenCalled();
	});

	it('deleteActivity: NotImplementedError throw + DynamoDB Client 未到達', async () => {
		await expect(dynamoActivityRepo.deleteActivity(1, TENANT)).rejects.toThrow(
			/deleteActivity not implemented/,
		);

		expect(mockSend).not.toHaveBeenCalled();
	});

	it('archiveActivities: NotImplementedError throw + DynamoDB Client 未到達', async () => {
		await expect(
			dynamoActivityRepo.archiveActivities([1, 2, 3], 'test-reason', TENANT),
		).rejects.toThrow(/archiveActivities not implemented/);

		expect(mockSend).not.toHaveBeenCalled();
	});

	it('restoreArchivedActivities: NotImplementedError throw + DynamoDB Client 未到達', async () => {
		await expect(
			dynamoActivityRepo.restoreArchivedActivities('test-reason', TENANT),
		).rejects.toThrow(/restoreArchivedActivities not implemented/);

		expect(mockSend).not.toHaveBeenCalled();
	});

	it('insertActivityLog: NotImplementedError throw + DynamoDB Client 未到達', async () => {
		await expect(
			dynamoActivityRepo.insertActivityLog(
				{
					childId: 1,
					activityId: 100,
					points: 5,
					streakDays: 1,
					streakBonus: 0,
					recordedDate: '2026-05-26',
					recordedAt: '2026-05-26T10:00:00Z',
				},
				TENANT,
			),
		).rejects.toThrow(/insertActivityLog not implemented/);

		expect(mockSend).not.toHaveBeenCalled();
	});

	it('insertPointLedger: NotImplementedError throw + DynamoDB Client 未到達', async () => {
		await expect(
			dynamoActivityRepo.insertPointLedger(
				{
					childId: 1,
					amount: 100,
					type: 'combo_bonus',
					description: 'test',
				},
				TENANT,
			),
		).rejects.toThrow(/insertPointLedger not implemented/);

		expect(mockSend).not.toHaveBeenCalled();
	});

	it('全 write エラー message に再実装方針が含まれる (ADR-0055 child-activity-repo 経由)', async () => {
		// エラー文言が誘導すべき: dynamodb/child-activity-repo.ts (ADR-0055 per-child) 経由
		const methods: Array<[string, () => Promise<unknown>]> = [
			[
				'insertActivity',
				() =>
					dynamoActivityRepo.insertActivity(
						{
							name: 'x',
							categoryId: 1,
							icon: 'x',
							basePoints: 1,
							ageMin: null,
							ageMax: null,
							triggerHint: null,
						},
						TENANT,
					),
			],
			['updateActivity', () => dynamoActivityRepo.updateActivity(1, { name: 'x' }, TENANT)],
			['archiveActivities', () => dynamoActivityRepo.archiveActivities([1], 'r', TENANT)],
		];

		for (const [name, fn] of methods) {
			try {
				await fn();
				expect.fail(`${name} should throw`);
			} catch (e) {
				const msg = (e as Error).message;
				expect(msg).toContain('ADR-0055');
				expect(msg).toContain('child-activity-repo');
			}
		}
	});
});

describe('#2458-A2 dynamodb: read 経路は引き続き activities partition を Scan/Query', () => {
	beforeEach(() => {
		mockSend.mockClear();
	});

	it('findActivities: Scan 1 回呼ばれる (write は発生しない)', async () => {
		// Scan は空配列を返すよう mock
		mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

		const list = await dynamoActivityRepo.findActivities(TENANT, {});

		expect(list).toEqual([]);
		expect(mockSend).toHaveBeenCalledTimes(1);
		// AC: 呼ばれたのは ScanCommand であり Put/Update/Delete ではない
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
