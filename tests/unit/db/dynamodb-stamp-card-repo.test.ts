/**
 * tests/unit/db/dynamodb-stamp-card-repo.test.ts
 *
 * #2824 Wave 3B / ADR-0055: DynamoDB stamp-card-repo 本実装の単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/stamp-card-repo.ts、
 * 挙動 SSOT) と機能等価であることを method ごとに検証する:
 *   - 正しい Command + key で send する (child partition card / 専用 partition entry)
 *   - response を正しく型変換する (stripKeys / master JOIN / null 既定補完)
 *   - SQLite 機能等価 (findCardByChildAndWeek GetItem / insertCard default / entry の
 *     onConflictDoNothing / updateCardStatusIfCollecting の冪等ガード / deleteByTenantId 2 経路)
 *
 * 背景: 本 repo は #2263 hotfix (PR #2280) で read=空 / write=no-op 化され、子供 home の
 *   自動押印 (?/loginStamp) によるスタンプ獲得・週末 redeem が本番 DynamoDB Lambda で永続せず、
 *   週跨ぎで履歴が消失する状態だった。本テストは本実装の機能等価性を回帰固定する。
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
	// bulk-delete.ts が import する Command。deleteByTenantId 経路で使用。
	BatchWriteCommand: class {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	},
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/stamp-card-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;
const WEEK_START = '2026-06-01';
const WEEK_END = '2026-06-07';
const CARD_ID = 7;

/** child partition の stamp_card DynamoDB item を組み立てる。 */
function makeCardItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const id = (over.id as number) ?? CARD_ID;
	const weekStart = (over.weekStart as string) ?? WEEK_START;
	return {
		PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
		SK: `STMPCARD#${weekStart}`,
		id,
		childId: CHILD_ID,
		weekStart,
		weekEnd: WEEK_END,
		status: 'collecting',
		redeemedPoints: null,
		redeemedAt: null,
		createdAt: '2026-06-01T00:00:00.000Z',
		updatedAt: '2026-06-01T00:00:00.000Z',
		...over,
	};
}

/** card partition の stamp_entry DynamoDB item を組み立てる。 */
function makeEntryItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const slot = (over.slot as number) ?? 1;
	return {
		PK: `T#${TENANT}#STMPCARD#${CARD_ID}`,
		SK: `STMPENT#${String(slot).padStart(8, '0')}`,
		cardId: CARD_ID,
		stampMasterId: 1,
		omikujiRank: '大吉',
		slot,
		loginDate: '2026-06-01',
		earnedAt: '2026-06-01T09:00:00.000Z',
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
// findEnabledStampMasters
// ============================================================

describe('findEnabledStampMasters', () => {
	it('DEFAULT_STAMP_MASTERS_DATA SSOT 16 件を DB アクセスなしで返す', async () => {
		const { findEnabledStampMasters } = await loadRepo();
		const stamps = await findEnabledStampMasters(TENANT);
		expect(stamps).toHaveLength(16);
		expect(stamps.every((s) => s.isEnabled === 1)).toBe(true);
		expect(stamps.every((s) => ['N', 'R', 'SR', 'UR'].includes(s.rarity))).toBe(true);
		// DB を叩かない (空配列 → service の NO_STAMPS_AVAILABLE 回避)。
		expect(mockSend).not.toHaveBeenCalled();
	});
});

// ============================================================
// findCardByChildAndWeek
// ============================================================

describe('findCardByChildAndWeek', () => {
	it('child + weekStart key で GetItem する', async () => {
		mockSend.mockResolvedValueOnce({ Item: makeCardItem() });
		const { findCardByChildAndWeek } = await loadRepo();
		const card = await findCardByChildAndWeek(CHILD_ID, WEEK_START, TENANT);
		expect(card?.id).toBe(CARD_ID);
		expect(card?.weekStart).toBe(WEEK_START);
		const callArg = mockSend.mock.calls[0]?.[0] as { input: { Key?: { PK: string; SK: string } } };
		expect(callArg.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(callArg.input.Key?.SK).toBe(`STMPCARD#${WEEK_START}`);
	});

	it('不在のとき undefined を返す', async () => {
		mockSend.mockResolvedValueOnce({ Item: undefined });
		const { findCardByChildAndWeek } = await loadRepo();
		expect(await findCardByChildAndWeek(CHILD_ID, WEEK_START, TENANT)).toBeUndefined();
	});

	it('redeemedPoints / redeemedAt 欠落 item を null に補完する', async () => {
		const item = makeCardItem({ status: 'redeemed' });
		delete item.redeemedPoints;
		delete item.redeemedAt;
		mockSend.mockResolvedValueOnce({ Item: item });
		const { findCardByChildAndWeek } = await loadRepo();
		const card = await findCardByChildAndWeek(CHILD_ID, WEEK_START, TENANT);
		expect(card?.redeemedPoints).toBeNull();
		expect(card?.redeemedAt).toBeNull();
	});
});

// ============================================================
// insertCard
// ============================================================

describe('insertCard', () => {
	it('counter 採番 → PutItem し SQLite default 値を埋めた card を返す', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 101 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand

		const { insertCard } = await loadRepo();
		const card = await insertCard(
			{ childId: CHILD_ID, weekStart: WEEK_START, weekEnd: WEEK_END },
			TENANT,
		);

		expect(card.id).toBe(101);
		expect(card).toMatchObject({
			childId: CHILD_ID,
			weekStart: WEEK_START,
			weekEnd: WEEK_END,
			status: 'collecting', // schema default
			redeemedPoints: null,
			redeemedAt: null,
		});

		const putCall = mockSend.mock.calls[1]?.[0] as { input: { Item?: Record<string, unknown> } };
		expect(putCall.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(putCall.input.Item?.SK).toBe(`STMPCARD#${WEEK_START}`);
		expect(putCall.input.Item?.status).toBe('collecting');
	});

	it('status 指定を反映する', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 5 } }).mockResolvedValueOnce({});
		const { insertCard } = await loadRepo();
		const card = await insertCard(
			{ childId: CHILD_ID, weekStart: WEEK_START, weekEnd: WEEK_END, status: 'redeemable' },
			TENANT,
		);
		expect(card.status).toBe('redeemable');
	});
});

