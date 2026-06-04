/**
 * tests/unit/db/dynamodb-sibling-cheer-repo.test.ts
 *
 * #2267 / #2824 Wave 5B / ADR-0055: DynamoDB きょうだいおうえんスタンプ repo 本実装の単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/sibling-cheer-repo.ts、挙動 SSOT) と
 * 機能等価であることを method ごとに検証する:
 *   - 正しい Command + key で send する (受信 child partition への配置 / counter 採番)
 *   - response を正しく型変換する (stripKeys / shownAt null backfill)
 *   - SQLite 機能等価 (shownAt IS NULL filter / 本日送信数 count / markShown id 解決)
 *
 * 背景: 本 repo は #2263 hotfix (PR #2280) で read=空 / write=no-op 化され、おうえん送信が本番
 *   DynamoDB Lambda で永続しなかった (SiblingCheerOverlay が機能しない)。本テストは本実装の
 *   機能等価性を回帰固定する。
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
	return import('../../../src/lib/server/db/dynamodb/sibling-cheer-repo');
}

const TENANT = 'tenant-1';
const FROM_CHILD = 11;
const TO_CHILD = 22;

/** 受信 child partition の DynamoDB cheer item を組み立てる (PK/SK + 属性)。 */
function makeItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const id = (over.id as number) ?? 1;
	const toChildId = (over.toChildId as number) ?? TO_CHILD;
	return {
		PK: `T#${TENANT}#CHILD#${toChildId}`,
		SK: `CHEER#${String(id).padStart(8, '0')}`,
		id,
		fromChildId: FROM_CHILD,
		toChildId,
		stampCode: 'sugoi',
		tenantId: TENANT,
		sentAt: '2026-06-04T00:00:00.000Z',
		shownAt: null,
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
// insertCheer
// ============================================================

describe('insertCheer', () => {
	it('counter 採番 → 受信 child partition に PutItem し row を返す (永続の核心経路)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 101 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand

		const { insertCheer } = await loadRepo();
		const result = await insertCheer(
			{ fromChildId: FROM_CHILD, toChildId: TO_CHILD, stampCode: 'ganbare' },
			TENANT,
		);

		expect(result.id).toBe(101);
		expect(result).toMatchObject({
			fromChildId: FROM_CHILD,
			toChildId: TO_CHILD,
			stampCode: 'ganbare',
			tenantId: TENANT,
			shownAt: null,
		});
		expect(typeof result.sentAt).toBe('string');

		// PK は受信 child (toChildId) partition、SK は CHEER#<paddedId>
		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${TO_CHILD}`);
		expect(putCall.input.Item?.SK).toBe('CHEER#00000101');
		expect(putCall.input.Item?.fromChildId).toBe(FROM_CHILD);
		expect(putCall.input.Item?.stampCode).toBe('ganbare');
	});
});

// ============================================================
// findUnshownCheers
// ============================================================

describe('findUnshownCheers', () => {
	it('受信 child partition を Query し shownAt が null の item のみ返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, stampCode: 'unshown', shownAt: null }),
				makeItem({ id: 2, stampCode: 'shown', shownAt: '2026-06-04T01:00:00.000Z' }),
				makeItem({ id: 3, stampCode: 'unshown2', shownAt: null }),
			],
		});
		const { findUnshownCheers } = await loadRepo();
		const result = await findUnshownCheers(TO_CHILD, TENANT);
		expect(result.map((c) => c.stampCode)).toEqual(['unshown', 'unshown2']);

		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				ExpressionAttributeValues?: Record<string, string>;
			};
		};
		expect(callArg.input.KeyConditionExpression).toContain('PK = :pk');
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${TO_CHILD}`);
		expect(callArg.input.ExpressionAttributeValues?.[':prefix']).toBe('CHEER#');
	});

	it('全件 shown のとき空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1, shownAt: '2026-06-04T01:00:00.000Z' })],
		});
		const { findUnshownCheers } = await loadRepo();
		expect(await findUnshownCheers(TO_CHILD, TENANT)).toEqual([]);
	});

	it('0 件のとき空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findUnshownCheers } = await loadRepo();
		expect(await findUnshownCheers(TO_CHILD, TENANT)).toEqual([]);
	});

	it('LastEvaluatedKey でページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeItem({ id: 1, shownAt: null })],
				LastEvaluatedKey: { PK: 'c', SK: 'c' },
			})
			.mockResolvedValueOnce({ Items: [makeItem({ id: 2, shownAt: null })] });
		const { findUnshownCheers } = await loadRepo();
		const result = await findUnshownCheers(TO_CHILD, TENANT);
		expect(result).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('shownAt 欠落 item は未表示扱い (null backfill)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeItem({ id: 1, shownAt: undefined })] });
		const { findUnshownCheers } = await loadRepo();
		const result = await findUnshownCheers(TO_CHILD, TENANT);
		expect(result).toHaveLength(1);
		expect(result[0]?.shownAt).toBeNull();
	});
});

