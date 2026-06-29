/**
 * tests/unit/db/dynamodb-reward-redemption-repo.test.ts
 *
 * #2824 Phase 2A / ADR-0055: DynamoDB reward-redemption-repo 本実装の単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/reward-redemption-repo.ts、
 * 挙動 SSOT) と機能等価であることを method ごとに検証する:
 *   - 正しい Command + key で send する (child partition Query / tenant Scan / by-id 解決)
 *   - response を正しく型変換する (toRow / 非正規化フィールド露出)
 *   - SQLite 機能等価 (status default / 最新順 sort / filter / 二重申請 / 期限切れ / 残高非干渉)
 *
 * 背景: 本 repo は #2263 hotfix で read=空 / write=no-op 化され、本番 DynamoDB Lambda で
 *   ごほうび交換 (記録 → ポイント → 交換) が永続しない致命的 gap になっていた。本テストは
 *   本実装の機能等価性を回帰固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AWS SDK Mock (vi.hoisted で先にモック関数と Command クラスを確保)
const {
	mockSend,
	MockGetCommand,
	MockPutCommand,
	MockQueryCommand,
	MockUpdateCommand,
	MockScanCommand,
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
		MockScanCommand: class extends Cmd {},
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
	ScanCommand: MockScanCommand,
	BatchWriteCommand: class {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	},
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/reward-redemption-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;

/** child partition の redemption DynamoDB item を組み立てる (PK/SK + 属性 + 非正規化)。 */
function makeItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const id = (over.id as number) ?? 1;
	const childId = (over.childId as number) ?? CHILD_ID;
	return {
		PK: `T#${TENANT}#CHILD#${childId}`,
		SK: `REDEMPT#${String(id).padStart(8, '0')}`,
		id,
		childId,
		rewardId: 7,
		requestedAt: 1700000000,
		status: 'pending_parent_approval',
		parentNote: null,
		resolvedAt: null,
		resolvedByParentId: null,
		shownToChildAt: null,
		// 非正規化 (JOIN 代替)
		childName: 'けんた',
		rewardTitle: 'アイスクリーム',
		rewardIcon: '🍦',
		rewardPoints: 100,
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
// insertRedemptionRequest
// ============================================================

describe('insertRedemptionRequest', () => {
	it('counter 採番 → child/reward を解決 → PutItem し pending_parent_approval row を返す', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 11 } }) // nextId
			.mockResolvedValueOnce({ Item: { PK: 'p', SK: 'PROFILE', id: CHILD_ID, nickname: 'けんた' } }) // findChildByIdRaw (GetItem)
			.mockResolvedValueOnce({
				Items: [{ id: 7, title: 'アイスクリーム', icon: '🍦', points: 100 }],
			}) // reward Query
			.mockResolvedValueOnce({}); // PutCommand

		const { insertRedemptionRequest } = await loadRepo();
		const row = await insertRedemptionRequest(
			{ childId: CHILD_ID, rewardId: 7, requestedAt: 1700000000 },
			TENANT,
		);

		expect(row).toMatchObject({
			id: 11,
			childId: CHILD_ID,
			rewardId: 7,
			requestedAt: 1700000000,
			status: 'pending_parent_approval',
			parentNote: null,
			resolvedAt: null,
			shownToChildAt: null,
		});

		const putCall = mockSend.mock.calls[3]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(putCall.input.Item?.SK).toBe('REDEMPT#00000011');
		// 非正規化フィールドが item に保存される (JOIN 代替)
		expect(putCall.input.Item?.childName).toBe('けんた');
		expect(putCall.input.Item?.rewardTitle).toBe('アイスクリーム');
		expect(putCall.input.Item?.rewardIcon).toBe('🍦');
		expect(putCall.input.Item?.rewardPoints).toBe(100);
	});

	it('child / reward が不在でも throw せず空文字 / 0 で非正規化する', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 1 } })
			.mockResolvedValueOnce({ Item: undefined }) // child 不在
			.mockResolvedValueOnce({ Items: [] }) // reward 不在
			.mockResolvedValueOnce({});
		const { insertRedemptionRequest } = await loadRepo();
		const row = await insertRedemptionRequest(
			{ childId: CHILD_ID, rewardId: 7, requestedAt: 1 },
			TENANT,
		);
		expect(row.id).toBe(1);
		const putCall = mockSend.mock.calls[3]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.childName).toBe('');
		expect(putCall.input.Item?.rewardPoints).toBe(0);
	});
});

