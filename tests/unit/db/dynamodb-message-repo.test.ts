/**
 * tests/unit/db/dynamodb-message-repo.test.ts
 *
 * #2266 / #2824 Wave 3A / ADR-0055: DynamoDB おうえんメッセージ (親→子) repo 本実装の単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/message-repo.ts、挙動 SSOT) と
 * 機能等価であることを method ごとに検証する:
 *   - 正しい Command + key で send する
 *   - response を正しく型変換する (stripKeys / icon default backfill)
 *   - SQLite 機能等価 (sent_at DESC 並び / shown_at IS NULL filter / count / markShown id 解決)
 *
 * 背景: 本 repo は #2263 hotfix で read=空 / write=no-op 化され、おうえんメッセージ送信が本番
 *   DynamoDB Lambda で永続しなかった。LP (feature-cheer-message) が訴求する機能のため ADR-0013
 *   LP truth 違反級。本テストは本実装の機能等価性を回帰固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AWS SDK Mock (vi.hoisted で先にモック関数と Command クラスを確保)
const { mockSend, MockPutCommand, MockQueryCommand, MockUpdateCommand, MockScanCommand } =
	vi.hoisted(() => {
		const send = vi.fn();
		class Cmd {
			input: unknown;
			constructor(input: unknown) {
				this.input = input;
			}
		}
		return {
			mockSend: send,
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
	return import('../../../src/lib/server/db/dynamodb/message-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;

/** child partition の DynamoDB message item を組み立てる (PK/SK + 属性)。 */
function makeItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const id = (over.id as number) ?? 1;
	return {
		PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
		SK: `MSG#${String(id).padStart(8, '0')}`,
		id,
		childId: CHILD_ID,
		messageType: 'text',
		stampCode: null,
		body: 'がんばったね',
		icon: '💌',
		sentAt: '2026-06-04T00:00:00.000Z',
		shownAt: null,
		bonusPoints: null,
		rewardCategory: null,
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
// insertMessage
// ============================================================

describe('insertMessage', () => {
	it('counter 採番 → PutItem し SQLite default 値を埋めた row を返す (永続の核心経路)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 101 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand

		const { insertMessage } = await loadRepo();
		const result = await insertMessage(
			{ childId: CHILD_ID, messageType: 'text', body: 'やったね' },
			TENANT,
		);

		expect(result.id).toBe(101);
		expect(result).toMatchObject({
			childId: CHILD_ID,
			messageType: 'text',
			body: 'やったね',
			// SQLite schema default 'icon' = '💌'
			icon: '💌',
			stampCode: null,
			shownAt: null,
			bonusPoints: null,
			rewardCategory: null,
		});
		expect(typeof result.sentAt).toBe('string');

		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(putCall.input.Item?.SK).toBe('MSG#00000101');
		expect(putCall.input.Item?.body).toBe('やったね');
		expect(putCall.input.Item?.icon).toBe('💌');
	});

	it('stamp / bonusPoints / rewardCategory / icon 指定を反映する (#2267 cheer)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 5 } }).mockResolvedValueOnce({});
		const { insertMessage } = await loadRepo();
		const result = await insertMessage(
			{
				childId: CHILD_ID,
				messageType: 'reward_notice',
				stampCode: 'star',
				icon: '⭐',
				bonusPoints: 10,
				rewardCategory: 'undou',
			},
			TENANT,
		);
		expect(result).toMatchObject({
			messageType: 'reward_notice',
			stampCode: 'star',
			icon: '⭐',
			bonusPoints: 10,
			rewardCategory: 'undou',
		});
	});
});

// ============================================================
// findMessages
// ============================================================

