/**
 * tests/unit/db/dynamodb-activity-pref-repo.test.ts
 *
 * #3394/#3465 (same-class #3385/#3391): DynamoDB activity-pref repo の restore 冪等 guard 単体テスト。
 *
 * 旧実装は insertForRestore が無条件 PutCommand で同 (childId, activityId) の既存 item を
 * silent overwrite し、import カウントを水増ししていた (SQLite idx_child_activity_prefs_unique
 * throw→skip+error と非対称)。統一契約 (#3394):
 *   - Put は attribute_not_exists(PK) 条件付き
 *   - 重複 (ConditionalCheckFailedException) は null を返す (import 側 skip 計上)
 *   - throttle 等その他の失敗は throw する (#3401 例外分類)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asActivityId, asChildId } from '$lib/domain/ids';

// AWS SDK Mock (vi.hoisted で先にモック関数と Command クラスを確保)
const { mockSend, MockGetCommand, MockPutCommand, MockQueryCommand } = vi.hoisted(() => {
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
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/activity-pref-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = asChildId(42);
const ACTIVITY_ID = asActivityId(7);

const restoreInput = {
	childId: CHILD_ID,
	activityId: ACTIVITY_ID,
	isPinned: 1,
	pinOrder: 2,
	createdAt: '2026-02-05T00:00:00Z',
	updatedAt: '2026-02-06T00:00:00Z',
};

beforeEach(() => {
	mockSend.mockReset();
});

describe('#3394/#3465 insertForRestore 冪等 guard', () => {
	it('Put に ConditionExpression attribute_not_exists(PK) が付く (silent overwrite 禁止)', async () => {
		mockSend.mockResolvedValueOnce({});
		const { insertForRestore } = await loadRepo();
		const pref = await insertForRestore(restoreInput, TENANT);
		expect(pref?.isPinned).toBe(1);
		expect(pref?.pinOrder).toBe(2);
		// createdAt/updatedAt verbatim 保全 (#3465 item 3)
		expect(pref?.createdAt).toBe('2026-02-05T00:00:00Z');
		expect(pref?.updatedAt).toBe('2026-02-06T00:00:00Z');
		const put = mockSend.mock.calls[0]?.[0] as {
			input: { ConditionExpression?: string; Item?: Record<string, unknown> };
		};
		expect(put.input.ConditionExpression).toBe('attribute_not_exists(PK)');
		expect(put.input.Item?.childId).toBe(42);
		expect(put.input.Item?.activityId).toBe(7);
	});

	it('重複 (ConditionalCheckFailedException) は null を返す (SQLite uniqueIndex 等価、count 水増し防止)', async () => {
		const err = new Error('The conditional request failed');
		err.name = 'ConditionalCheckFailedException';
		mockSend.mockRejectedValueOnce(err);
		const { insertForRestore } = await loadRepo();
		await expect(insertForRestore(restoreInput, TENANT)).resolves.toBeNull();
	});

	it('throttle 等その他の write 失敗は throw する (#3401 例外分類)', async () => {
		const err = new Error('throughput exceeded');
		err.name = 'ProvisionedThroughputExceededException';
		mockSend.mockRejectedValueOnce(err);
		const { insertForRestore } = await loadRepo();
		await expect(insertForRestore(restoreInput, TENANT)).rejects.toThrow('throughput exceeded');
	});
});
