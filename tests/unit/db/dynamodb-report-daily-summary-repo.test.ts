/**
 * tests/unit/db/dynamodb-report-daily-summary-repo.test.ts
 *
 * #2824 Wave 6B (ADR-0055) — report-daily-summary-repo DynamoDB 本実装の単体テスト。
 *
 * 旧 stub (#2263 hotfix: read = 空 / write = no-op) を DynamoDB 本実装に置換したため、
 * AWS SDK を hoisted mock で置き換え、SQLite 機能等価の 6 関数を網羅する。
 *
 * キー設計 (keys.ts reportDailySummaryKey): PK = T#<tenant>#RDS, SK = <date>#<childId>
 *   - tenant+date / child+date 範囲は同 partition の SK BETWEEN Query
 *   - upsert は SK 決定的 PutItem 上書き (SQLite onConflictDoUpdate 等価)
 *   - deleteOlderThan は SK <= <cutoff>￿ Query → 個別 Delete
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockSend,
	MockGetCommand,
	MockPutCommand,
	MockQueryCommand,
	MockDeleteCommand,
	MockScanCommand,
	MockUpdateCommand,
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
		MockDeleteCommand: class extends Cmd {},
		MockScanCommand: class extends Cmd {},
		MockUpdateCommand: class extends Cmd {},
		MockBatchWriteCommand: class extends Cmd {},
	};
});

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
	GetCommand: MockGetCommand,
	PutCommand: MockPutCommand,
	QueryCommand: MockQueryCommand,
	DeleteCommand: MockDeleteCommand,
	ScanCommand: MockScanCommand,
	UpdateCommand: MockUpdateCommand,
	BatchWriteCommand: MockBatchWriteCommand,
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/report-daily-summary-repo');
}

const TENANT = 'tenant-1';

function callOf(idx: number): { input: Record<string, unknown> } {
	return mockSend.mock.calls[idx]?.[0] as { input: Record<string, unknown> };
}

function row(childId: number, date: string): Record<string, unknown> {
	return {
		PK: `T#${TENANT}#RDS`,
		SK: `${date}#${String(childId).padStart(8, '0')}`,
		id: childId * 10,
		tenantId: TENANT,
		childId,
		date,
		activityCount: 3,
		categoryBreakdown: '{}',
		checklistCompletion: '{}',
		level: 2,
		totalPoints: 100,
		streakDays: 1,
		newAchievements: 0,
		createdAt: '2026-05-01T00:00:00.000Z',
	};
}

beforeEach(() => {
	mockSend.mockReset();
});
afterEach(() => {
	vi.clearAllMocks();
});

describe('findByTenantAndDateRange', () => {
	it('SK BETWEEN <start> AND <end>￿ で tenant の date 範囲を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [row(1, '2026-05-01'), row(2, '2026-05-02')] });
		const { findByTenantAndDateRange } = await loadRepo();
		const result = await findByTenantAndDateRange(TENANT, '2026-05-01', '2026-05-02');
		expect(result).toHaveLength(2);
		expect((result[0] as unknown as Record<string, unknown>).PK).toBeUndefined();
		const arg = callOf(0).input;
		expect(arg.KeyConditionExpression).toContain('SK BETWEEN :start AND :end');
		const v = arg.ExpressionAttributeValues as Record<string, string>;
		expect(v[':pk']).toBe(`T#${TENANT}#RDS`);
		expect(v[':start']).toBe('2026-05-01');
		expect(v[':end']).toBe('2026-05-02￿');
	});

	it('ページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [row(1, '2026-05-01')],
				LastEvaluatedKey: { PK: 'c', SK: 'c' },
			})
			.mockResolvedValueOnce({ Items: [row(2, '2026-05-02')], LastEvaluatedKey: undefined });
		const { findByTenantAndDateRange } = await loadRepo();
		const result = await findByTenantAndDateRange(TENANT, '2026-05-01', '2026-05-31');
		expect(result).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});

describe('findByChildAndDateRange', () => {
	it('tenant date 範囲 Query を childId で絞り込む', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [row(1, '2026-05-01'), row(2, '2026-05-01'), row(1, '2026-05-02')],
		});
		const { findByChildAndDateRange } = await loadRepo();
		const result = await findByChildAndDateRange(1, '2026-05-01', '2026-05-02', TENANT);
		expect(result).toHaveLength(2);
		expect(result.every((r) => r.childId === 1)).toBe(true);
	});
});

describe('upsert', () => {
	it('新規 (既存なし) は counter 採番 + PutItem。SK 決定的', async () => {
		mockSend
			.mockResolvedValueOnce({ Item: undefined }) // GetCommand (既存チェック)
			.mockResolvedValueOnce({ Attributes: { counter: 11 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand
		const { upsert } = await loadRepo();
		await upsert({
			tenantId: TENANT,
			childId: 5,
			date: '2026-05-10',
			activityCount: 4,
			categoryBreakdown: '{"a":1}',
			checklistCompletion: '{}',
			level: 3,
			totalPoints: 200,
			streakDays: 2,
			newAchievements: 1,
		});
		const putArg = callOf(2).input;
		const item = putArg.Item as Record<string, unknown>;
		expect(item.PK).toBe(`T#${TENANT}#RDS`);
		expect(item.SK).toBe('2026-05-10#00000005');
		expect(item.id).toBe(11);
		expect(item.activityCount).toBe(4);
	});

	it('既存ありは id / createdAt を維持して上書き (counter 採番しない)', async () => {
		mockSend
			.mockResolvedValueOnce({ Item: { id: 77, createdAt: '2026-01-01T00:00:00.000Z' } }) // GetCommand
			.mockResolvedValueOnce({}); // PutCommand (nextId は呼ばれない)
		const { upsert } = await loadRepo();
		await upsert({
			tenantId: TENANT,
			childId: 5,
			date: '2026-05-10',
			activityCount: 9,
			categoryBreakdown: '{}',
			checklistCompletion: '{}',
			level: 1,
			totalPoints: 0,
			streakDays: 0,
			newAchievements: 0,
		});
		expect(mockSend).toHaveBeenCalledTimes(2); // Get + Put のみ (nextId なし)
		const item = callOf(1).input.Item as Record<string, unknown>;
		expect(item.id).toBe(77);
		expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z');
		expect(item.activityCount).toBe(9);
	});
});

describe('deleteOlderThan', () => {
	it('SK <= <cutoff>￿ を Query → 個別 Delete し件数を返す', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [
					{ PK: `T#${TENANT}#RDS`, SK: '2026-04-01#00000001' },
					{ PK: `T#${TENANT}#RDS`, SK: '2026-04-02#00000002' },
				],
			})
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({});
		const { deleteOlderThan } = await loadRepo();
		const n = await deleteOlderThan(TENANT, '2026-04-30');
		expect(n).toBe(2);
		const qArg = callOf(0).input;
		expect(qArg.KeyConditionExpression).toContain('SK <= :cutoff');
		expect((qArg.ExpressionAttributeValues as Record<string, string>)[':cutoff']).toBe(
			'2026-04-30￿',
		);
	});

	it('該当なしで 0', async () => {
		mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
		const { deleteOlderThan } = await loadRepo();
		expect(await deleteOlderThan(TENANT, '2026-04-30')).toBe(0);
	});
});

describe('deleteByTenantId', () => {
	it('exact PK Query + BatchWrite で tenant partition を一掃する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#RDS`, SK: '2026-05-01#00000001' }],
				LastEvaluatedKey: undefined,
			})
			.mockResolvedValueOnce({}); // BatchWrite
		const { deleteByTenantId } = await loadRepo();
		await deleteByTenantId(TENANT);
		const qArg = callOf(0).input;
		expect(qArg.KeyConditionExpression).toContain('PK = :pk');
		expect((qArg.ExpressionAttributeValues as Record<string, string>)[':pk']).toBe(
			`T#${TENANT}#RDS`,
		);
	});
});
