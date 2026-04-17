// tests/unit/db/repo-helpers.test.ts
// repo-helpers.ts のユニットテスト (#1041)

import { BatchWriteCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- mock: DynamoDB client ---
const mockSend = vi.fn();
vi.mock('../../../src/lib/server/db/dynamodb/client', () => ({
	getDocClient: () => ({ send: mockSend }),
	TABLE_NAME: 'test-table',
}));

// --- mock: keys (childKey) ---
vi.mock('../../../src/lib/server/db/dynamodb/keys', () => ({
	childKey: (id: number, tenantId: string) => ({
		PK: `T#${tenantId}#CHILD#${id}`,
		SK: 'PROFILE',
	}),
}));

import {
	batchDeleteItems,
	findChildByIdRaw,
	queryAllItems,
	stripKeys,
} from '../../../src/lib/server/db/dynamodb/repo-helpers';

beforeEach(() => {
	mockSend.mockReset();
});

// ============================================================
// stripKeys
// ============================================================

describe('stripKeys', () => {
	it('PK, SK, GSI2PK, GSI2SK を除去する', () => {
		const input = {
			PK: 'T#1',
			SK: 'CHILD#1',
			GSI2PK: 'g2',
			GSI2SK: 'g2s',
			id: 1,
			name: 'test',
		};
		const result = stripKeys(input);
		expect(result).toEqual({ id: 1, name: 'test' });
		expect(result).not.toHaveProperty('PK');
		expect(result).not.toHaveProperty('SK');
		expect(result).not.toHaveProperty('GSI2PK');
		expect(result).not.toHaveProperty('GSI2SK');
	});

	it('PK/SK のみ存在する場合でも正常に動作する', () => {
		const input = { PK: 'T#1', SK: 'PROFILE', nickname: 'たろう', age: 5 };
		const result = stripKeys(input);
		expect(result).toEqual({ nickname: 'たろう', age: 5 });
	});

	it('除去対象キーが無い場合はそのまま返す', () => {
		const input = { id: 42, name: 'hello' };
		const result = stripKeys(input);
		expect(result).toEqual({ id: 42, name: 'hello' });
	});

	it('空オブジェクトを渡すと空オブジェクトを返す', () => {
		const result = stripKeys({});
		expect(result).toEqual({});
	});
});

// ============================================================
// queryAllItems
// ============================================================

describe('queryAllItems', () => {
	it('単一ページの結果を返す（LastEvaluatedKey なし）', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				{ PK: 'T#t1#CHILD#1', SK: 'LOG#2026-01-01', id: 1 },
				{ PK: 'T#t1#CHILD#1', SK: 'LOG#2026-01-02', id: 2 },
			],
			LastEvaluatedKey: undefined,
		});

		const result = await queryAllItems('T#t1#CHILD#1', 'LOG#');

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ PK: 'T#t1#CHILD#1', SK: 'LOG#2026-01-01', id: 1 });
		expect(mockSend).toHaveBeenCalledTimes(1);

		const command = mockSend.mock.calls[0][0];
		expect(command).toBeInstanceOf(QueryCommand);
	});

	it('複数ページをページネーションで全件取得する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ PK: 'pk', SK: 'sk1', val: 'a' }],
				LastEvaluatedKey: { PK: 'pk', SK: 'sk1' },
			})
			.mockResolvedValueOnce({
				Items: [{ PK: 'pk', SK: 'sk2', val: 'b' }],
				LastEvaluatedKey: { PK: 'pk', SK: 'sk2' },
			})
			.mockResolvedValueOnce({
				Items: [{ PK: 'pk', SK: 'sk3', val: 'c' }],
				LastEvaluatedKey: undefined,
			});

		const result = await queryAllItems('pk', 'sk');

		expect(result).toHaveLength(3);
		expect(result.map((r) => r.val)).toEqual(['a', 'b', 'c']);
		expect(mockSend).toHaveBeenCalledTimes(3);
	});

	it('結果が空の場合は空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [],
			LastEvaluatedKey: undefined,
		});

		const result = await queryAllItems('pk', 'prefix');

		expect(result).toEqual([]);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('Items が undefined の場合も空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: undefined,
			LastEvaluatedKey: undefined,
		});

		const result = await queryAllItems('pk', 'prefix');

		expect(result).toEqual([]);
	});

	it('オプション（filterExpression 等）を QueryCommand に渡す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

		await queryAllItems('pk', 'prefix', {
			filterExpression: '#s = :status',
			expressionAttributeNames: { '#s': 'status' },
			expressionAttributeValues: { ':status': 'active' },
			projectionExpression: 'id, #s',
		});

		const command = mockSend.mock.calls[0][0] as QueryCommand;
		const input = command.input;
		expect(input.FilterExpression).toBe('#s = :status');
		expect(input.ExpressionAttributeNames).toEqual({ '#s': 'status' });
		expect(input.ExpressionAttributeValues).toEqual({
			':pk': 'pk',
			':prefix': 'prefix',
			':status': 'active',
		});
		expect(input.ProjectionExpression).toBe('id, #s');
	});
});