describe('findMessages', () => {
	it('child partition を Query し sentAt 降順で返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, body: 'old', sentAt: '2026-06-01T00:00:00.000Z' }),
				makeItem({ id: 2, body: 'new', sentAt: '2026-06-03T00:00:00.000Z' }),
			],
		});
		const { findMessages } = await loadRepo();
		const result = await findMessages(CHILD_ID, 10, TENANT);
		expect(result.map((m) => m.body)).toEqual(['new', 'old']);

		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, string>;
			};
		};
		expect(callArg.input.KeyConditionExpression).toContain('PK = :pk');
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(callArg.input.ExpressionAttributeValues?.[':prefix']).toBe('MSG#');
	});

	it('同 sentAt は id 降順を tiebreaker にする (新しい id が先頭)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, body: 'first' }),
				makeItem({ id: 3, body: 'third' }),
				makeItem({ id: 2, body: 'second' }),
			],
		});
		const { findMessages } = await loadRepo();
		const result = await findMessages(CHILD_ID, 10, TENANT);
		expect(result.map((m) => m.body)).toEqual(['third', 'second', 'first']);
	});

	it('limit で件数を絞る', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, sentAt: '2026-06-01T00:00:00.000Z' }),
				makeItem({ id: 2, sentAt: '2026-06-02T00:00:00.000Z' }),
				makeItem({ id: 3, sentAt: '2026-06-03T00:00:00.000Z' }),
			],
		});
		const { findMessages } = await loadRepo();
		const result = await findMessages(CHILD_ID, 2, TENANT);
		expect(result.map((m) => m.id)).toEqual([3, 2]);
	});

	it('LastEvaluatedKey でページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeItem({ id: 1, sentAt: '2026-06-01T00:00:00.000Z' })],
				LastEvaluatedKey: { PK: 'c', SK: 'c' },
			})
			.mockResolvedValueOnce({ Items: [makeItem({ id: 2, sentAt: '2026-06-02T00:00:00.000Z' })] });
		const { findMessages } = await loadRepo();
		const result = await findMessages(CHILD_ID, 10, TENANT);
		expect(result).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('0 件のときは空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findMessages } = await loadRepo();
		expect(await findMessages(CHILD_ID, 10, TENANT)).toEqual([]);
	});

	it('icon 欠落 item は 💌 に backfill する', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeItem({ id: 1, icon: undefined })] });
		const { findMessages } = await loadRepo();
		const result = await findMessages(CHILD_ID, 10, TENANT);
		expect(result[0]?.icon).toBe('💌');
	});
});

// ============================================================
// findUnshownMessage
// ============================================================

describe('findUnshownMessage', () => {
	it('shownAt が null の最新 1 件を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({
					id: 1,
					body: 'shown',
					shownAt: '2026-06-02T00:00:00.000Z',
					sentAt: '2026-06-04T00:00:00.000Z',
				}),
				makeItem({ id: 2, body: 'unshownOld', shownAt: null, sentAt: '2026-06-01T00:00:00.000Z' }),
				makeItem({ id: 3, body: 'unshownNew', shownAt: null, sentAt: '2026-06-03T00:00:00.000Z' }),
			],
		});
		const { findUnshownMessage } = await loadRepo();
		const result = await findUnshownMessage(CHILD_ID, TENANT);
		expect(result?.body).toBe('unshownNew');
	});

	it('未表示が無いとき undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, shownAt: '2026-06-02T00:00:00.000Z' })],
		});
		const { findUnshownMessage } = await loadRepo();
		expect(await findUnshownMessage(CHILD_ID, TENANT)).toBeUndefined();
	});

	it('0 件のとき undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findUnshownMessage } = await loadRepo();
		expect(await findUnshownMessage(CHILD_ID, TENANT)).toBeUndefined();
	});
});

// ============================================================
// countUnshownMessages
// ============================================================

describe('countUnshownMessages', () => {
	it('shownAt が null の件数を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, shownAt: null }),
				makeItem({ id: 2, shownAt: '2026-06-02T00:00:00.000Z' }),
				makeItem({ id: 3, shownAt: null }),
			],
		});
		const { countUnshownMessages } = await loadRepo();
		expect(await countUnshownMessages(CHILD_ID, TENANT)).toBe(2);
	});

	it('0 件のとき 0 を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { countUnshownMessages } = await loadRepo();
		expect(await countUnshownMessages(CHILD_ID, TENANT)).toBe(0);
	});
});

// ============================================================
// markMessageShown
// ============================================================

