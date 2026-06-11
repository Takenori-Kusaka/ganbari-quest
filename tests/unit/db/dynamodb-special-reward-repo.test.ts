/**
 * tests/unit/db/dynamodb-special-reward-repo.test.ts
 *
 * #2832: DynamoDB special-reward-repo の updateSpecialReward / deleteSpecialReward 単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/special-reward-repo.ts、挙動 SSOT)
 * と機能等価であることを検証する:
 *   - updateSpecialReward: tenant scoped Scan で item 特定 → UpdateCommand (部分 SET)
 *     pending redemption 中でも repo 層は無条件更新 (編集許容は service / PO 案 b)
 *   - deleteSpecialReward: reward item + 当該 reward の REDEMPT# item を削除
 *     (SQLite の FK 整合 cascade 削除と等価)、未存在なら false
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockSend,
	MockPutCommand,
	MockQueryCommand,
	MockUpdateCommand,
	MockScanCommand,
	MockDeleteCommand,
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
		MockPutCommand: class extends Cmd {},
		MockQueryCommand: class extends Cmd {},
		MockUpdateCommand: class extends Cmd {},
		MockScanCommand: class extends Cmd {},
		MockDeleteCommand: class extends Cmd {},
	};
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
	DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
	GetCommand: class {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	},
	PutCommand: MockPutCommand,
	QueryCommand: MockQueryCommand,
	UpdateCommand: MockUpdateCommand,
	ScanCommand: MockScanCommand,
	DeleteCommand: MockDeleteCommand,
	BatchWriteCommand: class {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	},
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/special-reward-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;
const REWARD_ID = 7;

function makeRewardItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
		SK: `REWARD#2026-06-01T00:00:00.000Z#${REWARD_ID}`,
		id: REWARD_ID,
		childId: CHILD_ID,
		grantedBy: null,
		title: 'ゲーム時間30分',
		description: null,
		points: 80,
		icon: '🎮',
		category: 'とくべつ',
		grantedAt: '2026-06-01T00:00:00.000Z',
		shownAt: null,
		sourcePresetId: null,
		...over,
	};
}

beforeEach(() => {
	mockSend.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('updateSpecialReward (#2832)', () => {
	it('tenant scoped Scan で item を特定し、指定フィールドのみ SET 更新する', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [makeRewardItem()] }) // findRewardItemById (Scan)
			.mockResolvedValueOnce({
				Attributes: makeRewardItem({ title: '新しい名前', points: 50 }),
			}); // UpdateCommand

		const { updateSpecialReward } = await loadRepo();
		const result = await updateSpecialReward(
			REWARD_ID,
			{ title: '新しい名前', points: 50 },
			TENANT,
		);

		// Scan が tenant prefix + REWARD# prefix + id filter で発行される
		const scan = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(scan.input.ExpressionAttributeValues?.[':tenantPrefix']).toBe(`T#${TENANT}#CHILD#`);
		expect(scan.input.ExpressionAttributeValues?.[':prefix']).toBe('REWARD#');
		expect(scan.input.ExpressionAttributeValues?.[':id']).toBe(REWARD_ID);

		// UpdateCommand が title / points のみ SET する (icon / category は含めない)
		const update = mockSend.mock.calls[1]?.[0] as {
			input: {
				UpdateExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(update.input.UpdateExpression).toContain('#title = :title');
		expect(update.input.UpdateExpression).toContain('#points = :points');
		expect(update.input.UpdateExpression).not.toContain(':icon');
		expect(update.input.ExpressionAttributeValues?.[':title']).toBe('新しい名前');
		expect(update.input.ExpressionAttributeValues?.[':points']).toBe(50);

		expect(result?.title).toBe('新しい名前');
		expect(result?.points).toBe(50);
	});

	it('対象 reward が存在しない場合は undefined を返し Update しない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { updateSpecialReward } = await loadRepo();
		const result = await updateSpecialReward(REWARD_ID, { title: 'x' }, TENANT);
		expect(result).toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('更新フィールドが空の場合は現状 item を返し Update しない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeRewardItem()] });
		const { updateSpecialReward } = await loadRepo();
		const result = await updateSpecialReward(REWARD_ID, {}, TENANT);
		expect(result?.title).toBe('ゲーム時間30分');
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

describe('deleteSpecialReward (#2832)', () => {
	it('reward item と当該 reward の REDEMPT# item を削除して true を返す (SQLite cascade と等価)', async () => {
		const redemptionItem = {
			PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
			SK: 'REDEMPT#00000001',
			id: 1,
			rewardId: REWARD_ID,
			status: 'rejected',
		};
		mockSend
			.mockResolvedValueOnce({ Items: [makeRewardItem()] }) // findRewardItemById (Scan)
			.mockResolvedValueOnce({ Items: [redemptionItem] }) // REDEMPT# Scan
			.mockResolvedValueOnce({}) // DeleteCommand (redemption)
			.mockResolvedValueOnce({}); // DeleteCommand (reward)

		const { deleteSpecialReward } = await loadRepo();
		const result = await deleteSpecialReward(REWARD_ID, TENANT);
		expect(result).toBe(true);

		// REDEMPT# Scan が rewardId filter 付きで発行される
		const redemptScan = mockSend.mock.calls[1]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(redemptScan.input.ExpressionAttributeValues?.[':skPrefix']).toBe('REDEMPT#');
		expect(redemptScan.input.ExpressionAttributeValues?.[':rid']).toBe(REWARD_ID);

		// redemption item → reward item の順で DeleteCommand
		const delRedemption = mockSend.mock.calls[2]?.[0] as {
			input: { Key?: Record<string, string> };
		};
		expect(delRedemption.input.Key?.SK).toBe('REDEMPT#00000001');
		const delReward = mockSend.mock.calls[3]?.[0] as {
			input: { Key?: Record<string, string> };
		};
		expect(delReward.input.Key?.SK).toBe(`REWARD#2026-06-01T00:00:00.000Z#${REWARD_ID}`);
	});

	it('対象 reward が存在しない場合は false を返し Delete しない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { deleteSpecialReward } = await loadRepo();
		const result = await deleteSpecialReward(REWARD_ID, TENANT);
		expect(result).toBe(false);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

describe('interface 適合 (ISpecialRewardRepo、#2832 拡張)', () => {
	it('updateSpecialReward / deleteSpecialReward を含む全メソッドを export している', async () => {
		const repo = await loadRepo();
		for (const m of [
			'insertSpecialReward',
			'findSpecialRewards',
			'findUnshownReward',
			'markRewardShown',
			'updateSpecialReward',
			'deleteSpecialReward',
			'deleteByTenantId',
		]) {
			expect(typeof (repo as Record<string, unknown>)[m]).toBe('function');
		}
	});
});