// ============================================================
// findRedemptionRequestsByChild
// ============================================================

describe('findRedemptionRequestsByChild', () => {
	it('child partition を Query し requestedAt 降順で row を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, requestedAt: 100 }),
				makeItem({ id: 2, requestedAt: 300 }),
				makeItem({ id: 3, requestedAt: 200 }),
			],
		});
		const { findRedemptionRequestsByChild } = await loadRepo();
		const rows = await findRedemptionRequestsByChild(CHILD_ID, TENANT);
		expect(rows.map((r) => r.id)).toEqual([2, 3, 1]);
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, string>;
			};
		};
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(callArg.input.ExpressionAttributeValues?.[':prefix']).toBe('REDEMPT#');
		// RedemptionRequestRow は非正規化フィールドを含まない
		expect((rows[0] as unknown as Record<string, unknown>).childName).toBeUndefined();
	});

	it('LastEvaluatedKey でページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeItem({ id: 1 })],
				LastEvaluatedKey: { PK: 'c', SK: 'c' },
			})
			.mockResolvedValueOnce({ Items: [makeItem({ id: 2 })] });
		const { findRedemptionRequestsByChild } = await loadRepo();
		const rows = await findRedemptionRequestsByChild(CHILD_ID, TENANT);
		expect(rows).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('0 件のときは空配列', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findRedemptionRequestsByChild } = await loadRepo();
		expect(await findRedemptionRequestsByChild(CHILD_ID, TENANT)).toEqual([]);
	});

	it('#3337: legacy resolvedByParentId=0 / "0" は読出時に null へ正規化する (SQLite と cross-backend 整合)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, requestedAt: 300, status: 'approved', resolvedByParentId: 0 }),
				makeItem({ id: 2, requestedAt: 200, status: 'rejected', resolvedByParentId: '0' }),
				makeItem({
					id: 3,
					requestedAt: 100,
					status: 'approved',
					resolvedByParentId: 'parent-sub-9',
				}),
			],
		});
		const { findRedemptionRequestsByChild } = await loadRepo();
		const rows = await findRedemptionRequestsByChild(CHILD_ID, TENANT);
		const byId = new Map(rows.map((r) => [r.id, r.resolvedByParentId]));
		// legacy placeholder 0 / '0' は null へ (number が string|null 型に紛れる coercion trap を断つ)
		expect(byId.get(1)).toBeNull();
		expect(byId.get(2)).toBeNull();
		// 実 parent userId はそのまま保持
		expect(byId.get(3)).toBe('parent-sub-9');
	});
});

// ============================================================
// findRedemptionRequestsByTenant
// ============================================================

describe('findRedemptionRequestsByTenant', () => {
	it('tenant Scan し childName / reward 結合付きで降順 + limit を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, requestedAt: 100 }), makeItem({ id: 2, requestedAt: 300 })],
		});
		const { findRedemptionRequestsByTenant } = await loadRepo();
		const rows = await findRedemptionRequestsByTenant(TENANT);
		expect(rows.map((r) => r.id)).toEqual([2, 1]);
		// 非正規化 JOIN フィールドが露出する
		expect(rows[0]).toMatchObject({
			childName: 'けんた',
			rewardTitle: 'アイスクリーム',
			rewardIcon: '🍦',
			rewardPoints: 100,
		});
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, string> };
		};
		expect(callArg.input.ExpressionAttributeValues?.[':tenantPrefix']).toBe(`T#${TENANT}#CHILD#`);
		expect(callArg.input.ExpressionAttributeValues?.[':skPrefix']).toBe('REDEMPT#');
	});

	it('status / childId filter を in-memory 適用する', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, status: 'pending_parent_approval', childId: CHILD_ID }),
				makeItem({ id: 2, status: 'approved', childId: CHILD_ID }),
				makeItem({ id: 3, status: 'pending_parent_approval', childId: 99 }),
			],
		});
		const { findRedemptionRequestsByTenant } = await loadRepo();
		const rows = await findRedemptionRequestsByTenant(TENANT, {
			status: 'pending_parent_approval',
			childId: CHILD_ID,
		});
		expect(rows.map((r) => r.id)).toEqual([1]);
	});

	it('limit で件数を絞る', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, requestedAt: 1 }),
				makeItem({ id: 2, requestedAt: 2 }),
				makeItem({ id: 3, requestedAt: 3 }),
			],
		});
		const { findRedemptionRequestsByTenant } = await loadRepo();
		const rows = await findRedemptionRequestsByTenant(TENANT, { limit: 2 });
		expect(rows.map((r) => r.id)).toEqual([3, 2]);
	});
});