// ============================================================
// markShown
// ============================================================

describe('markShown', () => {
	it('id を Scan で解決し該当 item の shownAt を SET する', async () => {
		// 1) scanCheerKeysByIds Scan (id=7, id=9 が一致、id=8 は対象外)
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 7, shownAt: null }),
				makeItem({ id: 8, shownAt: null }),
				makeItem({ id: 9, shownAt: null }),
			],
		});
		// 2,3) UpdateCommand × 2 (id=7, id=9)
		mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});

		const { markShown } = await loadRepo();
		await markShown([7, 9], TENANT);

		// Scan 1 回 + Update 2 回
		expect(mockSend).toHaveBeenCalledTimes(3);

		const scanCall = mockSend.mock.calls[0]?.[0] as {
			input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(scanCall.input.FilterExpression).toContain('begins_with(SK, :skPrefix)');
		expect(scanCall.input.ExpressionAttributeValues?.[':skPrefix']).toBe('CHEER#');
		expect(scanCall.input.ExpressionAttributeValues?.[':tenantPrefix']).toBe(`T#${TENANT}#CHILD#`);

		const updCall = mockSend.mock.calls[1]?.[0] as {
			input: { UpdateExpression?: string; Key?: Record<string, unknown> };
		};
		expect(updCall.input.UpdateExpression).toContain('shownAt = :now');
		expect(updCall.input.Key?.SK).toBe('CHEER#00000007');
	});

	it('空配列のとき Scan も Update も呼ばない (早期 return)', async () => {
		const { markShown } = await loadRepo();
		await markShown([], TENANT);
		expect(mockSend).not.toHaveBeenCalled();
	});

	it('対象 id が存在しないとき Update を呼ばない', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeItem({ id: 1 })] }); // id=99 は不在
		const { markShown } = await loadRepo();
		await markShown([99], TENANT);
		expect(mockSend).toHaveBeenCalledTimes(1); // Scan のみ
	});

	// ----------------------------------------------------------
	// #2842 教訓: Scan の Limit は filter 前評価のため Limit を付けず全ページ走査する。
	//   対象 item が scan 順で先頭ページに無いケースを LastEvaluatedKey で再現する。
	// ----------------------------------------------------------
	it('#2842: 対象 item が先頭ページに無くても LastEvaluatedKey でページングして見つける', async () => {
		// 1) 1 ページ目: target 不在 + LastEvaluatedKey
		mockSend.mockResolvedValueOnce({
			Items: [makeItem({ id: 1 })],
			LastEvaluatedKey: { PK: 'cursor', SK: 'cursor' },
		});
		// 2) 2 ページ目: 目的の id=7 が見つかる
		mockSend.mockResolvedValueOnce({ Items: [makeItem({ id: 7, shownAt: null })] });
		// 3) UpdateCommand
		mockSend.mockResolvedValueOnce({});

		const { markShown } = await loadRepo();
		await markShown([7], TENANT);

		// Scan 2 回 + Update 1 回。2 回目の Scan に ExclusiveStartKey が渡り Limit は付かない。
		expect(mockSend).toHaveBeenCalledTimes(3);
		const secondScan = mockSend.mock.calls[1]?.[0] as {
			input: { ExclusiveStartKey?: Record<string, unknown>; Limit?: number };
		};
		expect(secondScan.input.ExclusiveStartKey).toEqual({ PK: 'cursor', SK: 'cursor' });
		expect(secondScan.input.Limit).toBeUndefined();
	});
});