// ============================================================
// findEntriesWithMasterByCardId
// ============================================================

describe('findEntriesWithMasterByCardId', () => {
	it('card partition を Query し master JOIN 付きで slot 昇順に返す', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeEntryItem({ slot: 2, stampMasterId: 6 }), // R ロケット
				makeEntryItem({ slot: 1, stampMasterId: 1 }), // N にこにこ
			],
		});
		const { findEntriesWithMasterByCardId } = await loadRepo();
		const entries = await findEntriesWithMasterByCardId(CARD_ID, TENANT);

		expect(entries.map((e) => e.slot)).toEqual([1, 2]);
		// master JOIN 解決 (getDefaultStampMasters SSOT)。
		expect(entries[0]?.name).toBe('にこにこ');
		expect(entries[0]?.emoji).toBe('😊');
		expect(entries[0]?.rarity).toBe('N');
		expect(entries[1]?.name).toBe('ロケット');
		expect(entries[1]?.rarity).toBe('R');

		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, string> };
		};
		expect(callArg.input.ExpressionAttributeValues?.[':pk']).toBe(
			`T#${TENANT}#STMPCARD#${CARD_ID}`,
		);
		expect(callArg.input.ExpressionAttributeValues?.[':prefix']).toBe('STMPENT#');
	});

	it('stampMasterId が不在 (LEFT JOIN miss) のとき name/emoji/rarity は null', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [makeEntryItem({ slot: 1, stampMasterId: null })],
		});
		const { findEntriesWithMasterByCardId } = await loadRepo();
		const entries = await findEntriesWithMasterByCardId(CARD_ID, TENANT);
		expect(entries[0]?.stampMasterId).toBeNull();
		expect(entries[0]?.name).toBeNull();
		expect(entries[0]?.emoji).toBeNull();
		expect(entries[0]?.rarity).toBeNull();
		// omikujiRank は保持される。
		expect(entries[0]?.omikujiRank).toBe('大吉');
	});

	it('LastEvaluatedKey でページングする', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeEntryItem({ slot: 1 })],
				LastEvaluatedKey: { PK: 'c', SK: 'c' },
			})
			.mockResolvedValueOnce({ Items: [makeEntryItem({ slot: 2 })] });
		const { findEntriesWithMasterByCardId } = await loadRepo();
		const entries = await findEntriesWithMasterByCardId(CARD_ID, TENANT);
		expect(entries).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});

	it('0 件のときは空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findEntriesWithMasterByCardId } = await loadRepo();
		expect(await findEntriesWithMasterByCardId(CARD_ID, TENANT)).toEqual([]);
	});
});