describe('markMessageShown (#2845 課題①: full composite-key addressing)', () => {
	it('childId + messageId で PK/SK を直接構成し UpdateItem 1 回で完結する (Scan 不使用)', async () => {
		mockSend.mockResolvedValueOnce({
			Attributes: makeItem({ id: 7, shownAt: '2026-06-04T01:00:00.000Z' }),
		});

		const { markMessageShown } = await loadRepo();
		const result = await markMessageShown(CHILD_ID, 7, TENANT);
		expect(result?.shownAt).toBe('2026-06-04T01:00:00.000Z');

		// UpdateItem 1 回のみ (旧 tenant Scan 逆引きは撤去済)
		expect(mockSend).toHaveBeenCalledTimes(1);
		const updCall = mockSend.mock.calls[0]?.[0] as {
			input: {
				Key?: Record<string, string>;
				UpdateExpression?: string;
				ConditionExpression?: string;
				ReturnValues?: string;
			};
		};
		// tenant + child 境界が composite key で構造的に担保される
		expect(updCall.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(updCall.input.Key?.SK).toBe('MSG#00000007');
		expect(updCall.input.UpdateExpression).toContain('shownAt = :now');
		// attribute_exists で phantom item 生成 (不在 id への upsert) を防ぐ
		expect(updCall.input.ConditionExpression).toBe('attribute_exists(PK)');
		expect(updCall.input.ReturnValues).toBe('ALL_NEW');
	});

	it('(childId, messageId) 不一致 / 不在は ConditionalCheckFailedException → undefined', async () => {
		mockSend.mockRejectedValueOnce(
			Object.assign(new Error('conditional check failed'), {
				name: 'ConditionalCheckFailedException',
			}),
		);
		const { markMessageShown } = await loadRepo();
		expect(await markMessageShown(CHILD_ID, 99, TENANT)).toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('ConditionalCheckFailedException 以外のエラーは握りつぶさず throw する (ADR-0006)', async () => {
		mockSend.mockRejectedValueOnce(
			Object.assign(new Error('throughput exceeded'), {
				name: 'ProvisionedThroughputExceededException',
			}),
		);
		const { markMessageShown } = await loadRepo();
		await expect(markMessageShown(CHILD_ID, 7, TENANT)).rejects.toThrow('throughput exceeded');
	});
});

// ============================================================
// deleteByTenantId
// ============================================================

describe('deleteByTenantId', () => {
	it('tenant 配下の MSG# item を Scan して BatchWrite 削除する', async () => {
		// bulk-delete: Scan (keys) → (空なら BatchWrite 0 回)
		mockSend.mockResolvedValueOnce({
			Items: [
				{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'MSG#00000001' },
				{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'MSG#00000002' },
			],
		});
		mockSend.mockResolvedValueOnce({}); // BatchWrite

		const { deleteByTenantId } = await loadRepo();
		await deleteByTenantId(TENANT);

		const scanCall = mockSend.mock.calls[0]?.[0] as {
			input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(scanCall.input.FilterExpression).toContain('begins_with(PK, :pkPrefix)');
		expect(scanCall.input.ExpressionAttributeValues?.[':pkPrefix']).toBe(`T#${TENANT}#CHILD#`);
		expect(scanCall.input.ExpressionAttributeValues?.[':skPrefix']).toBe('MSG#');
	});

	it('0 件のとき BatchWrite を呼ばない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { deleteByTenantId } = await loadRepo();
		await deleteByTenantId(TENANT);
		expect(mockSend).toHaveBeenCalledTimes(1); // Scan のみ
	});
});

// ============================================================
// interface 適合 (SQLite との機能等価性)
// ============================================================

describe('interface 適合 (IMessageRepo)', () => {
	it('全メソッドを export している (stub に後退していない)', async () => {
		const repo = await loadRepo();
		for (const m of [
			'insertMessage',
			'findMessages',
			'findUnshownMessage',
			'countUnshownMessages',
			'markMessageShown',
			'deleteByTenantId',
		]) {
			expect(typeof (repo as Record<string, unknown>)[m]).toBe('function');
		}
	});

	it('write method が no-op stub でない (insertMessage が実 send し row を返す)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insertMessage } = await loadRepo();
		const result = await insertMessage({ childId: CHILD_ID, messageType: 'stamp' }, TENANT);
		// stub なら id=0 / send 未呼出だった。本実装は採番 id を返し send する。
		expect(result.id).toBe(1);
		expect(mockSend).toHaveBeenCalled();
	});
});
