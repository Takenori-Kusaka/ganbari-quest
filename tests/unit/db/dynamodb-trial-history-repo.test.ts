/**
 * tests/unit/db/dynamodb-trial-history-repo.test.ts
 *
 * #1016 / #2932 / ADR-0055: DynamoDB トライアル履歴 repo 本実装の単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/trial-history-repo.ts、挙動 SSOT) と
 * 機能等価であることを method ごとに検証する:
 *   - 正しい Command + key で send する (tenant partition への配置 / counter 採番)
 *   - response を正しく型変換する (stripKeys / null backfill)
 *   - SQLite 機能等価 (最新 1 件 / endDate>=today filter / conversion id 解決)
 *
 * 背景 (#2932 CRITICAL): 本 repo は GRANDFATHERED_STUBS (#1016) として全関数 no-op stub のまま
 *   本番稼働しており、startTrial → insert() が永続せず trial 開始が偽 success になっていた。
 *   本テストは本実装の機能等価性を回帰固定し、stub への後退を防ぐ。
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
	// deleteByTenantId は bulk-delete.ts (BatchWriteCommand + QueryCommand) を動的 import する。
	BatchWriteCommand: class {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	},
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/trial-history-repo');
}

const TENANT = 'tenant-1';

/** tenant partition の DynamoDB trial history item を組み立てる (PK/SK + 属性)。 */
function makeItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const id = (over.id as number) ?? 1;
	return {
		PK: `T#${TENANT}#TRIAL`,
		SK: `HIST#${String(id).padStart(8, '0')}`,
		id,
		tenantId: TENANT,
		startDate: '2026-06-01',
		endDate: '2026-06-08',
		tier: 'standard',
		source: 'user_initiated',
		campaignId: null,
		stripeSubscriptionId: null,
		upgradeReason: null,
		trialStartSource: null,
		createdAt: '2026-06-01T00:00:00.000Z',
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
// insert (永続の核心経路 — #2932 の本丸)
// ============================================================

describe('insert', () => {
	it('counter 採番 → tenant partition に PutItem する (本番 startTrial 永続経路)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 42 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand

		const { insert } = await loadRepo();
		await insert({
			tenantId: TENANT,
			startDate: '2026-06-05',
			endDate: '2026-06-12',
			tier: 'standard',
			source: 'user_initiated',
		});

		// nextId(counter) + Put の 2 回 send
		expect(mockSend).toHaveBeenCalledTimes(2);

		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.PK).toBe(`T#${TENANT}#TRIAL`);
		expect(putCall.input.Item?.SK).toBe('HIST#00000042');
		expect(putCall.input.Item?.id).toBe(42);
		expect(putCall.input.Item?.tenantId).toBe(TENANT);
		expect(putCall.input.Item?.startDate).toBe('2026-06-05');
		expect(putCall.input.Item?.endDate).toBe('2026-06-12');
		expect(putCall.input.Item?.tier).toBe('standard');
		expect(putCall.input.Item?.source).toBe('user_initiated');
		// conversion 列は null 初期化
		expect(putCall.input.Item?.stripeSubscriptionId).toBeNull();
		expect(putCall.input.Item?.upgradeReason).toBeNull();
		expect(typeof putCall.input.Item?.createdAt).toBe('string');
	});

	it('campaignId / trialStartSource を保存する (null 既定)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insert } = await loadRepo();
		await insert({
			tenantId: TENANT,
			startDate: '2026-06-05',
			endDate: '2026-06-12',
			tier: 'family',
			source: 'campaign',
			campaignId: 'spring-2026',
			trialStartSource: '/pricing',
		});
		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.campaignId).toBe('spring-2026');
		expect(putCall.input.Item?.trialStartSource).toBe('/pricing');
		expect(putCall.input.Item?.tier).toBe('family');
	});
});

// ============================================================
// findLatestByTenant (trial 状態判定の hot path)
// ============================================================