// ============================================================
// insertEntry
// ============================================================

describe('insertEntry', () => {
	it('card partition に PutItem し attribute_not_exists で slot 重複ガードする', async () => {
		mockSend.mockResolvedValueOnce({});
		const { insertEntry } = await loadRepo();
		await insertEntry(
			{ cardId: CARD_ID, stampMasterId: 3, omikujiRank: '中吉', slot: 2, loginDate: '2026-06-02' },
			TENANT,
		);
		const callArg = mockSend.mock.calls[0]?.[0] as {
			input: { Item?: Record<string, unknown>; ConditionExpression?: string };
		};
		expect(callArg.input.Item?.PK).toBe(`T#${TENANT}#STMPCARD#${CARD_ID}`);
		expect(callArg.input.Item?.SK).toBe('STMPENT#00000002');
		expect(callArg.input.Item?.stampMasterId).toBe(3);
		expect(callArg.input.ConditionExpression).toBe('attribute_not_exists(PK)');
	});

	it('slot 重複 (ConditionalCheckFailed) は no-op で握りつぶす (onConflictDoNothing)', async () => {
		const err = new Error('cond');
		err.name = 'ConditionalCheckFailedException';
		mockSend.mockRejectedValueOnce(err);
		const { insertEntry } = await loadRepo();
		await expect(
			insertEntry(
				{ cardId: CARD_ID, stampMasterId: 1, omikujiRank: null, slot: 1, loginDate: '2026-06-01' },
				TENANT,
			),
		).resolves.toBeUndefined();
	});

	it('ConditionalCheckFailed 以外の error は rethrow する', async () => {
		mockSend.mockRejectedValueOnce(new Error('throughput exceeded'));
		const { insertEntry } = await loadRepo();
		await expect(
			insertEntry(
				{ cardId: CARD_ID, stampMasterId: 1, omikujiRank: null, slot: 1, loginDate: '2026-06-01' },
				TENANT,
			),
		).rejects.toThrow('throughput exceeded');
	});
});

// ============================================================
// updateCardStatus
// ============================================================

