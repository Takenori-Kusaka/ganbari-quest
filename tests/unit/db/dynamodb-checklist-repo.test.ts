/**
 * tests/unit/db/dynamodb-checklist-repo.test.ts
 *
 * #2845 B1 横展開: checklist-repo の deleteTemplateItem / deleteOverride。
 *
 * 旧実装は両者とも tenant prefix を含まない全テーブル Scan
 * (`begins_with(SK, 'ITEM#'|'CKOVER#') + id`) + DeleteCommand で、
 * 全 tenant の item を削除できる形状 (cross-tenant IDOR / CWE-639) だった。
 * 本テストは partition Query (tenant 境界を KeyCondition で構造的に担保) + id filter +
 * 全ページ走査 (#2842 paging 正パターン) への置換を回帰固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend, MockQueryCommand, MockScanCommand, MockDeleteCommand } = vi.hoisted(() => {
	const send = vi.fn();
	class Cmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	return {
		mockSend: send,
		MockQueryCommand: class extends Cmd {},
		MockScanCommand: class extends Cmd {},
		MockDeleteCommand: class extends Cmd {},
	};
});

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => {
	class Cmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	return {
		DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
		GetCommand: Cmd,
		PutCommand: Cmd,
		QueryCommand: MockQueryCommand,
		UpdateCommand: Cmd,
		ScanCommand: MockScanCommand,
		DeleteCommand: MockDeleteCommand,
		BatchWriteCommand: Cmd,
	};
});

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/checklist-repo');
}

const TENANT = 'tenant-1';
const TEMPLATE_ID = 5;
const CHILD_ID = 42;

function queryInput(idx: number): Record<string, unknown> {
	return (mockSend.mock.calls[idx]?.[0] as { input: Record<string, unknown> }).input;
}

beforeEach(() => {
	mockSend.mockReset();
});
afterEach(() => {
	vi.clearAllMocks();
});

describe('deleteTemplateItem (#2845 B1: tenant 境界 + paging)', () => {
	it('template partition Query (literal PK) + id filter で解決し Scan を発行しない', async () => {
		const item = {
			PK: `T#${TENANT}#CKTPL#${TEMPLATE_ID}`,
			SK: 'ITEM#00000000#00000020',
			id: 20,
		};
		mockSend.mockResolvedValueOnce({ Items: [item] }).mockResolvedValueOnce({}); // Delete

		const { deleteTemplateItem } = await loadRepo();
		await deleteTemplateItem(TEMPLATE_ID, 20, TENANT);

		const query = mockSend.mock.calls[0]?.[0];
		expect(query).toBeInstanceOf(MockQueryCommand);
		expect(query).not.toBeInstanceOf(MockScanCommand);
		const input = queryInput(0);
		expect(input.KeyConditionExpression).toContain('PK = :pk');
		// literal PK assert: tenant + template 境界が KeyCondition で構造的に担保される
		expect((input.ExpressionAttributeValues as Record<string, unknown>)[':pk']).toBe(
			`T#${TENANT}#CKTPL#${TEMPLATE_ID}`,
		);
		expect((input.ExpressionAttributeValues as Record<string, unknown>)[':prefix']).toBe('ITEM#');
		expect((input.ExpressionAttributeValues as Record<string, unknown>)[':id']).toBe(20);

		const del = mockSend.mock.calls[1]?.[0];
		expect(del).toBeInstanceOf(MockDeleteCommand);
		expect((del as { input: { Key: Record<string, string> } }).input.Key.SK).toBe(
			'ITEM#00000000#00000020',
		);
	});

	it('対象 item が後続ページに居ても見つけて削除する (#2842 paging)', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p', SK: 's' } })
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CKTPL#${TEMPLATE_ID}`, SK: 'ITEM#00000001#00000020', id: 20 }],
			})
			.mockResolvedValueOnce({}); // Delete
		const { deleteTemplateItem } = await loadRepo();
		await deleteTemplateItem(TEMPLATE_ID, 20, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(3);
		expect(mockSend.mock.calls[2]?.[0]).toBeInstanceOf(MockDeleteCommand);
	});

	it('別 template (= 別 partition) の id は不在扱いで Delete しない (no-op)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { deleteTemplateItem } = await loadRepo();
		await deleteTemplateItem(TEMPLATE_ID, 999, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(1);
		expect(mockSend.mock.calls[0]?.[0]).toBeInstanceOf(MockQueryCommand);
	});
});

describe('deleteOverride (#2845 B1: tenant + child 境界 + paging)', () => {
	it('child partition Query (literal PK) + id filter で解決し Scan を発行しない', async () => {
		const item = {
			PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
			SK: 'CKOVER#2026-06-12#00000007',
			id: 7,
		};
		mockSend.mockResolvedValueOnce({ Items: [item] }).mockResolvedValueOnce({}); // Delete

		const { deleteOverride } = await loadRepo();
		await deleteOverride(CHILD_ID, 7, TENANT);

		const query = mockSend.mock.calls[0]?.[0];
		expect(query).toBeInstanceOf(MockQueryCommand);
		expect(query).not.toBeInstanceOf(MockScanCommand);
		const input = queryInput(0);
		// literal PK assert: tenant + child 境界が KeyCondition で構造的に担保される
		expect((input.ExpressionAttributeValues as Record<string, unknown>)[':pk']).toBe(
			`T#${TENANT}#CHILD#${CHILD_ID}`,
		);
		expect((input.ExpressionAttributeValues as Record<string, unknown>)[':prefix']).toBe('CKOVER#');
		expect((input.ExpressionAttributeValues as Record<string, unknown>)[':id']).toBe(7);

		const del = mockSend.mock.calls[1]?.[0];
		expect(del).toBeInstanceOf(MockDeleteCommand);
		expect((del as { input: { Key: Record<string, string> } }).input.Key.SK).toBe(
			'CKOVER#2026-06-12#00000007',
		);
	});

	it('対象 override が後続ページに居ても見つけて削除する (#2842 paging)', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p', SK: 's' } })
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'CKOVER#2026-06-11#00000007', id: 7 }],
			})
			.mockResolvedValueOnce({}); // Delete
		const { deleteOverride } = await loadRepo();
		await deleteOverride(CHILD_ID, 7, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(3);
		expect(mockSend.mock.calls[2]?.[0]).toBeInstanceOf(MockDeleteCommand);
	});

	it('別 child (= 別 partition) の id は不在扱いで Delete しない (no-op)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { deleteOverride } = await loadRepo();
		await deleteOverride(CHILD_ID, 999, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(1);
		expect(mockSend.mock.calls[0]?.[0]).toBeInstanceOf(MockQueryCommand);
	});
});

describe('findLogsByChild (#3078: child 単位バルク取得 + paging)', () => {
	it('child partition Query (literal PK) + CKLOG# prefix で全件返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				{
					PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
					SK: 'CKLOG#00000005#2026-03-15',
					id: 1,
					childId: CHILD_ID,
					templateId: 5,
					checkedDate: '2026-03-15',
					itemsJson: '{}',
					completedAll: 1,
					pointsAwarded: 7,
					createdAt: '2026-03-15T08:00:00Z',
				},
			],
		});
		const { findLogsByChild } = await loadRepo();
		const logs = await findLogsByChild(CHILD_ID, TENANT);

		const query = mockSend.mock.calls[0]?.[0];
		expect(query).toBeInstanceOf(MockQueryCommand);
		const input = queryInput(0);
		// literal PK assert: tenant + child 境界が KeyCondition で構造的に担保される
		expect((input.ExpressionAttributeValues as Record<string, unknown>)[':pk']).toBe(
			`T#${TENANT}#CHILD#${CHILD_ID}`,
		);
		expect((input.ExpressionAttributeValues as Record<string, unknown>)[':prefix']).toBe('CKLOG#');
		// stripKeys で PK/SK が除去された domain 形で返る
		expect(logs).toHaveLength(1);
		expect(logs[0]).not.toHaveProperty('PK');
		expect(logs[0]?.templateId).toBe(5);
		expect(logs[0]?.pointsAwarded).toBe(7);
	});

	it('後続ページのログも全件集約する (#2842 paging)', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [
					{
						PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
						SK: 'CKLOG#00000005#2026-03-14',
						id: 1,
						childId: CHILD_ID,
						templateId: 5,
						checkedDate: '2026-03-14',
						itemsJson: '{}',
						completedAll: 0,
						pointsAwarded: 1,
						createdAt: '2026-03-14T08:00:00Z',
					},
				],
				LastEvaluatedKey: { PK: 'p', SK: 's' },
			})
			.mockResolvedValueOnce({
				Items: [
					{
						PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
						SK: 'CKLOG#00000005#2026-03-15',
						id: 2,
						childId: CHILD_ID,
						templateId: 5,
						checkedDate: '2026-03-15',
						itemsJson: '{}',
						completedAll: 1,
						pointsAwarded: 7,
						createdAt: '2026-03-15T08:00:00Z',
					},
				],
			});
		const { findLogsByChild } = await loadRepo();
		const logs = await findLogsByChild(CHILD_ID, TENANT);
		expect(mockSend).toHaveBeenCalledTimes(2);
		expect(logs).toHaveLength(2);
	});

	it('ログ 0 件なら空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findLogsByChild } = await loadRepo();
		expect(await findLogsByChild(CHILD_ID, TENANT)).toEqual([]);
	});
});