describe('findLatestByTenant', () => {
	it('tenant partition を逆順 Query Limit 1 で最新 1 件取得する', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeItem({ id: 9, source: 'admin_grant' })] });
		const { findLatestByTenant } = await loadRepo();
		const row = await findLatestByTenant(TENANT);

		expect(row?.id).toBe(9);
		expect(row?.source).toBe('admin_grant');
		expect(row?.tenantId).toBe(TENANT);

		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, string>;
				ScanIndexForward?: boolean;
				Limit?: number;
			};
		};
		expect(callArg.input.KeyConditionExpression).toContain('PK = :pk');
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#TRIAL`);
		expect(callArg.input.ExpressionAttributeValues?.[':prefix']).toBe('HIST#');
		// ORDER BY id DESC LIMIT 1 と等価
		expect(callArg.input.ScanIndexForward).toBe(false);
		expect(callArg.input.Limit).toBe(1);
	});

	it('履歴が無いとき undefined を返す (未使用 = trial 非アクティブ)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findLatestByTenant } = await loadRepo();
		expect(await findLatestByTenant(TENANT)).toBeUndefined();
	});

	it('conversion 列が欠落した item を null backfill する', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, stripeSubscriptionId: undefined, upgradeReason: undefined })],
		});
		const { findLatestByTenant } = await loadRepo();
		const row = await findLatestByTenant(TENANT);
		expect(row?.stripeSubscriptionId).toBeNull();
		expect(row?.upgradeReason).toBeNull();
	});
});

// ============================================================
// findActiveTrials (cron 通知対象、全 tenant 横断)
// ============================================================

describe('findActiveTrials', () => {
	it('endDate >= today の filter で全 tenant 横断 Scan する', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, tenantId: 't-a' }), makeItem({ id: 2, tenantId: 't-b' })],
		});
		const { findActiveTrials } = await loadRepo();
		const rows = await findActiveTrials();
		expect(rows.map((r) => r.tenantId)).toEqual(['t-a', 't-b']);

		const scanCall = mockSend.mock.calls[0]?.[0] as {
			input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(scanCall.input.FilterExpression).toContain('begins_with(SK, :prefix)');
		expect(scanCall.input.FilterExpression).toContain('endDate >= :today');
		expect(scanCall.input.ExpressionAttributeValues?.[':prefix']).toBe('HIST#');
		expect(scanCall.input.ExpressionAttributeValues?.[':today']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('0 件のとき空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findActiveTrials } = await loadRepo();
		expect(await findActiveTrials()).toEqual([]);
	});

	it('#2842: LastEvaluatedKey で全ページを走査し Limit を付けない', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeItem({ id: 1 })],
				LastEvaluatedKey: { PK: 'cursor', SK: 'cursor' },
			})
			.mockResolvedValueOnce({ Items: [makeItem({ id: 2 })] });
		const { findActiveTrials } = await loadRepo();
		const rows = await findActiveTrials();
		expect(rows).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);

		const firstScan = mockSend.mock.calls[0]?.[0] as { input: { Limit?: number } };
		const secondScan = mockSend.mock.calls[1]?.[0] as {
			input: { ExclusiveStartKey?: Record<string, unknown>; Limit?: number };
		};
		expect(firstScan.input.Limit).toBeUndefined();
		expect(secondScan.input.ExclusiveStartKey).toEqual({ PK: 'cursor', SK: 'cursor' });
		expect(secondScan.input.Limit).toBeUndefined();
	});
});

// ============================================================
// updateConversion (Stripe 本契約移行、#2941 項目 1: tenant scope 直接 Update)
// ============================================================