describe('updateCardStatus (#2845 課題①: full composite-key addressing)', () => {
	it('childId + cardId で child partition Query → PK/SK 解決し status / redeem 系を更新する', async () => {
		// 1) findCardItemByChildAndId Query (child partition)
		mockSend.mockResolvedValueOnce({
			Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: `STMPCARD#${WEEK_START}` }],
		});
		// 2) UpdateCommand
		mockSend.mockResolvedValueOnce({});

		const { updateCardStatus } = await loadRepo();
		await updateCardStatus(
			CHILD_ID,
			CARD_ID,
			{
				status: 'redeemed',
				redeemedPoints: 60,
				redeemedAt: '2026-06-07T00:00:00Z',
				updatedAt: '2026-06-07T00:00:00Z',
			},
			TENANT,
		);

		expect(mockSend).toHaveBeenCalledTimes(2);
		const query = mockSend.mock.calls[0]?.[0] as {
			input: {
				KeyConditionExpression?: string;
				FilterExpression?: string;
				ExpressionAttributeValues?: Record<string, unknown>;
			};
		};
		// tenant + child 境界が KeyCondition (Query) で構造的に担保される (旧 tenant Scan 撤去)
		expect(query.input.KeyConditionExpression).toContain('PK = :pk');
		expect(query.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(query.input.FilterExpression).toContain('id = :id');
		expect(query.input.ExpressionAttributeValues?.[':id']).toBe(CARD_ID);
		const upd = mockSend.mock.calls[1]?.[0] as {
			input: { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(upd.input.UpdateExpression).toContain('#status = :status');
		expect(upd.input.ExpressionAttributeValues?.[':rp']).toBe(60);
	});

	it('card が見つからない (childId 不一致含む) とき Update せず no-op', async () => {
		// 全ページ走査 (LastEvaluatedKey 無し) して 1 件も一致しない → undefined → no-op。
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { updateCardStatus } = await loadRepo();
		await updateCardStatus(
			CHILD_ID,
			CARD_ID,
			{ status: 'redeemed', redeemedPoints: 10, redeemedAt: 't', updatedAt: 't' },
			TENANT,
		);
		// Query のみ、Update 0 件。
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('対象 card が 2 ページ目に来る Query でも見つけて Update する (#2842 Limit:1+Filter 誤用回帰)', async () => {
		// DynamoDB の Limit は filter 適用「前」の評価上限。Limit:1 + Filter は
		// 1 ページ目に対象が無いと空振りして silent no-op → redeem が黙って失敗する。
		// 本テストは「1 ページ目 = 非一致 (filter 落ち) で空 Items + LastEvaluatedKey、
		// 2 ページ目 = 対象 card」を emulate し、pagination で必ず到達することを固定する。
		mockSend
			// 1) findCardItemByChildAndId Query page 1: filter で全部落ちて Items 空 + 続きあり
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p1', SK: 'p1' } })
			// 2) findCardItemByChildAndId Query page 2: 対象 card がここで一致
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: `STMPCARD#${WEEK_START}` }],
			})
			// 3) UpdateCommand
			.mockResolvedValueOnce({});

		const { updateCardStatus } = await loadRepo();
		await updateCardStatus(
			CHILD_ID,
			CARD_ID,
			{
				status: 'redeemed',
				redeemedPoints: 60,
				redeemedAt: '2026-06-07T00:00:00Z',
				updatedAt: '2026-06-07T00:00:00Z',
			},
			TENANT,
		);

		// Query 2 ページ + Update 1 回 = 3 send。Update に正しい PK/SK が渡る。
		expect(mockSend).toHaveBeenCalledTimes(3);
		const page1 = mockSend.mock.calls[0]?.[0] as { input: { ExclusiveStartKey?: unknown } };
		const page2 = mockSend.mock.calls[1]?.[0] as { input: { ExclusiveStartKey?: unknown } };
		// Limit:1 実装は 1 ページ目しか引かず、ExclusiveStartKey も渡さない (空振り = #2842)。
		expect(page1.input.ExclusiveStartKey).toBeUndefined();
		expect(page2.input.ExclusiveStartKey).toEqual({ PK: 'p1', SK: 'p1' });
		const upd = mockSend.mock.calls[2]?.[0] as { input: { Key?: { PK: string; SK: string } } };
		expect(upd.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(upd.input.Key?.SK).toBe(`STMPCARD#${WEEK_START}`);
	});

	it('Query に Limit を付けない (filter 前評価上限による空振り防止、#2842)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: `STMPCARD#${WEEK_START}` }],
		});
		mockSend.mockResolvedValueOnce({});
		const { updateCardStatus } = await loadRepo();
		await updateCardStatus(
			CHILD_ID,
			CARD_ID,
			{ status: 'redeemed', redeemedPoints: 60, redeemedAt: 't', updatedAt: 't' },
			TENANT,
		);
		const query = mockSend.mock.calls[0]?.[0] as { input: { Limit?: number } };
		expect(query.input.Limit).toBeUndefined();
	});
});

// ============================================================
// updateCardStatusIfCollecting
// ============================================================