// ============================================================
// updateRedemptionRequestStatus
// ============================================================

describe('updateRedemptionRequestStatus (#2845 課題①: full composite-key addressing)', () => {
	it('childId + id で PK/SK を直接構成し UpdateItem 1 回で完結する (Scan 不使用)', async () => {
		mockSend.mockResolvedValueOnce({
			Attributes: makeItem({
				id: 5,
				status: 'approved',
				resolvedAt: 1700001000,
				resolvedByParentId: 'parent-sub-3',
			}),
		});
		const { updateRedemptionRequestStatus } = await loadRepo();
		const row = await updateRedemptionRequestStatus(
			CHILD_ID,
			5,
			{ status: 'approved', resolvedAt: 1700001000, resolvedByParentId: 'parent-sub-3' },
			TENANT,
		);
		expect(row?.status).toBe('approved');
		expect(row?.resolvedAt).toBe(1700001000);
		// UpdateItem 1 回のみ (旧 tenant Scan 逆引き = #2842 B2 残党は撤去済)
		expect(mockSend).toHaveBeenCalledTimes(1);
		const upd = mockSend.mock.calls[0]?.[0] as {
			input: {
				Key?: Record<string, string>;
				UpdateExpression?: string;
				ConditionExpression?: string;
			};
		};
		// tenant + child 境界が composite key で構造的に担保される
		expect(upd.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(upd.input.Key?.SK).toBe('REDEMPT#00000005');
		expect(upd.input.ConditionExpression).toBe('attribute_exists(PK)');
		expect(upd.input.UpdateExpression).toContain('#status = :status');
		expect(upd.input.UpdateExpression).toContain('resolvedAt = :resolvedAt');
		expect(upd.input.UpdateExpression).toContain('resolvedByParentId = :resolvedByParentId');
		// parentNote は undefined のため SET に含めない
		expect(upd.input.UpdateExpression).not.toContain('parentNote');
	});

	it('null は明示的に SET する (rejected の parentNote=null 等)', async () => {
		mockSend.mockResolvedValueOnce({
			Attributes: makeItem({ id: 5, status: 'rejected', parentNote: null }),
		});
		const { updateRedemptionRequestStatus } = await loadRepo();
		await updateRedemptionRequestStatus(
			CHILD_ID,
			5,
			{ status: 'rejected', parentNote: null },
			TENANT,
		);
		const upd = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(upd.input.ExpressionAttributeValues?.[':parentNote']).toBeNull();
	});

	it('(childId, id) 不一致 / 不在は ConditionalCheckFailedException → undefined', async () => {
		mockSend.mockRejectedValueOnce(
			Object.assign(new Error('conditional check failed'), {
				name: 'ConditionalCheckFailedException',
			}),
		);
		const { updateRedemptionRequestStatus } = await loadRepo();
		expect(
			await updateRedemptionRequestStatus(CHILD_ID, 99, { status: 'approved' }, TENANT),
		).toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('残高に触れない (point ledger / balance への write を行わない)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: makeItem({ id: 5, status: 'approved' }) });
		const { updateRedemptionRequestStatus } = await loadRepo();
		await updateRedemptionRequestStatus(CHILD_ID, 5, { status: 'approved' }, TENANT);
		// Update の 1 send のみ。BALANCE / POINT への追加 write は service 層の責務。
		expect(mockSend).toHaveBeenCalledTimes(1);
		for (const call of mockSend.mock.calls) {
			const input = (call[0] as { input: { Key?: { SK?: string } } }).input;
			expect(input.Key?.SK ?? '').not.toContain('BALANCE');
		}
	});
});

// ============================================================
// findPendingByChildAndReward
// ============================================================

describe('findPendingByChildAndReward', () => {
	it('child の REDEMPT# から rewardId + pending 一致を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, rewardId: 7, status: 'approved' }),
				makeItem({ id: 2, rewardId: 7, status: 'pending_parent_approval' }),
			],
		});
		const { findPendingByChildAndReward } = await loadRepo();
		const row = await findPendingByChildAndReward(CHILD_ID, 7, TENANT);
		expect(row?.id).toBe(2);
	});

	it('pending が無いとき undefined', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, rewardId: 7, status: 'approved' })],
		});
		const { findPendingByChildAndReward } = await loadRepo();
		expect(await findPendingByChildAndReward(CHILD_ID, 7, TENANT)).toBeUndefined();
	});
});

