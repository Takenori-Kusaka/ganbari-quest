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

describe('updateSpecialReward (#2832 / #2845 課題①)', () => {
	it('child partition Query で item を特定し、指定フィールドのみ SET 更新する', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [makeRewardItem()] }) // findRewardItemByChildAndId (Query)
			.mockResolvedValueOnce({
				Attributes: makeRewardItem({ title: '新しい名前', points: 50 }),
			}); // UpdateCommand

		const { updateSpecialReward } = await loadRepo();
		const result = await updateSpecialReward(
			CHILD_ID,
			REWARD_ID,
			{ title: '新しい名前', points: 50 },
			TENANT,
		);

		// Query が child partition (tenant + child 境界) + REWARD# prefix + id filter で発行される
		const query = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(query.input.KeyConditionExpression).toContain('PK = :pk');
		expect(query.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(query.input.ExpressionAttributeValues?.[':prefix']).toBe('REWARD#');
		expect(query.input.ExpressionAttributeValues?.[':id']).toBe(REWARD_ID);

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
		const result = await updateSpecialReward(CHILD_ID, REWARD_ID, { title: 'x' }, TENANT);
		expect(result).toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('更新フィールドが空の場合は現状 item を返し Update しない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeRewardItem()] });
		const { updateSpecialReward } = await loadRepo();
		const result = await updateSpecialReward(CHILD_ID, REWARD_ID, {}, TENANT);
		expect(result?.title).toBe('ゲーム時間30分');
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	// #3183 / #3154: shopCategory (陳列系統) の dynamodb round-trip。SQLite e2e は本体 PR で担保済だが
	// dynamodb backend は未 exercise だった。明示値 / null リセット の両方が UpdateCommand に正しく
	// marshalling され round-trip することを固定する (prod=dynamodb で「auto にリセット」が silent
	// no-op になる latent risk の回帰防止、既出荷 icon nullable と構造同型)。
	it('#3183: shopCategory 明示値を SET し round-trip する (money)', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [makeRewardItem()] })
			.mockResolvedValueOnce({ Attributes: makeRewardItem({ shopCategory: 'money' }) });
		const { updateSpecialReward } = await loadRepo();
		const result = await updateSpecialReward(
			CHILD_ID,
			REWARD_ID,
			{ shopCategory: 'money' },
			TENANT,
		);
		const update = mockSend.mock.calls[1]?.[0] as {
			input: {
				UpdateExpression?: string;
				ExpressionAttributeNames?: Record<string, string>;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(update.input.UpdateExpression).toContain('#shopCategory = :shopCategory');
		expect(update.input.ExpressionAttributeNames?.['#shopCategory']).toBe('shopCategory');
		expect(update.input.ExpressionAttributeValues?.[':shopCategory']).toBe('money');
		expect(result?.shopCategory).toBe('money');
	});

	it('#3183: shopCategory=null (auto リセット) も SET し null を marshalling round-trip する', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [makeRewardItem({ shopCategory: 'money' })] })
			.mockResolvedValueOnce({ Attributes: makeRewardItem({ shopCategory: null }) });
		const { updateSpecialReward } = await loadRepo();
		const result = await updateSpecialReward(CHILD_ID, REWARD_ID, { shopCategory: null }, TENANT);
		const update = mockSend.mock.calls[1]?.[0] as {
			input: {
				UpdateExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		// null も undefined と区別して SET される (no-op で旧値を残さない = auto へ確実にリセット)
		expect(update.input.UpdateExpression).toContain('#shopCategory = :shopCategory');
		expect(update.input.ExpressionAttributeValues).toHaveProperty(':shopCategory');
		expect(update.input.ExpressionAttributeValues?.[':shopCategory']).toBeNull();
		expect(result?.shopCategory).toBeNull();
	});
});