// ============================================================
// countTodayCheersFrom
// ============================================================

describe('countTodayCheersFrom', () => {
	it('送信者 + 本日以降の sentAt filter で件数を返す (1 日上限チェック)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [{ id: 1 }, { id: 2 }, { id: 3 }],
		});
		const { countTodayCheersFrom } = await loadRepo();
		expect(await countTodayCheersFrom(FROM_CHILD, TENANT)).toBe(3);

		const scanCall = mockSend.mock.calls[0]?.[0] as {
			input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(scanCall.input.FilterExpression).toContain('fromChildId = :from');
		expect(scanCall.input.FilterExpression).toContain('sentAt >= :since');
		expect(scanCall.input.ExpressionAttributeValues?.[':from']).toBe(FROM_CHILD);
		expect(scanCall.input.ExpressionAttributeValues?.[':skPrefix']).toBe('CHEER#');
		// since は JST 当日 00:00:00 prefix (SQLite と同形式)
		expect(scanCall.input.ExpressionAttributeValues?.[':since']).toMatch(
			/^\d{4}-\d{2}-\d{2}T00:00:00$/,
		);
	});

	it('0 件のとき 0 を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { countTodayCheersFrom } = await loadRepo();
		expect(await countTodayCheersFrom(FROM_CHILD, TENANT)).toBe(0);
	});

	it('LastEvaluatedKey で全ページを合算する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [{ id: 1 }, { id: 2 }],
				LastEvaluatedKey: { PK: 'c', SK: 'c' },
			})
			.mockResolvedValueOnce({ Items: [{ id: 3 }] });
		const { countTodayCheersFrom } = await loadRepo();
		expect(await countTodayCheersFrom(FROM_CHILD, TENANT)).toBe(3);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});

// ============================================================
// deleteByTenantId
// ============================================================

describe('deleteByTenantId', () => {
	it('tenant 配下の CHEER# item を Scan して BatchWrite 削除する', async () => {
		// bulk-delete: Scan (keys) → BatchWrite
		mockSend.mockResolvedValueOnce({
			Items: [
				{ PK: `T#${TENANT}#CHILD#${TO_CHILD}`, SK: 'CHEER#00000001' },
				{ PK: `T#${TENANT}#CHILD#${TO_CHILD}`, SK: 'CHEER#00000002' },
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
		expect(scanCall.input.ExpressionAttributeValues?.[':skPrefix']).toBe('CHEER#');
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

describe('interface 適合 (ISiblingCheerRepo)', () => {
	it('全メソッドを export している (stub に後退していない)', async () => {
		const repo = await loadRepo();
		for (const m of [
			'insertCheer',
			'findUnshownCheers',
			'markShown',
			'countTodayCheersFrom',
			'deleteByTenantId',
		]) {
			expect(typeof (repo as Record<string, unknown>)[m]).toBe('function');
		}
	});

	it('write method が no-op stub でない (insertCheer が実 send し採番 row を返す)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insertCheer } = await loadRepo();
		const result = await insertCheer(
			{ fromChildId: FROM_CHILD, toChildId: TO_CHILD, stampCode: 'nice' },
			TENANT,
		);
		// stub なら id=0 / send 未呼出だった。本実装は採番 id を返し send する。
		expect(result.id).toBe(1);
		expect(mockSend).toHaveBeenCalled();
	});
});
