/**
 * tests/unit/db/dynamodb-daily-mission-repo.test.ts
 *
 * #2845 B1 横展開: daily-mission-repo の markMissionCompleted。
 *
 * 旧実装は tenant prefix を含まない全テーブル Scan (`begins_with(SK,'MISSION#') + id`) +
 * UpdateCommand で全 tenant の mission を write できる形状だった。SK = MISSION#<date>#<activityId>
 * は呼び出し元が全要素を持つため、exact Key (`dailyMissionKey`) 直接 UpdateItem +
 * `attribute_exists(PK)` (phantom 書込み防止) への置換を回帰固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend, MockUpdateCommand, MockScanCommand, MockQueryCommand } = vi.hoisted(() => {
	const send = vi.fn();
	class Cmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	return {
		mockSend: send,
		MockUpdateCommand: class extends Cmd {},
		MockScanCommand: class extends Cmd {},
		MockQueryCommand: class extends Cmd {},
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
		UpdateCommand: MockUpdateCommand,
		ScanCommand: MockScanCommand,
		BatchWriteCommand: Cmd,
	};
});

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/daily-mission-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;
const DATE = '2026-06-12';
const ACTIVITY_ID = 7;

beforeEach(() => {
	mockSend.mockReset();
});
afterEach(() => {
	vi.clearAllMocks();
});

describe('markMissionCompleted (#2845 B1: exact Key + tenant 境界)', () => {
	it('exact Key (literal PK/SK) で直接 UpdateItem する (Scan 不発行)', async () => {
		mockSend.mockResolvedValueOnce({});
		const { markMissionCompleted } = await loadRepo();
		await markMissionCompleted(CHILD_ID, DATE, ACTIVITY_ID, TENANT);

		expect(mockSend).toHaveBeenCalledTimes(1);
		const cmd = mockSend.mock.calls[0]?.[0];
		expect(cmd).toBeInstanceOf(MockUpdateCommand);
		expect(cmd).not.toBeInstanceOf(MockScanCommand);
		const input = (cmd as { input: Record<string, unknown> }).input;
		// literal PK assert: tenant + child 境界が Key で構造的に担保される (cross-tenant write 遮断)
		expect((input.Key as Record<string, string>).PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect((input.Key as Record<string, string>).SK).toBe(`MISSION#${DATE}#00000007`);
		expect(input.UpdateExpression).toContain('completed = :completed');
		// attribute_exists で phantom item 生成を防ぐ
		expect(input.ConditionExpression).toBe('attribute_exists(PK)');
	});

	it('不在 (別 tenant / 別 child を含む) は ConditionalCheckFailed → silent no-op', async () => {
		const err = Object.assign(new Error('conditional check failed'), {
			name: 'ConditionalCheckFailedException',
		});
		mockSend.mockRejectedValueOnce(err);
		const { markMissionCompleted } = await loadRepo();
		await expect(
			markMissionCompleted(CHILD_ID, DATE, ACTIVITY_ID, 'other-tenant'),
		).resolves.toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('ConditionalCheckFailed 以外のエラーは握りつぶさず throw する', async () => {
		mockSend.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'InternalError' }));
		const { markMissionCompleted } = await loadRepo();
		await expect(markMissionCompleted(CHILD_ID, DATE, ACTIVITY_ID, TENANT)).rejects.toThrow('boom');
	});
});

describe('findMissionBonusRecord (#2845 B2: Limit:1 + Filter 併用の遮断)', () => {
	it('Query に Limit を付けず、対象が後続ページに居ても見つける', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p', SK: 's' } }) // page 1: filter 不一致のみ
			.mockResolvedValueOnce({ Items: [{ amount: 30, description: 'ミッションボーナス' }] });
		const { findMissionBonusRecord } = await loadRepo();
		const result = await findMissionBonusRecord(CHILD_ID, 'ミッションボーナス', TENANT);
		expect(result).toEqual({ amount: 30 });

		const first = mockSend.mock.calls[0]?.[0];
		expect(first).toBeInstanceOf(MockQueryCommand);
		const input = (first as { input: Record<string, unknown> }).input;
		// literal PK assert: child partition (tenant + child 境界) で発行される
		expect((input.ExpressionAttributeValues as Record<string, unknown>)[':pk']).toBe(
			`T#${TENANT}#CHILD#${CHILD_ID}`,
		);
		// #2842: Limit + FilterExpression 併用は filter 前評価上限で false NOT_FOUND になる
		expect(input.Limit).toBeUndefined();
	});

	it('全ページ走査しても不在なら undefined を返す', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p', SK: 's' } })
			.mockResolvedValueOnce({ Items: [] });
		const { findMissionBonusRecord } = await loadRepo();
		expect(await findMissionBonusRecord(CHILD_ID, 'x', TENANT)).toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});