describe('updateCardStatusIfCollecting (#2845 課題①: full composite-key addressing)', () => {
	it('collecting の card を更新し 1 を返す (ConditionExpression 付き)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: `STMPCARD#${WEEK_START}` }],
		});
		mockSend.mockResolvedValueOnce({});
		const { updateCardStatusIfCollecting } = await loadRepo();
		const affected = await updateCardStatusIfCollecting(
			CHILD_ID,
			CARD_ID,
			{ status: 'redeemed', redeemedPoints: 50, redeemedAt: 't', updatedAt: 't' },
			TENANT,
		);
		expect(affected).toBe(1);
		const upd = mockSend.mock.calls[1]?.[0] as { input: { ConditionExpression?: string } };
		expect(upd.input.ConditionExpression).toBe('#status = :collecting');
	});

	it('既に collecting でない (ConditionalCheckFailed) とき 0 を返す (冪等ガード)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: `STMPCARD#${WEEK_START}` }],
		});
		const err = new Error('cond');
		err.name = 'ConditionalCheckFailedException';
		mockSend.mockRejectedValueOnce(err);
		const { updateCardStatusIfCollecting } = await loadRepo();
		const affected = await updateCardStatusIfCollecting(
			CHILD_ID,
			CARD_ID,
			{ status: 'redeemed', redeemedPoints: 50, redeemedAt: 't', updatedAt: 't' },
			TENANT,
		);
		expect(affected).toBe(0);
	});

	it('card 不在 (childId 不一致含む) のとき 0 を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { updateCardStatusIfCollecting } = await loadRepo();
		expect(
			await updateCardStatusIfCollecting(
				CHILD_ID,
				CARD_ID,
				{ status: 'redeemed', redeemedPoints: 50, redeemedAt: 't', updatedAt: 't' },
				TENANT,
			),
		).toBe(0);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('対象 card が 2 ページ目に来る Query でも見つけて 1 を返す (#2842 回帰)', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p1', SK: 'p1' } })
			.mockResolvedValueOnce({
				Items: [{ PK: `T#${TENANT}#CHILD#${CHILD_ID}`, SK: `STMPCARD#${WEEK_START}` }],
			})
			.mockResolvedValueOnce({});
		const { updateCardStatusIfCollecting } = await loadRepo();
		const affected = await updateCardStatusIfCollecting(
			CHILD_ID,
			CARD_ID,
			{ status: 'redeemed', redeemedPoints: 50, redeemedAt: 't', updatedAt: 't' },
			TENANT,
		);
		expect(affected).toBe(1);
		expect(mockSend).toHaveBeenCalledTimes(3);
	});
});

// ============================================================
// deleteByTenantId
// ============================================================

describe('deleteByTenantId', () => {
	it('cards (CHILD# 配下) と entries (STMPCARD# 配下) の 2 経路を Scan + 削除する', async () => {
		// deleteItemsByPkPrefix は内部で Scan → BatchWrite。各経路 1 回 Scan (0 件返す)。
		mockSend.mockResolvedValue({ Items: [] });
		const { deleteByTenantId } = await loadRepo();
		await deleteByTenantId(TENANT);
		// 2 経路分の Scan が走る (cards prefix / entries prefix)。
		expect(mockSend).toHaveBeenCalledTimes(2);
		const scan1 = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		const scan2 = mockSend.mock.calls[1]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		const pkPrefixes = [
			scan1.input.ExpressionAttributeValues?.[':pkPrefix'],
			scan2.input.ExpressionAttributeValues?.[':pkPrefix'],
		];
		expect(pkPrefixes).toContain(`T#${TENANT}#CHILD#`);
		expect(pkPrefixes).toContain(`T#${TENANT}#STMPCARD#`);
	});
});

// ============================================================
// interface 適合 (SQLite との機能等価性)
// ============================================================

describe('interface 適合 (IStampCardRepo)', () => {
	it('全メソッドを export している (stub に後退していない)', async () => {
		const repo = await loadRepo();
		for (const m of [
			'findEnabledStampMasters',
			'findCardByChildAndWeek',
			'insertCard',
			'findEntriesWithMasterByCardId',
			'insertEntry',
			'updateCardStatus',
			'updateCardStatusIfCollecting',
			'deleteByTenantId',
		]) {
			expect(typeof (repo as Record<string, unknown>)[m]).toBe('function');
		}
	});

	it('write method が no-op stub でない (insertCard が実 send する)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { insertCard } = await loadRepo();
		const card = await insertCard(
			{ childId: CHILD_ID, weekStart: WEEK_START, weekEnd: WEEK_END },
			TENANT,
		);
		// stub なら id=0 を返していた。本実装は counter 値を返す。
		expect(card.id).toBe(1);
		expect(mockSend).toHaveBeenCalled();
	});
});