// ============================================================
// findUnshownResultByChild
// ============================================================

describe('findUnshownResultByChild', () => {
	it('approved/rejected かつ未表示を resolvedAt 降順で 1 件 + reward 結合', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, status: 'approved', resolvedAt: 100, shownToChildAt: null }),
				makeItem({ id: 2, status: 'rejected', resolvedAt: 300, shownToChildAt: null }),
				makeItem({ id: 3, status: 'approved', resolvedAt: 400, shownToChildAt: 999 }), // 表示済 → 除外
				makeItem({ id: 4, status: 'pending_parent_approval', resolvedAt: null }), // pending → 除外
			],
		});
		const { findUnshownResultByChild } = await loadRepo();
		const row = await findUnshownResultByChild(CHILD_ID, TENANT);
		expect(row?.id).toBe(2);
		expect(row?.rewardTitle).toBe('アイスクリーム');
		expect(row?.rewardIcon).toBe('🍦');
	});

	it('候補が無いとき undefined', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, status: 'pending_parent_approval' })],
		});
		const { findUnshownResultByChild } = await loadRepo();
		expect(await findUnshownResultByChild(CHILD_ID, TENANT)).toBeUndefined();
	});
});

// ============================================================
// markRedemptionResultShown
// ============================================================

describe('markRedemptionResultShown (#2845 課題①: full composite-key addressing)', () => {
	it('childId + id で PK/SK を直接構成し shownToChildAt を SET する (Scan 不使用)', async () => {
		mockSend.mockResolvedValueOnce({
			Attributes: makeItem({ id: 5, shownToChildAt: 1700002000 }),
		});
		const { markRedemptionResultShown } = await loadRepo();
		const row = await markRedemptionResultShown(CHILD_ID, 5, TENANT);
		expect(row?.shownToChildAt).toBe(1700002000);
		expect(mockSend).toHaveBeenCalledTimes(1);
		const upd = mockSend.mock.calls[0]?.[0] as {
			input: {
				Key?: Record<string, string>;
				UpdateExpression?: string;
				ConditionExpression?: string;
			};
		};
		expect(upd.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(upd.input.Key?.SK).toBe('REDEMPT#00000005');
		expect(upd.input.ConditionExpression).toBe('attribute_exists(PK)');
		expect(upd.input.UpdateExpression).toContain('shownToChildAt = :now');
	});

	it('(childId, id) 不一致 / 不在は ConditionalCheckFailedException → undefined', async () => {
		mockSend.mockRejectedValueOnce(
			Object.assign(new Error('conditional check failed'), {
				name: 'ConditionalCheckFailedException',
			}),
		);
		const { markRedemptionResultShown } = await loadRepo();
		expect(await markRedemptionResultShown(CHILD_ID, 99, TENANT)).toBeUndefined();
	});
});

// ============================================================
// expireOldRedemptions
// ============================================================

describe('expireOldRedemptions', () => {
	it('30 日超 pending を Scan → expired に Update し件数を返す', async () => {
		const old = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
		const recent = Math.floor(Date.now() / 1000) - 1 * 24 * 60 * 60;
		mockSend
			.mockResolvedValueOnce({
				Items: [
					makeItem({ id: 1, status: 'pending_parent_approval', requestedAt: old }),
					makeItem({ id: 2, status: 'pending_parent_approval', requestedAt: recent }), // 期限内 → 除外
					makeItem({ id: 3, status: 'approved', requestedAt: old }), // 非 pending → 除外
				],
			})
			.mockResolvedValueOnce({}); // 1 Update
		const { expireOldRedemptions } = await loadRepo();
		const count = await expireOldRedemptions(TENANT);
		expect(count).toBe(1);
		// 1 Scan + 1 Update
		expect(mockSend).toHaveBeenCalledTimes(2);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(upd.input.ExpressionAttributeValues?.[':expired']).toBe('expired');
	});

	it('対象 0 件のとき 0 を返し Update しない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { expireOldRedemptions } = await loadRepo();
		expect(await expireOldRedemptions(TENANT)).toBe(0);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});
});

