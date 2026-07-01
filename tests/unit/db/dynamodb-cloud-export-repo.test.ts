/**
 * tests/unit/db/dynamodb-cloud-export-repo.test.ts
 *
 * #2824 Wave 6B (ADR-0055) — cloud-export-repo DynamoDB 本実装の単体テスト。
 *
 * 旧 stub (#2263 hotfix: read = 空 / write = no-op) を DynamoDB 本実装に置換したため、
 * AWS SDK を hoisted mock で置き換え、SQLite 機能等価の 8 関数を網羅する。
 *
 * キー設計 (keys.ts cloudExportKey): PK = T#<tenant>#CEXPORT, SK = EXPORT#<id>
 *   - tenant list / count / id lookup → Query / GetItem
 *   - findByPin (no tenant) / deleteExpired → Scan + 属性フィルタ
 *   - incrementDownloadCount(id, tenantId) → exact Key UpdateItem (#2845 B1: 旧 tenant 無束縛
 *     Scan 逆引きを撤去。呼び出し元 fetchCloudExportByPin が record.tenantId を持つ)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockSend,
	MockGetCommand,
	MockPutCommand,
	MockQueryCommand,
	MockScanCommand,
	MockDeleteCommand,
	MockUpdateCommand,
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
		MockScanCommand: class extends Cmd {},
		MockDeleteCommand: class extends Cmd {},
		MockUpdateCommand: class extends Cmd {},
	};
});

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
	GetCommand: MockGetCommand,
	PutCommand: MockPutCommand,
	QueryCommand: MockQueryCommand,
	ScanCommand: MockScanCommand,
	DeleteCommand: MockDeleteCommand,
	UpdateCommand: MockUpdateCommand,
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/cloud-export-repo');
}

const TENANT = 'tenant-1';

function callOf(idx: number): { input: Record<string, unknown> } {
	return mockSend.mock.calls[idx]?.[0] as { input: Record<string, unknown> };
}

beforeEach(() => {
	mockSend.mockReset();
});
afterEach(() => {
	vi.clearAllMocks();
});

describe('findByTenant', () => {
	it('Query で tenant の全レコードを createdAt desc で返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				{
					PK: `T#${TENANT}#CEXPORT`,
					SK: 'EXPORT#00000001',
					id: 1,
					tenantId: TENANT,
					exportType: 'full',
					pinCode: '1111',
					s3Key: 'k1',
					fileSizeBytes: 100,
					label: null,
					description: null,
					expiresAt: '2026-06-01',
					downloadCount: 0,
					maxDownloads: 10,
					createdAt: '2026-05-01T00:00:00.000Z',
				},
				{
					PK: `T#${TENANT}#CEXPORT`,
					SK: 'EXPORT#00000002',
					id: 2,
					tenantId: TENANT,
					exportType: 'template',
					pinCode: '2222',
					s3Key: 'k2',
					fileSizeBytes: 200,
					label: 'l',
					description: null,
					expiresAt: '2026-06-02',
					downloadCount: 1,
					maxDownloads: 5,
					createdAt: '2026-05-03T00:00:00.000Z',
				},
			],
		});

		const { findByTenant } = await loadRepo();
		const result = await findByTenant(TENANT);

		expect(result).toHaveLength(2);
		// createdAt desc → id=2 が先頭
		expect(result[0]?.id).toBe(2);
		expect(result[1]?.id).toBe(1);
		// PK/SK が stripKeys で除去されている
		expect((result[0] as unknown as Record<string, unknown>).PK).toBeUndefined();
		const arg = callOf(0).input;
		expect(arg.KeyConditionExpression).toContain('PK = :pk');
		expect((arg.ExpressionAttributeValues as Record<string, string>)[':pk']).toBe(
			`T#${TENANT}#CEXPORT`,
		);
	});

	it('LastEvaluatedKey でページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ id: 1, tenantId: TENANT, createdAt: '2026-05-01T00:00:00.000Z' }],
				LastEvaluatedKey: { PK: 'c', SK: 'c' },
			})
			.mockResolvedValueOnce({
				Items: [{ id: 2, tenantId: TENANT, createdAt: '2026-05-02T00:00:00.000Z' }],
				LastEvaluatedKey: undefined,
			});
		const { findByTenant } = await loadRepo();
		const result = await findByTenant(TENANT);
		expect(result).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('0 件のとき空配列', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findByTenant } = await loadRepo();
		expect(await findByTenant(TENANT)).toEqual([]);
	});
});

describe('findByPin', () => {
	it('Scan + 属性フィルタで pinCode 一致を 1 件返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [{ id: 7, tenantId: TENANT, pinCode: '9999', createdAt: '2026-05-01T00:00:00.000Z' }],
		});
		const { findByPin } = await loadRepo();
		const r = await findByPin('9999');
		expect(r?.id).toBe(7);
		const arg = callOf(0).input;
		expect(arg.FilterExpression).toContain('pinCode = :pin');
		expect((arg.ExpressionAttributeValues as Record<string, string>)[':pin']).toBe('9999');
	});

	it('該当なしで undefined (ページング末尾まで)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
		const { findByPin } = await loadRepo();
		expect(await findByPin('0000')).toBeUndefined();
	});
});

describe('findById', () => {
	it('GetItem で id+tenant を引く', async () => {
		mockSend.mockResolvedValueOnce({
			Item: { id: 3, tenantId: TENANT, createdAt: '2026-05-01T00:00:00.000Z' },
		});
		const { findById } = await loadRepo();
		const r = await findById(3, TENANT);
		expect(r?.id).toBe(3);
		const arg = callOf(0).input;
		expect((arg.Key as Record<string, string>).PK).toBe(`T#${TENANT}#CEXPORT`);
		expect((arg.Key as Record<string, string>).SK).toBe('EXPORT#00000003');
	});

	it('不在で undefined', async () => {
		mockSend.mockResolvedValueOnce({ Item: undefined });
		const { findById } = await loadRepo();
		expect(await findById(99, TENANT)).toBeUndefined();
	});
});

describe('insert', () => {
	it('counter 採番 → PutItem。downloadCount=0 / maxDownloads 既定 10', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 42 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand
		const { insert } = await loadRepo();
		const r = await insert({
			tenantId: TENANT,
			exportType: 'full',
			pinCode: '1234',
			s3Key: 's3://k',
			fileSizeBytes: 500,
			expiresAt: '2026-06-01',
		});
		expect(r.id).toBe(42);
		expect(r.downloadCount).toBe(0);
		expect(r.maxDownloads).toBe(10);
		expect(r.label).toBeNull();
		// PutCommand の Item に key + record
		const putArg = callOf(1).input;
		const item = putArg.Item as Record<string, unknown>;
		expect(item.PK).toBe(`T#${TENANT}#CEXPORT`);
		expect(item.SK).toBe('EXPORT#00000042');
		expect(item.s3Key).toBe('s3://k');
	});

	it('maxDownloads 明示時はそれを使う', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insert } = await loadRepo();
		const r = await insert({
			tenantId: TENANT,
			exportType: 'template',
			pinCode: 'p',
			s3Key: 'k',
			fileSizeBytes: 1,
			expiresAt: '2026-06-01',
			maxDownloads: 3,
		});
		expect(r.maxDownloads).toBe(3);
	});
});

describe('incrementDownloadCount (#2845 B1: tenant 束縛 exact Key)', () => {
	it('exact Key (T#<tenant>#CEXPORT / EXPORT#<id>) で直接 UpdateItem する (Scan 不発行)', async () => {
		mockSend.mockResolvedValueOnce({}); // UpdateCommand
		const { incrementDownloadCount } = await loadRepo();
		await incrementDownloadCount(5, TENANT);

		expect(mockSend).toHaveBeenCalledTimes(1);
		const cmd = mockSend.mock.calls[0]?.[0];
		expect(cmd).toBeInstanceOf(MockUpdateCommand);
		expect(cmd).not.toBeInstanceOf(MockScanCommand);
		const upArg = callOf(0).input;
		// literal PK assert: tenant 境界が Key で構造的に担保される (cross-tenant write 遮断)
		expect((upArg.Key as Record<string, string>).PK).toBe(`T#${TENANT}#CEXPORT`);
		expect((upArg.Key as Record<string, string>).SK).toBe('EXPORT#00000005');
		expect(upArg.UpdateExpression).toContain('ADD downloadCount :one');
		// attribute_exists で phantom item 生成を防ぐ
		expect(upArg.ConditionExpression).toBe('attribute_exists(PK)');
	});

	it('不在 (別 tenant の id を含む) は ConditionalCheckFailed → silent no-op', async () => {
		const err = Object.assign(new Error('conditional check failed'), {
			name: 'ConditionalCheckFailedException',
		});
		mockSend.mockRejectedValueOnce(err);
		const { incrementDownloadCount } = await loadRepo();
		await expect(incrementDownloadCount(999, 'other-tenant')).resolves.toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('ConditionalCheckFailed 以外のエラーは握りつぶさず throw する', async () => {
		mockSend.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'InternalError' }));
		const { incrementDownloadCount } = await loadRepo();
		await expect(incrementDownloadCount(5, TENANT)).rejects.toThrow('boom');
	});
});

describe('deleteById', () => {
	it('DeleteItem で id+tenant の key を削除', async () => {
		mockSend.mockResolvedValueOnce({});
		const { deleteById } = await loadRepo();
		await deleteById(8, TENANT);
		const arg = callOf(0).input;
		expect((arg.Key as Record<string, string>).SK).toBe('EXPORT#00000008');
	});
});

describe('deleteExpired', () => {
	it('Scan で expiresAt < now を集めて削除し件数を返す', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [
					{ PK: `T#${TENANT}#CEXPORT`, SK: 'EXPORT#00000001' },
					{ PK: `T#${TENANT}#CEXPORT`, SK: 'EXPORT#00000002' },
				],
			})
			.mockResolvedValueOnce({}) // delete 1
			.mockResolvedValueOnce({}); // delete 2
		const { deleteExpired } = await loadRepo();
		const n = await deleteExpired('2026-05-10');
		expect(n).toBe(2);
		const scanArg = callOf(0).input;
		expect(scanArg.FilterExpression).toContain('expiresAt < :now');
	});

	it('該当なしで 0', async () => {
		mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
		const { deleteExpired } = await loadRepo();
		expect(await deleteExpired('2026-05-10')).toBe(0);
	});
});

describe('countByTenant', () => {
	it('Select=COUNT で件数を集計 (ページング合算)', async () => {
		mockSend
			.mockResolvedValueOnce({ Count: 3, LastEvaluatedKey: { PK: 'c', SK: 'c' } })
			.mockResolvedValueOnce({ Count: 2, LastEvaluatedKey: undefined });
		const { countByTenant } = await loadRepo();
		expect(await countByTenant(TENANT)).toBe(5);
		expect(callOf(0).input.Select).toBe('COUNT');
	});
});

describe('insert は status を含める (#3504)', () => {
	it('status 省略時は pending / failureReason=null', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insert } = await loadRepo();
		const r = await insert({
			tenantId: TENANT,
			exportType: 'full',
			pinCode: 'p',
			s3Key: 'k',
			fileSizeBytes: 0,
			expiresAt: '2026-06-01',
		});
		expect(r.status).toBe('pending');
		expect(r.failureReason).toBeNull();
		const item = (callOf(1).input.Item as Record<string, unknown>) ?? {};
		expect(item.status).toBe('pending');
	});
});

describe('updateStatus (#3504)', () => {
	it('exact Key + #status 別名で status を SET する', async () => {
		mockSend.mockResolvedValueOnce({});
		const { updateStatus } = await loadRepo();
		await updateStatus(5, TENANT, 'building');
		const arg = callOf(0).input;
		expect(arg.UpdateExpression).toContain('#status = :status');
		expect((arg.ExpressionAttributeNames as Record<string, string>)['#status']).toBe('status');
		expect((arg.ExpressionAttributeValues as Record<string, string>)[':status']).toBe('building');
		expect((arg.Key as Record<string, string>).SK).toBe('EXPORT#00000005');
		expect(arg.ConditionExpression).toBe('attribute_exists(PK)');
	});

	it('ready 遷移では fileSizeBytes / description も同 UpdateItem で確定する', async () => {
		mockSend.mockResolvedValueOnce({});
		const { updateStatus } = await loadRepo();
		await updateStatus(5, TENANT, 'ready', { fileSizeBytes: 123, description: 'フルバックアップ' });
		const arg = callOf(0).input;
		expect(arg.UpdateExpression).toContain('#fs = :fs');
		expect(arg.UpdateExpression).toContain('#desc = :desc');
		expect((arg.ExpressionAttributeValues as Record<string, unknown>)[':fs']).toBe(123);
		expect((arg.ExpressionAttributeValues as Record<string, unknown>)[':desc']).toBe(
			'フルバックアップ',
		);
	});

	it('不在 (別 tenant) は ConditionalCheckFailed → silent no-op', async () => {
		mockSend.mockRejectedValueOnce(
			Object.assign(new Error('cc'), { name: 'ConditionalCheckFailedException' }),
		);
		const { updateStatus } = await loadRepo();
		await expect(updateStatus(9, 'other', 'ready')).resolves.toBeUndefined();
	});
});

describe('findPendingBuilds (#3504)', () => {
	it('Scan + #status=pending で最大 limit 件返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				{ id: 1, tenantId: TENANT, status: 'pending', createdAt: '2026-05-01T00:00:00.000Z' },
				{ id: 2, tenantId: TENANT, status: 'pending', createdAt: '2026-05-02T00:00:00.000Z' },
			],
		});
		const { findPendingBuilds } = await loadRepo();
		const result = await findPendingBuilds(5);
		expect(result).toHaveLength(2);
		const arg = callOf(0).input;
		expect(arg.FilterExpression).toContain('#status = :pending');
		expect((arg.ExpressionAttributeValues as Record<string, string>)[':pending']).toBe('pending');
	});

	it('limit で打ち切る (ページング途中でも)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				{ id: 1, tenantId: TENANT, status: 'pending', createdAt: 'a' },
				{ id: 2, tenantId: TENANT, status: 'pending', createdAt: 'b' },
				{ id: 3, tenantId: TENANT, status: 'pending', createdAt: 'c' },
			],
			LastEvaluatedKey: { PK: 'x', SK: 'y' },
		});
		const { findPendingBuilds } = await loadRepo();
		const result = await findPendingBuilds(2);
		expect(result).toHaveLength(2);
		// limit 到達で 2 ページ目 Scan を発行しない
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});