describe('deleteSpecialReward (#2832 / #2845 課題①)', () => {
	it('reward item と当該 reward の REDEMPT# item を削除して true を返す (SQLite cascade と等価)', async () => {
		const redemptionItem = {
			PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
			SK: 'REDEMPT#00000001',
			id: 1,
			rewardId: REWARD_ID,
			status: 'rejected',
		};
		mockSend
			.mockResolvedValueOnce({ Items: [makeRewardItem()] }) // findRewardItemByChildAndId (Query)
			.mockResolvedValueOnce({ Items: [redemptionItem] }) // REDEMPT# child partition Query
			.mockResolvedValueOnce({}) // DeleteCommand (redemption)
			.mockResolvedValueOnce({}); // DeleteCommand (reward)

		const { deleteSpecialReward } = await loadRepo();
		const result = await deleteSpecialReward(CHILD_ID, REWARD_ID, TENANT);
		expect(result).toBe(true);

		// REDEMPT# 収集が child partition Query (tenant + child 境界) + rewardId filter で発行される
		const redemptQuery = mockSend.mock.calls[1]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(redemptQuery.input.KeyConditionExpression).toContain('PK = :pk');
		expect(redemptQuery.input.ExpressionAttributeValues?.[':pk']).toBe(
			`T#${TENANT}#CHILD#${CHILD_ID}`,
		);
		expect(redemptQuery.input.ExpressionAttributeValues?.[':skPrefix']).toBe('REDEMPT#');
		expect(redemptQuery.input.ExpressionAttributeValues?.[':rid']).toBe(REWARD_ID);

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
		const result = await deleteSpecialReward(CHILD_ID, REWARD_ID, TENANT);
		expect(result).toBe(false);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

describe('markRewardShown (#2845 B1: tenant 境界 + paging)', () => {
	it('item 検索が tenant 境界で絞られる (cross-tenant IDOR 形状の遮断)', async () => {
		// 検索 (Query/Scan) 0 件 → undefined。発行された検索条件の値に自 tenant prefix が
		// 含まれることを assert する (旧実装は begins_with(SK,'REWARD#') + id のみで
		// FilterExpression に tenant 束縛が無く、全 tenant の REWARD# item に到達できた)。
		mockSend.mockResolvedValue({ Items: [] });
		const repo = await loadRepo();
		await repo.markRewardShown(CHILD_ID, REWARD_ID, TENANT);

		const first = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		const values = Object.values(first.input.ExpressionAttributeValues ?? {});
		const tenantScoped = values.some((v) => typeof v === 'string' && v.startsWith(`T#${TENANT}#`));
		expect(tenantScoped).toBe(true);
	});

	it('対象 item が後続ページに居ても見つけて更新する (#2842 Limit:1 + Filter class の遮断)', async () => {
		const shownAt = '2026-06-12T00:00:00.000Z';
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p', SK: 's' } }) // page 1: 空振り
			.mockResolvedValueOnce({ Items: [makeRewardItem()] }) // page 2: 一致
			.mockResolvedValueOnce({ Attributes: makeRewardItem({ shownAt }) }); // UpdateCommand

		const repo = await loadRepo();
		const result = await repo.markRewardShown(CHILD_ID, REWARD_ID, TENANT);
		expect(result?.shownAt).toBe(shownAt);
	});

	it('全ページ走査しても不在なら undefined を返し Update しない', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p', SK: 's' } })
			.mockResolvedValueOnce({ Items: [] });
		const repo = await loadRepo();
		expect(await repo.markRewardShown(CHILD_ID, REWARD_ID, TENANT)).toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});

describe('findUnshownReward (#2845 B2: Limit:1 + Filter 併用の遮断)', () => {
	it('Query に Limit を付けず child partition (tenant + child 境界) で発行する', async () => {
		mockSend.mockResolvedValue({ Items: [makeRewardItem()] });
		const repo = await loadRepo();
		const result = await repo.findUnshownReward(CHILD_ID, TENANT);

		const query = mockSend.mock.calls[0]?.[0];
		expect(query).toBeInstanceOf(MockQueryCommand);
		expect(query).not.toBeInstanceOf(MockScanCommand);
		const input = (query as { input: Record<string, unknown> }).input;
		// literal PK assert: tenant + child 境界が KeyCondition で構造的に担保される
		expect((input.ExpressionAttributeValues as Record<string, unknown>)[':pk']).toBe(
			`T#${TENANT}#CHILD#${CHILD_ID}`,
		);
		// #2842: Limit + FilterExpression 併用は filter 前評価上限で false NOT_FOUND になる
		expect(input.Limit).toBeUndefined();
		expect(result?.id).toBe(REWARD_ID);
	});

	it('未表示 reward が後続ページに居ても見つける (旧 Limit:1 では false NOT_FOUND)', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p', SK: 's' } }) // page 1: shown 済のみ filter で 0 件
			.mockResolvedValueOnce({ Items: [makeRewardItem()] }); // page 2: 未表示 hit
		const repo = await loadRepo();
		const result = await repo.findUnshownReward(CHILD_ID, TENANT);
		expect(result?.id).toBe(REWARD_ID);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('全ページ走査しても未表示が無ければ undefined', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p', SK: 's' } })
			.mockResolvedValueOnce({ Items: [] });
		const repo = await loadRepo();
		expect(await repo.findUnshownReward(CHILD_ID, TENANT)).toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(2);
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