describe('updateConversion', () => {
	it('tenantId + id から確定した PK/SK へ直接 Update する (Scan を発行しない)', async () => {
		mockSend.mockResolvedValueOnce({}); // UpdateCommand

		const { updateConversion } = await loadRepo();
		await updateConversion({
			id: 7,
			tenantId: TENANT,
			stripeSubscriptionId: 'sub_abc',
			upgradeReason: 'auto',
		});

		// #2941: 旧 scanKeyById (tenant 横断 Scan) は cross-tenant 上書きの余地があったため撤去。
		// send は UpdateCommand 1 回のみで、Key が tenant partition に固定されている。
		expect(mockSend).toHaveBeenCalledTimes(1);
		const updCall = mockSend.mock.calls[0]?.[0] as {
			input: {
				UpdateExpression?: string;
				ConditionExpression?: string;
				Key?: Record<string, unknown>;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(updCall).toBeInstanceOf(MockUpdateCommand);
		expect(updCall.input.Key?.PK).toBe(`T#${TENANT}#TRIAL`);
		expect(updCall.input.Key?.SK).toBe('HIST#00000007');
		expect(updCall.input.UpdateExpression).toContain('stripeSubscriptionId = :sub');
		expect(updCall.input.UpdateExpression).toContain('upgradeReason = :reason');
		expect(updCall.input.ExpressionAttributeValues?.[':sub']).toBe('sub_abc');
		expect(updCall.input.ExpressionAttributeValues?.[':reason']).toBe('auto');
		// 不在 key への upsert (item 新規作成) を防ぐ
		expect(updCall.input.ConditionExpression).toBe('attribute_exists(PK)');
	});

	it('該当 record 不在 (ConditionalCheckFailedException) は no-op で握りつぶす (SQLite 0 row UPDATE と等価)', async () => {
		const condErr = new Error('The conditional request failed');
		condErr.name = 'ConditionalCheckFailedException';
		mockSend.mockRejectedValueOnce(condErr);

		const { updateConversion } = await loadRepo();
		await expect(
			updateConversion({
				id: 99,
				tenantId: TENANT,
				stripeSubscriptionId: 'sub_x',
				upgradeReason: 'manual',
			}),
		).resolves.toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('ConditionalCheckFailedException 以外のエラーは rethrow する (silent skip 禁止)', async () => {
		const otherErr = new Error('ProvisionedThroughputExceededException');
		otherErr.name = 'ProvisionedThroughputExceededException';
		mockSend.mockRejectedValueOnce(otherErr);

		const { updateConversion } = await loadRepo();
		await expect(
			updateConversion({
				id: 1,
				tenantId: TENANT,
				stripeSubscriptionId: 'sub_y',
				upgradeReason: 'email_cta',
			}),
		).rejects.toThrow('ProvisionedThroughputExceededException');
	});

	it('#2941: 別 tenant を指定すると別 partition の Key になる (cross-tenant 上書き構造防止)', async () => {
		mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
		const { updateConversion } = await loadRepo();
		await updateConversion({
			id: 7,
			tenantId: 'tenant-A',
			stripeSubscriptionId: 'sub_a',
			upgradeReason: 'auto',
		});
		await updateConversion({
			id: 7,
			tenantId: 'tenant-B',
			stripeSubscriptionId: 'sub_b',
			upgradeReason: 'auto',
		});
		const first = mockSend.mock.calls[0]?.[0] as { input: { Key?: Record<string, unknown> } };
		const second = mockSend.mock.calls[1]?.[0] as { input: { Key?: Record<string, unknown> } };
		// 同一 id でも tenant が異なれば partition が分離され、互いの record に届かない
		expect(first.input.Key?.PK).toBe('T#tenant-A#TRIAL');
		expect(second.input.Key?.PK).toBe('T#tenant-B#TRIAL');
		expect(first.input.Key?.SK).toBe(second.input.Key?.SK);
	});
});

// ============================================================
// deleteByTenantId (退会時削除、ADR-0049)
// ============================================================

describe('deleteByTenantId', () => {
	it('tenant partition を exact PK Query して BatchWrite 削除する', async () => {
		// bulk-delete.deleteItemsByExactPk: Query (keys) → BatchWrite
		mockSend
			.mockResolvedValueOnce({
				Items: [
					{ PK: `T#${TENANT}#TRIAL`, SK: 'HIST#00000001' },
					{ PK: `T#${TENANT}#TRIAL`, SK: 'HIST#00000002' },
				],
			})
			.mockResolvedValueOnce({}); // BatchWrite

		const { deleteByTenantId } = await loadRepo();
		await deleteByTenantId(TENANT);

		const queryCall = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		expect(queryCall.input.KeyConditionExpression).toContain('PK = :pk');
		expect(queryCall.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#TRIAL`);
	});

	it('0 件のとき BatchWrite を呼ばない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { deleteByTenantId } = await loadRepo();
		await deleteByTenantId(TENANT);
		expect(mockSend).toHaveBeenCalledTimes(1); // Query のみ
	});
});

// ============================================================
// interface 適合 (SQLite との機能等価性 / stub 後退防止)
// ============================================================

describe('interface 適合 (ITrialHistoryRepo)', () => {
	it('全メソッドを export している (stub に後退していない)', async () => {
		const repo = await loadRepo();
		for (const m of [
			'findLatestByTenant',
			'findActiveTrials',
			'insert',
			'updateConversion',
			'deleteByTenantId',
		]) {
			expect(typeof (repo as Record<string, unknown>)[m]).toBe('function');
		}
	});

	it('insert が no-op stub でない (採番 + 実 send する)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insert } = await loadRepo();
		await insert({
			tenantId: TENANT,
			startDate: '2026-06-05',
			endDate: '2026-06-12',
			tier: 'standard',
			source: 'user_initiated',
		});
		// stub なら send 未呼出だった。本実装は採番 + Put で send する。
		expect(mockSend).toHaveBeenCalled();
	});

	it('findLatestByTenant が固定 undefined stub でない (Query 結果を返す)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeItem({ id: 5 })] });
		const { findLatestByTenant } = await loadRepo();
		const row = await findLatestByTenant(TENANT);
		// stub なら常に undefined だった。本実装は Query item を返す。
		expect(row?.id).toBe(5);
		expect(mockSend).toHaveBeenCalled();
	});
});
