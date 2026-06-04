/**
 * tests/unit/db/dynamodb-viewer-token-repo.test.ts
 *
 * #2824 Wave 6B (#371) — viewer-token-repo DynamoDB 本実装の単体テスト。
 *
 * 旧 stub (#2263 hotfix: read = 空 / write = no-op) を DynamoDB 本実装に置換したため、
 * AWS SDK を hoisted mock で置き換え、SQLite 機能等価の 5 関数を網羅する。
 *
 * キー設計 (keys.ts viewerTokenKey): PK = VTOKEN#<token>, SK = META (global token 軸)
 *   - findByToken (hot path, no tenant) → GetItem 1 回
 *   - findByTenant / revoke(id) / deleteById(id) → tenantId 属性フィルタ Scan で raw key 解決
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockSend,
	MockGetCommand,
	MockPutCommand,
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
	ScanCommand: MockScanCommand,
	DeleteCommand: MockDeleteCommand,
	UpdateCommand: MockUpdateCommand,
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/viewer-token-repo');
}

const TENANT = 'tenant-1';

function callOf(idx: number): { input: Record<string, unknown> } {
	return mockSend.mock.calls[idx]?.[0] as { input: Record<string, unknown> };
}

function tokenRow(id: number, token: string): Record<string, unknown> {
	return {
		PK: `VTOKEN#${token}`,
		SK: 'META',
		id,
		tenantId: TENANT,
		token,
		label: null,
		expiresAt: null,
		createdAt: `2026-05-0${id}T00:00:00.000Z`,
		revokedAt: null,
	};
}

beforeEach(() => {
	mockSend.mockReset();
});
afterEach(() => {
	vi.clearAllMocks();
});

describe('findByToken', () => {
	it('GetItem で token 軸 PK を引く (hot path)', async () => {
		mockSend.mockResolvedValueOnce({ Item: tokenRow(1, 'abc') });
		const { findByToken } = await loadRepo();
		const r = await findByToken('abc');
		expect(r?.token).toBe('abc');
		expect((r as unknown as Record<string, unknown>).PK).toBeUndefined();
		const arg = callOf(0).input;
		expect((arg.Key as Record<string, string>).PK).toBe('VTOKEN#abc');
		expect((arg.Key as Record<string, string>).SK).toBe('META');
	});

	it('不在で undefined', async () => {
		mockSend.mockResolvedValueOnce({ Item: undefined });
		const { findByToken } = await loadRepo();
		expect(await findByToken('none')).toBeUndefined();
	});
});

describe('findByTenant', () => {
	it('Scan + tenantId 属性フィルタで createdAt desc 返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [tokenRow(1, 'a'), tokenRow(2, 'b')],
		});
		const { findByTenant } = await loadRepo();
		const result = await findByTenant(TENANT);
		expect(result).toHaveLength(2);
		// createdAt desc → id=2 が先頭
		expect(result[0]?.id).toBe(2);
		const arg = callOf(0).input;
		expect(arg.FilterExpression).toContain('tenantId = :tid');
		expect((arg.ExpressionAttributeValues as Record<string, string>)[':prefix']).toBe('VTOKEN#');
	});

	it('ページングする', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [tokenRow(1, 'a')], LastEvaluatedKey: { PK: 'c', SK: 'c' } })
			.mockResolvedValueOnce({ Items: [tokenRow(2, 'b')], LastEvaluatedKey: undefined });
		const { findByTenant } = await loadRepo();
		const result = await findByTenant(TENANT);
		expect(result).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('0 件で空配列', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findByTenant } = await loadRepo();
		expect(await findByTenant(TENANT)).toEqual([]);
	});
});

describe('insert', () => {
	it('counter 採番 → PutItem (token 軸 key)。revokedAt=null', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 9 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand
		const { insert } = await loadRepo();
		const r = await insert({ token: 'tok', label: 'おばあちゃん用' }, TENANT);
		expect(r.id).toBe(9);
		expect(r.token).toBe('tok');
		expect(r.label).toBe('おばあちゃん用');
		expect(r.revokedAt).toBeNull();
		const putArg = callOf(1).input;
		const item = putArg.Item as Record<string, unknown>;
		expect(item.PK).toBe('VTOKEN#tok');
		expect(item.SK).toBe('META');
	});

	it('label 未指定で null', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insert } = await loadRepo();
		const r = await insert({ token: 't2' }, TENANT);
		expect(r.label).toBeNull();
		expect(r.expiresAt).toBeNull();
	});
});

describe('revoke', () => {
	it('Scan で id の raw key を解決し SET revokedAt', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [tokenRow(3, 'x')] }) // scanByTenant
			.mockResolvedValueOnce({}); // UpdateCommand
		const { revoke } = await loadRepo();
		await revoke(3, TENANT);
		const upArg = callOf(1).input;
		expect(upArg.UpdateExpression).toContain('SET revokedAt = :now');
		expect((upArg.Key as Record<string, string>).PK).toBe('VTOKEN#x');
	});

	it('id 不在なら Update を呼ばない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [tokenRow(3, 'x')] });
		const { revoke } = await loadRepo();
		await revoke(999, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

describe('deleteById', () => {
	it('Scan で id の raw key を解決し DeleteItem', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [tokenRow(4, 'y')] }) // scanByTenant
			.mockResolvedValueOnce({}); // DeleteCommand
		const { deleteById } = await loadRepo();
		await deleteById(4, TENANT);
		const delArg = callOf(1).input;
		expect((delArg.Key as Record<string, string>).PK).toBe('VTOKEN#y');
	});

	it('id 不在なら Delete を呼ばない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [tokenRow(4, 'y')] });
		const { deleteById } = await loadRepo();
		await deleteById(999, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});
