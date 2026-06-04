/**
 * tests/unit/db/dynamodb-auto-challenge-repo.test.ts
 *
 * #2824 Wave 6A / ADR-0055: DynamoDB 週次自動チャレンジ repo 本実装の単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/auto-challenge-repo.ts、挙動 SSOT) と
 * 機能等価であることを method ごとに検証する:
 *   - 正しい Command + key で send する (PK=CHILD#<id> / SK=AUTOCHAL#<weekStart>)
 *   - response を正しく型変換する (stripKeys / default backfill)
 *   - SQLite 機能等価 (week_start DESC 並び / status='active' filter / id 解決による update / expire)
 *
 * 背景: 本 repo は #2263 hotfix で read=空 / write=no-op 化され、自動チャレンジの生成・進捗が本番
 *   DynamoDB Lambda で永続しなかった (週ごとリセット)。本テストは本実装の機能等価性を回帰固定する。
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
	// deleteByTenantId は bulk-delete.ts (BatchWriteCommand + ScanCommand) を動的 import する。
	BatchWriteCommand: class {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	},
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/auto-challenge-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;
const WEEK = '2026-05-12';

/** child partition の DynamoDB auto-challenge item を組み立てる (PK/SK + 属性)。 */
function makeItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const weekStart = (over.weekStart as string) ?? WEEK;
	return {
		PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
		SK: `AUTOCHAL#${weekStart}`,
		id: (over.id as number) ?? 1,
		childId: CHILD_ID,
		tenantId: TENANT,
		weekStart,
		categoryId: 3,
		targetCount: 5,
		currentCount: 0,
		status: 'active',
		createdAt: '2026-05-12T00:00:00.000Z',
		updatedAt: '2026-05-12T00:00:00.000Z',
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
// findByChildAndWeek
// ============================================================

describe('findByChildAndWeek', () => {
	it('GetItem で childId + weekStart 既知の 1 件を取得し型変換する', async () => {
		mockSend.mockResolvedValueOnce({ Item: makeItem() });

		const { findByChildAndWeek } = await loadRepo();
		const result = await findByChildAndWeek(CHILD_ID, WEEK, TENANT);

		expect(result).toMatchObject({
			id: 1,
			childId: CHILD_ID,
			tenantId: TENANT,
			weekStart: WEEK,
			categoryId: 3,
			targetCount: 5,
			currentCount: 0,
			status: 'active',
		});
		const call = mockSend.mock.calls[0]?.[0] as { input: { Key?: Record<string, unknown> } };
		expect(call.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(call.input.Key?.SK).toBe(`AUTOCHAL#${WEEK}`);
	});

	it('未存在なら undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({});
		const { findByChildAndWeek } = await loadRepo();
		await expect(findByChildAndWeek(CHILD_ID, WEEK, TENANT)).resolves.toBeUndefined();
	});
});

// ============================================================
// findActiveByChild
// ============================================================

describe('findActiveByChild', () => {
	it('active のみを抽出し week_start 降順の先頭を返す (SQLite ORDER BY week_start DESC LIMIT 1 等価)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, weekStart: '2026-05-05', status: 'expired' }),
				makeItem({ id: 2, weekStart: '2026-05-12', status: 'active' }),
				makeItem({ id: 3, weekStart: '2026-05-19', status: 'active' }),
			],
		});

		const { findActiveByChild } = await loadRepo();
		const result = await findActiveByChild(CHILD_ID, TENANT);

		// 最新 weekStart の active (id=3) が返る (expired は除外)。
		expect(result?.id).toBe(3);
		expect(result?.weekStart).toBe('2026-05-19');
		const call = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(call.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(call.input.ExpressionAttributeValues?.[':prefix']).toBe('AUTOCHAL#');
	});

	it('active が無ければ undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, status: 'expired' })],
		});
		const { findActiveByChild } = await loadRepo();
		await expect(findActiveByChild(CHILD_ID, TENANT)).resolves.toBeUndefined();
	});

	it('Query をページング (LastEvaluatedKey が尽きるまで) して全件評価する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeItem({ id: 1, weekStart: '2026-05-05', status: 'active' })],
				LastEvaluatedKey: { PK: 'x', SK: 'y' },
			})
			.mockResolvedValueOnce({
				Items: [makeItem({ id: 2, weekStart: '2026-05-12', status: 'active' })],
			});

		const { findActiveByChild } = await loadRepo();
		const result = await findActiveByChild(CHILD_ID, TENANT);
		// 2 ページ走査した上で最新 weekStart (id=2) が返る。
		expect(result?.id).toBe(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});

// ============================================================
// findByChild
// ============================================================

describe('findByChild', () => {
	it('week_start 降順で limit 件返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, weekStart: '2026-05-05' }),
				makeItem({ id: 2, weekStart: '2026-05-19' }),
				makeItem({ id: 3, weekStart: '2026-05-12' }),
			],
		});

		const { findByChild } = await loadRepo();
		const result = await findByChild(CHILD_ID, TENANT, 2);

		expect(result.map((c) => c.weekStart)).toEqual(['2026-05-19', '2026-05-12']);
	});

	it('default limit は 10', async () => {
		mockSend.mockResolvedValueOnce({
			Items: Array.from({ length: 12 }, (_, i) =>
				makeItem({ id: i + 1, weekStart: `2026-05-${String(i + 1).padStart(2, '0')}` }),
			),
		});
		const { findByChild } = await loadRepo();
		const result = await findByChild(CHILD_ID, TENANT);
		expect(result).toHaveLength(10);
	});
});

// ============================================================
// insert
// ============================================================

