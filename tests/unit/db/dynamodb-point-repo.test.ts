/**
 * tests/unit/db/dynamodb-point-repo.test.ts
 *
 * #3356 (2): DynamoDB spendPointsAtomic の自動テスト (旧: SQLite のみで DynamoDB 側は未カバー)。
 *
 * 検証範囲:
 *   - 原子パス: 残高条件付き減算 + ledger Put (+ referenceId 付きは冪等 marker Put #3284) が
 *     単一 TransactWriteItems で送られる
 *   - error 分類: CancellationReasons[0] (残高条件) のみ INSUFFICIENT_POINTS に分類。
 *     CancellationReasons 無しの TransactionCanceledException (transient conflict / throttle) は
 *     throw する (旧 `?? true` は「残高不足」に誤分類していた → `#3356 (2)` refine の回帰固定)
 *   - 冪等 marker 条件違反 (同一 reference の二重減算、#3284) は明示 throw
 *
 * AWS SDK は vi.hoisted mock で置換する (dynamodb-reward-redemption-repo test と同型)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';

const {
	mockSend,
	MockGetCommand,
	MockPutCommand,
	MockQueryCommand,
	MockUpdateCommand,
	MockTransactWriteCommand,
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
		MockTransactWriteCommand: class extends Cmd {},
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
	TransactWriteCommand: MockTransactWriteCommand,
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/point-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = asChildId(42);

type TransactInput = {
	input: {
		TransactItems?: Array<{
			Update?: {
				Key?: Record<string, string>;
				UpdateExpression?: string;
				ConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
			Put?: { Item?: Record<string, unknown>; ConditionExpression?: string };
		}>;
	};
};

function cancelError(reasons?: Array<{ Code?: string }>) {
	return Object.assign(new Error('canceled'), {
		name: 'TransactionCanceledException',
		...(reasons !== undefined ? { CancellationReasons: reasons } : {}),
	});
}

beforeEach(() => {
	mockSend.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('spendPointsAtomic (#3347 原子減算 / #3356 (2) DynamoDB カバレッジ)', () => {
	it('残高条件付き減算 + ledger Put + 冪等 marker Put を単一 TransactWrite で送る (referenceId あり)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 301 } }) // nextId(pointLedger)
			.mockResolvedValueOnce({}); // TransactWrite
		const { spendPointsAtomic } = await loadRepo();
		const result = await spendPointsAtomic(
			CHILD_ID,
			80,
			{ type: 'reward_redemption', description: 'アイスクリーム', referenceId: '9' },
			TENANT,
		);
		expect('error' in result).toBe(false);
		if ('error' in result) throw new Error('unreachable');
		expect(result.amount).toBe(-80);

		const transact = mockSend.mock.calls[1]?.[0] as TransactInput;
		const items = transact.input.TransactItems ?? [];
		expect(items).toHaveLength(3);
		// item 1: 残高 >= コスト のときのみ原子減算
		const upd = items[0]?.Update;
		expect(upd?.Key?.SK).toBe('BALANCE');
		expect(upd?.ConditionExpression).toBe('#balance >= :amount');
		expect(upd?.ExpressionAttributeValues?.[':neg']).toBe(-80);
		// item 2: 負値 ledger Put
		expect(items[1]?.Put?.Item).toMatchObject({
			amount: -80,
			type: 'reward_redemption',
			referenceId: 9,
		});
		// item 3: 冪等 marker (#3284、同一 reference の二重減算を物理拒否)
		const marker = items[2]?.Put;
		expect(marker?.ConditionExpression).toBe('attribute_not_exists(PK)');
		expect(String(marker?.Item?.SK)).toBe('POINTIDEM#reward_redemption#00000009');
	});

	it('referenceId 無しは 2 item (marker 対象外)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 302 } }).mockResolvedValueOnce({});
		const { spendPointsAtomic } = await loadRepo();
		await spendPointsAtomic(CHILD_ID, 10, { type: 'adjust', description: '調整' }, TENANT);
		const transact = mockSend.mock.calls[1]?.[0] as TransactInput;
		expect(transact.input.TransactItems).toHaveLength(2);
	});

	it('残高条件 (index 0) の ConditionalCheckFailed → INSUFFICIENT_POINTS を返す (減算なし fail-closed)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 303 } })
			.mockRejectedValueOnce(
				cancelError([{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }, { Code: 'None' }]),
			);
		const { spendPointsAtomic } = await loadRepo();
		const result = await spendPointsAtomic(
			CHILD_ID,
			9999,
			{ type: 'reward_redemption', description: 'x', referenceId: '9' },
			TENANT,
		);
		expect(result).toEqual({ error: 'INSUFFICIENT_POINTS' });
	});

	it('#3356 (2): CancellationReasons 無しの TransactionCanceledException は INSUFFICIENT に誤分類せず throw する', async () => {
		// transient conflict / throttle 相当。旧 `?? true` は「残高不足」と誤表示していた。
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 304 } })
			.mockRejectedValueOnce(cancelError(undefined));
		const { spendPointsAtomic } = await loadRepo();
		await expect(
			spendPointsAtomic(
				CHILD_ID,
				10,
				{ type: 'reward_redemption', description: 'x', referenceId: '9' },
				TENANT,
			),
		).rejects.toThrow();
	});

	it('#3284: 冪等 marker (index 2) の ConditionalCheckFailed = 同一 reference の二重減算 → 明示 throw', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 305 } })
			.mockRejectedValueOnce(
				cancelError([{ Code: 'None' }, { Code: 'None' }, { Code: 'ConditionalCheckFailed' }]),
			);
		const { spendPointsAtomic } = await loadRepo();
		await expect(
			spendPointsAtomic(
				CHILD_ID,
				10,
				{ type: 'reward_redemption', description: 'x', referenceId: '9' },
				TENANT,
			),
		).rejects.toThrow(/duplicate spend rejected/);
	});

	it('TransactionCanceledException 以外のエラー (throttle / network) はそのまま throw する', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 306 } })
			.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'InternalServerError' }));
		const { spendPointsAtomic } = await loadRepo();
		await expect(
			spendPointsAtomic(
				CHILD_ID,
				10,
				{ type: 'reward_redemption', description: 'x', referenceId: '9' },
				TENANT,
			),
		).rejects.toThrow('boom');
	});
});
