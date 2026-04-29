/**
 * tests/unit/db/dynamodb-push-subscription-repo.test.ts
 *
 * #1689 (#1666 follow-up — ADR-0023 I6 / ADR-0010 / #1021 段階的リリース禁止)
 *
 * DynamoDB push-subscription-repo の本実装単体テスト。
 * AWS SDK を hoisted mock で置き換え、SQLite 機能等価の 7 関数を網羅する。
 *
 * テスト戦略:
 *   - findByTenant / findByEndpoint / insert / deleteByEndpoint / insertLog /
 *     countTodayLogs / findRecentLogs を全て個別 describe で検証
 *   - 各関数で送信される Command の input (KeyConditionExpression / Key 等) を assert
 *   - subscriberRole 必須属性が PutItem に含まれることを確認 (#1593 ADR-0023 I6)
 *   - 機能等価性: SQLite と同じ入出力契約 (PushSubscriptionRecord / NotificationLog)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AWS SDK Mock setup (vi.hoisted で先にモック関数とコマンドクラスを確保)
const {
	mockSend,
	MockGetCommand,
	MockPutCommand,
	MockQueryCommand,
	MockDeleteCommand,
	MockUpdateCommand,
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
	return {
		mockSend: send,
		MockGetCommand: GetCmd,
		MockPutCommand: PutCmd,
		MockQueryCommand: QueryCmd,
		MockDeleteCommand: DeleteCmd,
		MockUpdateCommand: UpdateCmd,
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
}));

// SUT — モック適用後に動的 import
async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/push-subscription-repo');
}

const TENANT_ID = 'tenant-1';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc-def-123';

beforeEach(() => {
	mockSend.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

// ============================================================
// findByTenant
// ============================================================

describe('findByTenant', () => {
	it('Query で tenant の全レコードを返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				{
					PK: 'T#tenant-1#PUSH_SUB',
					SK: 'PUSH_SUB#abc',
					id: 1,
					tenantId: TENANT_ID,
					endpoint: ENDPOINT,
					keysP256dh: 'p256dh-1',
					keysAuth: 'auth-1',
					userAgent: 'Chrome',
					subscriberRole: 'parent',
					createdAt: '2026-04-29T00:00:00.000Z',
				},
			],
		});

		const { findByTenant } = await loadRepo();
		const result = await findByTenant(TENANT_ID);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: 1,
			tenantId: TENANT_ID,
			endpoint: ENDPOINT,
			subscriberRole: 'parent',
		});
		// QueryCommand に PK 条件が含まれる
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, string>;
			};
		};
		expect(callArg.input.KeyConditionExpression).toContain('PK = :pk');
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe('T#tenant-1#PUSH_SUB');
	});

	it('LastEvaluatedKey でページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [
					{
						PK: 'T#tenant-1#PUSH_SUB',
						SK: 'PUSH_SUB#1',
						id: 1,
						tenantId: TENANT_ID,
						endpoint: 'e1',
						keysP256dh: 'p1',
						keysAuth: 'a1',
						userAgent: null,
						subscriberRole: 'parent',
						createdAt: '2026-04-29T00:00:00.000Z',
					},
				],
				LastEvaluatedKey: { PK: 'cursor', SK: 'cursor' },
			})
			.mockResolvedValueOnce({
				Items: [
					{
						PK: 'T#tenant-1#PUSH_SUB',
						SK: 'PUSH_SUB#2',
						id: 2,
						tenantId: TENANT_ID,
						endpoint: 'e2',
						keysP256dh: 'p2',
						keysAuth: 'a2',
						userAgent: null,
						subscriberRole: 'parent',
						createdAt: '2026-04-29T00:00:00.000Z',
					},
				],
				LastEvaluatedKey: undefined,
			});

		const { findByTenant } = await loadRepo();
		const result = await findByTenant(TENANT_ID);
		expect(result).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('レコード 0 件のときは空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findByTenant } = await loadRepo();
		const result = await findByTenant(TENANT_ID);
		expect(result).toEqual([]);
	});
});

// ============================================================
// findByEndpoint
// ============================================================

describe('findByEndpoint', () => {
	it('endpoint hash → GetItem で 1 件取得する', async () => {
		mockSend.mockResolvedValueOnce({
			Item: {
				PK: 'T#tenant-1#PUSH_SUB',
				SK: 'PUSH_SUB#aabbccdd11223344',
				id: 7,
				tenantId: TENANT_ID,
				endpoint: ENDPOINT,
				keysP256dh: 'p1',
				keysAuth: 'a1',
				userAgent: 'Safari',
				subscriberRole: 'owner',
				createdAt: '2026-04-29T00:00:00.000Z',
			},
		});

		const { findByEndpoint } = await loadRepo();
		const result = await findByEndpoint(ENDPOINT, TENANT_ID);
		expect(result).toBeDefined();
		expect(result?.endpoint).toBe(ENDPOINT);
		expect(result?.subscriberRole).toBe('owner');

		// GetCommand が使われたこと
		const callArg = mockSend.mock.calls[0]?.[0] as { input: { Key?: { PK: string; SK: string } } };
		expect(callArg.input.Key?.PK).toBe('T#tenant-1#PUSH_SUB');
		expect(callArg.input.Key?.SK).toMatch(/^PUSH_SUB#[0-9a-f]{16}$/);
	});

	it('Item 不在のときは undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({ Item: undefined });
		const { findByEndpoint } = await loadRepo();
		const result = await findByEndpoint(ENDPOINT, TENANT_ID);
		expect(result).toBeUndefined();
	});

	it('hash 衝突時は endpoint 不一致で undefined を返す（二重防御）', async () => {
		mockSend.mockResolvedValueOnce({
			Item: {
				PK: 'T#tenant-1#PUSH_SUB',
				SK: 'PUSH_SUB#aabbccdd11223344',
				id: 9,
				tenantId: TENANT_ID,
				// 衝突した別 endpoint
				endpoint: 'https://example.com/different-endpoint',
				keysP256dh: 'p1',
				keysAuth: 'a1',
				userAgent: null,
				subscriberRole: 'parent',
				createdAt: '2026-04-29T00:00:00.000Z',
			},
		});

		const { findByEndpoint } = await loadRepo();
		const result = await findByEndpoint(ENDPOINT, TENANT_ID);
		expect(result).toBeUndefined();
	});
});

// ============================================================
// insert
// ============================================================

describe('insert', () => {
	it('subscriberRole=parent を必須属性として PutItem する (#1593 ADR-0023 I6)', async () => {
		// counter.nextId 用の UpdateCommand → PutCommand の順
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 42 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand

		const { insert } = await loadRepo();
		const result = await insert({
			tenantId: TENANT_ID,
			endpoint: ENDPOINT,
			keysP256dh: 'p256dh-1',
			keysAuth: 'auth-1',
			userAgent: 'Chrome',
			subscriberRole: 'parent',
		});

		expect(result.id).toBe(42);
		expect(result.subscriberRole).toBe('parent');

		// PutCommand の Item に subscriberRole が含まれる
		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.subscriberRole).toBe('parent');
		expect(putCall.input.Item?.PK).toBe('T#tenant-1#PUSH_SUB');
		expect(putCall.input.Item?.SK).toMatch(/^PUSH_SUB#[0-9a-f]{16}$/);
		expect(putCall.input.Item?.endpoint).toBe(ENDPOINT);
		expect(putCall.input.Item?.id).toBe(42);
	});

	it('subscriberRole=owner も保存できる', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});

		const { insert } = await loadRepo();
		const result = await insert({
			tenantId: TENANT_ID,
			endpoint: ENDPOINT,
			keysP256dh: 'p',
			keysAuth: 'a',
			subscriberRole: 'owner',
		});

		expect(result.subscriberRole).toBe('owner');
		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.subscriberRole).toBe('owner');
	});

	it('userAgent 未指定時は null を保存する', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});

		const { insert } = await loadRepo();
		const result = await insert({
			tenantId: TENANT_ID,
			endpoint: ENDPOINT,
			keysP256dh: 'p',
			keysAuth: 'a',
			subscriberRole: 'parent',
		});

		expect(result.userAgent).toBeNull();
		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.userAgent).toBeNull();
	});
});

// ============================================================
// deleteByEndpoint
// ============================================================

describe('deleteByEndpoint', () => {
	it('endpoint hash → DeleteItem する', async () => {
		mockSend.mockResolvedValueOnce({});
		const { deleteByEndpoint } = await loadRepo();
		await deleteByEndpoint(ENDPOINT, TENANT_ID);

		const callArg = mockSend.mock.calls[0]?.[0] as { input: { Key?: { PK: string; SK: string } } };
		expect(callArg.input.Key?.PK).toBe('T#tenant-1#PUSH_SUB');
		expect(callArg.input.Key?.SK).toMatch(/^PUSH_SUB#[0-9a-f]{16}$/);
	});
});

// ============================================================
// insertLog
// ============================================================

describe('insertLog', () => {
	it('成功通知ログを保存する (success=1)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 100 } }).mockResolvedValueOnce({});

		const { insertLog } = await loadRepo();
		const result = await insertLog({
			tenantId: TENANT_ID,
			notificationType: 'task_reminder',
			title: 'Test Title',
			body: 'Test Body',
			success: true,
		});

		expect(result.id).toBe(100);
		expect(result.success).toBe(1);
		expect(result.errorMessage).toBeNull();

		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.PK).toBe('T#tenant-1#NOTIF_LOG');
		expect(putCall.input.Item?.SK).toMatch(/^NOTIF#[\dT:.\-Z]+#\d{8}$/);
		expect(putCall.input.Item?.success).toBe(1);
	});

	it('失敗通知ログを errorMessage 付きで保存する (success=0)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 200 } }).mockResolvedValueOnce({});

		const { insertLog } = await loadRepo();
		const result = await insertLog({
			tenantId: TENANT_ID,
			notificationType: 'task_reminder',
			title: 'T',
			body: 'B',
			success: false,
			errorMessage: 'Push service rejected',
		});

		expect(result.success).toBe(0);
		expect(result.errorMessage).toBe('Push service rejected');
		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.success).toBe(0);
		expect(putCall.input.Item?.errorMessage).toBe('Push service rejected');
	});
});

// ============================================================
// countTodayLogs
// ============================================================

describe('countTodayLogs', () => {
	it('当日の SK 範囲で COUNT クエリを発行する', async () => {
		mockSend.mockResolvedValueOnce({ Count: 5 });
		const { countTodayLogs } = await loadRepo();
		const result = await countTodayLogs(TENANT_ID, '2026-04-29');

		expect(result).toBe(5);
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, string>;
				Select?: string;
			};
		};
		expect(callArg.input.KeyConditionExpression).toContain('PK = :pk');
		expect(callArg.input.KeyConditionExpression).toContain('SK BETWEEN');
		expect(callArg.input.Select).toBe('COUNT');
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe('T#tenant-1#NOTIF_LOG');
		expect(callArg.input.ExpressionAttributeValues?.[':skStart']).toBe('NOTIF#2026-04-29T00:00:00');
		expect(callArg.input.ExpressionAttributeValues?.[':skEnd']).toBe('NOTIF#2026-04-29T99:99:99');
	});

	it('レコード 0 件のときは 0 を返す', async () => {
		mockSend.mockResolvedValueOnce({ Count: 0 });
		const { countTodayLogs } = await loadRepo();
		const result = await countTodayLogs(TENANT_ID, '2026-04-29');
		expect(result).toBe(0);
	});

	it('LastEvaluatedKey でページング合算する', async () => {
		mockSend
			.mockResolvedValueOnce({ Count: 100, LastEvaluatedKey: { PK: 'c', SK: 'c' } })
			.mockResolvedValueOnce({ Count: 50, LastEvaluatedKey: undefined });
		const { countTodayLogs } = await loadRepo();
		const result = await countTodayLogs(TENANT_ID, '2026-04-29');
		expect(result).toBe(150);
	});
});

// ============================================================
// findRecentLogs
// ============================================================

describe('findRecentLogs', () => {
	it('ScanIndexForward=false + Limit で降順取得する', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				{
					PK: 'T#tenant-1#NOTIF_LOG',
					SK: 'NOTIF#2026-04-29T10:00:00.000Z#00000002',
					id: 2,
					tenantId: TENANT_ID,
					notificationType: 'task',
					title: 'Latest',
					body: 'Body 2',
					sentAt: '2026-04-29T10:00:00.000Z',
					success: 1,
					errorMessage: null,
				},
				{
					PK: 'T#tenant-1#NOTIF_LOG',
					SK: 'NOTIF#2026-04-29T09:00:00.000Z#00000001',
					id: 1,
					tenantId: TENANT_ID,
					notificationType: 'task',
					title: 'Older',
					body: 'Body 1',
					sentAt: '2026-04-29T09:00:00.000Z',
					success: 1,
					errorMessage: null,
				},
			],
		});

		const { findRecentLogs } = await loadRepo();
		const result = await findRecentLogs(TENANT_ID, 10);

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('Latest');

		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: { ScanIndexForward?: boolean; Limit?: number };
		};
		expect(callArg.input.ScanIndexForward).toBe(false);
		expect(callArg.input.Limit).toBe(10);
	});
});

// ============================================================
// 機能等価性チェック (interface 適合)
// ============================================================

describe('interface 適合 (SQLite との機能等価性)', () => {
	it('IPushSubscriptionRepo の全メソッドを export している', async () => {
		const repo = await loadRepo();
		expect(typeof repo.findByTenant).toBe('function');
		expect(typeof repo.findByEndpoint).toBe('function');
		expect(typeof repo.insert).toBe('function');
		expect(typeof repo.deleteByEndpoint).toBe('function');
		expect(typeof repo.insertLog).toBe('function');
		expect(typeof repo.countTodayLogs).toBe('function');
		expect(typeof repo.findRecentLogs).toBe('function');
	});
});