describe('insert', () => {
	it('counter 採番 → PutItem し SQLite default 値を埋めた row を返す (永続の核心経路)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 101 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand

		const { insert } = await loadRepo();
		const result = await insert(
			{ childId: CHILD_ID, weekStart: WEEK, categoryId: 3, targetCount: 5 },
			TENANT,
		);

		expect(result.id).toBe(101);
		expect(result).toMatchObject({
			childId: CHILD_ID,
			tenantId: TENANT,
			weekStart: WEEK,
			categoryId: 3,
			targetCount: 5,
			// SQLite schema default
			currentCount: 0,
			status: 'active',
		});
		expect(typeof result.createdAt).toBe('string');
		expect(typeof result.updatedAt).toBe('string');

		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(putCall.input.Item?.SK).toBe(`AUTOCHAL#${WEEK}`);
		expect(putCall.input.Item?.currentCount).toBe(0);
		expect(putCall.input.Item?.status).toBe('active');
	});
});

// ============================================================
// update
// ============================================================

describe('update', () => {
	it('tenant Scan で id を解決し currentCount / status を SET する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: `AUTOCHAL#${WEEK}` }],
			}) // Scan
			.mockResolvedValueOnce({}); // UpdateCommand

		const { update } = await loadRepo();
		await update(7, { currentCount: 3, status: 'completed' }, TENANT);

		expect(mockSend).toHaveBeenCalledTimes(2);
		const updCall = mockSend.mock.calls[1]?.[0] as {
			input: {
				Key?: Record<string, unknown>;
				UpdateExpression?: string;
				ExpressionAttributeNames?: Record<string, string>;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(updCall.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(updCall.input.Key?.SK).toBe(`AUTOCHAL#${WEEK}`);
		expect(updCall.input.UpdateExpression).toContain('currentCount = :cc');
		expect(updCall.input.UpdateExpression).toContain('#status = :st');
		// status は予約語のため alias escape されている。
		expect(updCall.input.ExpressionAttributeNames?.['#status']).toBe('status');
		expect(updCall.input.ExpressionAttributeValues?.[':cc']).toBe(3);
		expect(updCall.input.ExpressionAttributeValues?.[':st']).toBe('completed');
	});

	it('id 不在 (Scan 空) なら何もしない (UpdateCommand を呼ばない)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] }); // Scan 空

		const { update } = await loadRepo();
		await update(999, { currentCount: 1 }, TENANT);

		// Scan の 1 回のみ (Update は呼ばれない)。
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('currentCount のみ指定時は status alias を付けない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [{ PK: 'p', SK: 's' }] }).mockResolvedValueOnce({});

		const { update } = await loadRepo();
		await update(7, { currentCount: 2 }, TENANT);

		const updCall = mockSend.mock.calls[1]?.[0] as {
			input: { ExpressionAttributeNames?: Record<string, string> };
		};
		expect(updCall.input.ExpressionAttributeNames).toBeUndefined();
	});
});

// ============================================================
// expireOldChallenges
// ============================================================

describe('expireOldChallenges', () => {
	it('active かつ week_start < beforeDate を Scan し各 item を expired に更新する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [
					{ PK: 'p1', SK: 'AUTOCHAL#2026-04-28' },
					{ PK: 'p2', SK: 'AUTOCHAL#2026-05-05' },
				],
			}) // Scan
			.mockResolvedValueOnce({}) // Update 1
			.mockResolvedValueOnce({}); // Update 2

		const { expireOldChallenges } = await loadRepo();
		const count = await expireOldChallenges('2026-05-12', TENANT);

		expect(count).toBe(2);
		const scanCall = mockSend.mock.calls[0]?.[0] as {
			input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(scanCall.input.FilterExpression).toContain('#status = :active');
		expect(scanCall.input.FilterExpression).toContain('weekStart < :before');
		expect(scanCall.input.ExpressionAttributeValues?.[':active']).toBe('active');
		expect(scanCall.input.ExpressionAttributeValues?.[':before']).toBe('2026-05-12');

		const updCall = mockSend.mock.calls[1]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(updCall.input.ExpressionAttributeValues?.[':expired']).toBe('expired');
	});

	it('対象 0 件なら 0 を返し Update を呼ばない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { expireOldChallenges } = await loadRepo();
		await expect(expireOldChallenges('2026-05-12', TENANT)).resolves.toBe(0);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('Scan を全ページ走査する (#2842 Limit なしページング)', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: 'p1', SK: 'AUTOCHAL#2026-04-28' }],
				LastEvaluatedKey: { PK: 'p1', SK: 'AUTOCHAL#2026-04-28' },
			})
			.mockResolvedValueOnce({ Items: [{ PK: 'p2', SK: 'AUTOCHAL#2026-05-05' }] })
			.mockResolvedValueOnce({}) // Update 1
			.mockResolvedValueOnce({}); // Update 2

		const { expireOldChallenges } = await loadRepo();
		const count = await expireOldChallenges('2026-05-12', TENANT);
		expect(count).toBe(2);
		// Scan 2 ページ + Update 2 件 = 4 send。
		expect(mockSend).toHaveBeenCalledTimes(4);
	});
});

// ============================================================
// deleteByTenantId
// ============================================================

describe('deleteByTenantId', () => {
	it('throw せず resolve する (bulk-delete 経路)', async () => {
		// bulk-delete の Scan ループ: 1 ページで空を返す。
		mockSend.mockResolvedValue({ Items: [] });
		const { deleteByTenantId } = await loadRepo();
		await expect(deleteByTenantId(TENANT)).resolves.toBeUndefined();
	});
});