// ============================================================
// hasPendingByReward
// ============================================================

describe('hasPendingByReward', () => {
	it('rewardId に pending があれば true', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, rewardId: 7, status: 'pending_parent_approval' })],
		});
		const { hasPendingByReward } = await loadRepo();
		expect(await hasPendingByReward(7, TENANT)).toBe(true);
	});

	it('pending が無ければ false', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, rewardId: 7, status: 'approved' })],
		});
		const { hasPendingByReward } = await loadRepo();
		expect(await hasPendingByReward(7, TENANT)).toBe(false);
	});
});

// ============================================================
// deleteByTenantId
// ============================================================

describe('deleteByTenantId', () => {
	it('CHILD#* 配下の REDEMPT# を Scan → BatchWrite で削除する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [
					{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'REDEMPT#00000001' },
					{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: 'REDEMPT#00000002' },
				],
			})
			.mockResolvedValueOnce({}); // BatchWrite
		const { deleteByTenantId } = await loadRepo();
		await deleteByTenantId(TENANT);
		const scan = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, string> };
		};
		expect(scan.input.ExpressionAttributeValues?.[':pkPrefix']).toBe(`T#${TENANT}#CHILD#`);
		expect(scan.input.ExpressionAttributeValues?.[':skPrefix']).toBe('REDEMPT#');
	});
});

// ============================================================
// interface 適合 (SQLite との機能等価性)
// ============================================================

describe('interface 適合 (IRewardRedemptionRepo)', () => {
	it('全メソッドを export している (stub に後退していない)', async () => {
		const repo = await loadRepo();
		for (const m of [
			'insertRedemptionRequest',
			'findRedemptionRequestsByChild',
			'findRedemptionRequestsByTenant',
			'updateRedemptionRequestStatus',
			'findPendingByChildAndReward',
			'findUnshownResultByChild',
			'markRedemptionResultShown',
			'expireOldRedemptions',
			'hasPendingByReward',
			'deleteByTenantId',
		]) {
			expect(typeof (repo as Record<string, unknown>)[m]).toBe('function');
		}
	});

	it('write method が no-op stub でない (insertRedemptionRequest が実 send する)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 1 } })
			.mockResolvedValueOnce({ Item: undefined })
			.mockResolvedValueOnce({ Items: [] })
			.mockResolvedValueOnce({});
		const { insertRedemptionRequest } = await loadRepo();
		const row = await insertRedemptionRequest(
			{ childId: CHILD_ID, rewardId: 7, requestedAt: 1 },
			TENANT,
		);
		// stub なら id=0 / send 0 回だった。本実装は counter 採番 + Put を行う。
		expect(row.id).toBe(1);
		expect(mockSend).toHaveBeenCalled();
	});
});