// ============================================================
// batchDeleteItems
// ============================================================

describe('batchDeleteItems', () => {
	it('キーの配列を BatchWriteCommand で削除し件数を返す', async () => {
		mockSend.mockResolvedValue({});

		const keys = [
			{ PK: 'pk1', SK: 'sk1' },
			{ PK: 'pk2', SK: 'sk2' },
		];
		const count = await batchDeleteItems(keys);

		expect(count).toBe(2);
		expect(mockSend).toHaveBeenCalledTimes(1);

		const command = mockSend.mock.calls[0][0];
		expect(command).toBeInstanceOf(BatchWriteCommand);
		const requestItems = command.input.RequestItems?.['test-table'];
		expect(requestItems).toHaveLength(2);
		expect(requestItems?.[0]).toEqual({ DeleteRequest: { Key: { PK: 'pk1', SK: 'sk1' } } });
	});

	it('25 件を超えるキーを複数バッチに分割して削除する', async () => {
		mockSend.mockResolvedValue({});

		const keys = Array.from({ length: 30 }, (_, i) => ({
			PK: `pk${i}`,
			SK: `sk${i}`,
		}));
		const count = await batchDeleteItems(keys);

		expect(count).toBe(30);
		// 25 + 5 = 2 batches
		expect(mockSend).toHaveBeenCalledTimes(2);

		const firstBatch = mockSend.mock.calls[0][0].input.RequestItems?.['test-table'];
		const secondBatch = mockSend.mock.calls[1][0].input.RequestItems?.['test-table'];
		expect(firstBatch).toHaveLength(25);
		expect(secondBatch).toHaveLength(5);
	});

	it('空配列の場合は 0 を返し send を呼ばない', async () => {
		const count = await batchDeleteItems([]);

		expect(count).toBe(0);
		expect(mockSend).not.toHaveBeenCalled();
	});

	it('ちょうど 25 件の場合は 1 バッチで処理する', async () => {
		mockSend.mockResolvedValue({});

		const keys = Array.from({ length: 25 }, (_, i) => ({
			PK: `pk${i}`,
			SK: `sk${i}`,
		}));
		const count = await batchDeleteItems(keys);

		expect(count).toBe(25);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

// ============================================================
// findChildByIdRaw
// ============================================================

describe('findChildByIdRaw', () => {
	it('子供プロフィールを取得して PK/SK を除去して返す', async () => {
		mockSend.mockResolvedValueOnce({
			Item: {
				PK: 'T#tenant1#CHILD#1',
				SK: 'PROFILE',
				id: 1,
				nickname: 'たろう',
				age: 5,
				theme: 'blue',
			},
		});

		const child = await findChildByIdRaw(1, 'tenant1');

		expect(child).toBeDefined();
		expect(child?.id).toBe(1);
		expect(child?.nickname).toBe('たろう');
		expect(child).not.toHaveProperty('PK');
		expect(child).not.toHaveProperty('SK');

		const command = mockSend.mock.calls[0][0];
		expect(command).toBeInstanceOf(GetCommand);
		expect(command.input.Key).toEqual({
			PK: 'T#tenant1#CHILD#1',
			SK: 'PROFILE',
		});
	});

	it('存在しない子供の場合は undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({ Item: undefined });

		const child = await findChildByIdRaw(999, 'tenant1');

		expect(child).toBeUndefined();
	});
});
