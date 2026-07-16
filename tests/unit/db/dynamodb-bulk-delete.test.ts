/**
 * tests/unit/db/dynamodb-bulk-delete.test.ts
 *
 * #3693: アカウント削除 / data 全削除の全テーブル Scan → tenant-scoped Query 化の regression test。
 *
 * 旧実装は deleteByTenantId 群 (約 25 呼び出し) の大半が `deleteItemsByPkPrefix` =
 * **テーブル全体 Scan (FilterExpression) + 逐次 BatchWrite** で、read 量が
 * 全テナント総量に比例して線形悪化し、退会 CUJ が Lambda 30s / API GW 504 に到達する
 * (restore 504 #3692 と同 class)。本テストは in-memory fake DynamoDB DocumentClient で
 * 以下を fitness 化する:
 *
 * - AC2: childIds が与えられた場合、child partition への Query のみで削除し Scan 0 回
 *        (read が対象 tenant のデータ量にのみ比例し、他 tenant 総量に依存しない)
 * - AC1 (proxy): 他 tenant のデータ量を増やしても Query 回数 = 児童数 × prefix 数で不変
 * - 件数保証: 対象 items のみ削除し、同 PK の他 SK / 他 tenant は不変 (tenant 境界)
 * - AC3: BatchWrite UnprocessedItems の retry で silent partial delete を残さない、
 *        途中失敗後の再実行 (冪等) で残存が完全に消える
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';

// --- AWS SDK mock (既存 dynamodb repo test と同パターン: vi.hoisted + command class) ---

const { mockSend, MockScanCommand, MockQueryCommand, MockBatchWriteCommand } = vi.hoisted(() => {
	const send = vi.fn();
	class Cmd {
		input: Record<string, unknown>;
		constructor(input: Record<string, unknown>) {
			this.input = input;
		}
	}
	return {
		mockSend: send,
		MockScanCommand: class extends Cmd {},
		MockQueryCommand: class extends Cmd {},
		MockBatchWriteCommand: class extends Cmd {},
	};
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
	DynamoDBClient: class {
		destroy() {}
	},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
	ScanCommand: MockScanCommand,
	QueryCommand: MockQueryCommand,
	BatchWriteCommand: MockBatchWriteCommand,
	// 他 repo が static import する command は本 test では未使用 (bulk-delete 経由のみ)
	GetCommand: class {},
	PutCommand: class {},
	DeleteCommand: class {},
	UpdateCommand: class {},
	TransactWriteCommand: class {},
}));

// --- in-memory fake table ---

type Item = { PK: string; SK: string };

let table: Item[] = [];
let counts = { scan: 0, query: 0, batchWrite: 0 };
let commandLog: string[] = [];
/** 次の BatchWrite を 1 回だけ reject させる (途中失敗 → 再実行の冪等検証用) */
let batchWriteRejectOnce = false;
/** 次の BatchWrite で前半 key を UnprocessedItems として 1 回だけ返す */
let unprocessedOnce = false;
/** Scan / Query の 1 ページあたり返却件数 (pagination 検証用) */
let pageSize = 1000;

function cmpKey(a: Item, b: Item): number {
	return a.PK === b.PK ? a.SK.localeCompare(b.SK) : a.PK.localeCompare(b.PK);
}

function paginate(matched: Item[], exclusiveStartKey?: Item) {
	const sorted = [...matched].sort(cmpKey);
	const after = exclusiveStartKey
		? sorted.filter((it) => cmpKey(it, exclusiveStartKey) > 0)
		: sorted;
	const page = after.slice(0, pageSize);
	const hasMore = after.length > pageSize;
	const last = page[page.length - 1];
	return {
		Items: page.map((it) => ({ PK: it.PK, SK: it.SK })),
		LastEvaluatedKey: hasMore && last ? { PK: last.PK, SK: last.SK } : undefined,
	};
}

function installFakeTable() {
	mockSend.mockImplementation(async (cmd: { input: Record<string, unknown> }) => {
		const input = cmd.input as {
			ExpressionAttributeValues?: Record<string, string>;
			ExclusiveStartKey?: Item;
			RequestItems?: Record<string, Array<{ DeleteRequest: { Key: Item } }>>;
		};
		if (cmd instanceof MockScanCommand) {
			counts.scan++;
			commandLog.push('scan');
			const v = input.ExpressionAttributeValues ?? {};
			const pkPrefix = v[':pkPrefix'];
			const skPrefix = v[':skPrefix'];
			const matched = table.filter(
				(it) =>
					(!pkPrefix || it.PK.startsWith(pkPrefix)) && (!skPrefix || it.SK.startsWith(skPrefix)),
			);
			return paginate(matched, input.ExclusiveStartKey);
		}
		if (cmd instanceof MockQueryCommand) {
			counts.query++;
			commandLog.push('query');
			const v = input.ExpressionAttributeValues ?? {};
			const pk = v[':pk'];
			const skPrefix = v[':skPrefix'];
			const matched = table.filter(
				(it) => it.PK === pk && (!skPrefix || it.SK.startsWith(skPrefix)),
			);
			return paginate(matched, input.ExclusiveStartKey);
		}
		if (cmd instanceof MockBatchWriteCommand) {
			counts.batchWrite++;
			commandLog.push('batchWrite');
			if (batchWriteRejectOnce) {
				batchWriteRejectOnce = false;
				throw new Error('simulated transient BatchWrite failure');
			}
			const entries = Object.entries(input.RequestItems ?? {});
			const [tableName, requests] = entries[0] ?? ['', []];
			let toProcess = requests;
			let unprocessed: typeof requests = [];
			if (unprocessedOnce && requests.length > 1) {
				unprocessedOnce = false;
				const half = Math.floor(requests.length / 2);
				unprocessed = requests.slice(0, half);
				toProcess = requests.slice(half);
			}
			const keys = toProcess.map((r) => r.DeleteRequest.Key);
			table = table.filter((it) => !keys.some((k) => k.PK === it.PK && k.SK === it.SK));
			return unprocessed.length > 0 ? { UnprocessedItems: { [tableName]: unprocessed } } : {};
		}
		throw new Error(`unexpected command: ${cmd.constructor.name}`);
	});
}

async function loadBulkDelete() {
	return import('../../../src/lib/server/db/dynamodb/bulk-delete');
}

const childPkOf = (tenantId: string, childId: number) => `T#${tenantId}#CHILD#${childId}`;

/** tenant 1 つ分の child-scoped データを seed する */
function seedTenant(tenantId: string, childIds: number[], skPrefixCounts: Record<string, number>) {
	for (const childId of childIds) {
		for (const [skPrefix, n] of Object.entries(skPrefixCounts)) {
			for (let i = 0; i < n; i++) {
				table.push({
					PK: childPkOf(tenantId, childId),
					SK: `${skPrefix}${String(i).padStart(4, '0')}`,
				});
			}
		}
	}
}

beforeEach(() => {
	mockSend.mockReset();
	table = [];
	counts = { scan: 0, query: 0, batchWrite: 0 };
	commandLog = [];
	batchWriteRejectOnce = false;
	unprocessedOnce = false;
	pageSize = 1000;
	installFakeTable();
});

// =========================================================
// deleteChildScopedItems — Scan → Query 化 (AC2)
// =========================================================

describe('deleteChildScopedItems (#3693 AC2: Scan → child partition Query)', () => {
	it('childIds 指定時は Scan 0 回で対象 prefix のみ削除し、他 tenant / 他 SK は不変', async () => {
		seedTenant('tenant-a', [1, 2], { 'STATUS#': 3, 'POINT#': 2 });
		seedTenant('tenant-b', [1], { 'STATUS#': 4 });

		const { deleteChildScopedItems } = await loadBulkDelete();
		const deleted = await deleteChildScopedItems(
			'tenant-a',
			[asChildId(1), asChildId(2)],
			'STATUS#',
		);

		// 件数保証: tenant-a の STATUS# 6 件のみ削除
		expect(deleted).toBe(6);
		expect(counts.scan).toBe(0);
		// tenant-a の POINT# は残る (SK 境界)
		expect(
			table.filter((it) => it.PK.startsWith('T#tenant-a#') && it.SK.startsWith('POINT#')),
		).toHaveLength(4);
		// tenant-b は完全に不変 (tenant 境界)
		expect(table.filter((it) => it.PK.startsWith('T#tenant-b#'))).toHaveLength(4);
		// tenant-a の STATUS# は 0
		expect(
			table.filter((it) => it.PK.startsWith('T#tenant-a#') && it.SK.startsWith('STATUS#')),
		).toHaveLength(0);
	});

	it('AC1 proxy: 他 tenant のデータ量が増えても read (Query) 回数は自 tenant の児童数のみに比例する', async () => {
		// 対象 tenant: 児童 2 人 × STATUS# 2 件
		seedTenant('tenant-a', [1, 2], { 'STATUS#': 2 });
		// 他 tenant 50 件 × 20 items (全テーブル Scan なら read 量がこれに比例してしまう)
		for (let t = 0; t < 50; t++) {
			seedTenant(`other-${t}`, [1], { 'STATUS#': 20 });
		}

		const { deleteChildScopedItems } = await loadBulkDelete();
		const deleted = await deleteChildScopedItems(
			'tenant-a',
			[asChildId(1), asChildId(2)],
			'STATUS#',
		);

		expect(deleted).toBe(4);
		expect(counts.scan).toBe(0);
		// Query は児童 1 人 1 ページ = 2 回 (他 tenant 総量に非依存)
		expect(counts.query).toBe(2);
		// 他 tenant は不変
		expect(table.filter((it) => it.PK.startsWith('T#other-'))).toHaveLength(50 * 20);
	});

	it('childIds undefined 時は従来の Scan fallback で同じ削除結果になる (完全性優先)', async () => {
		seedTenant('tenant-a', [1, 2], { 'STATUS#': 3 });
		seedTenant('tenant-b', [1], { 'STATUS#': 4 });

		const { deleteChildScopedItems } = await loadBulkDelete();
		const deleted = await deleteChildScopedItems('tenant-a', undefined, 'STATUS#');

		expect(deleted).toBe(6);
		expect(counts.scan).toBeGreaterThan(0);
		expect(table.filter((it) => it.PK.startsWith('T#tenant-a#'))).toHaveLength(0);
		expect(table.filter((it) => it.PK.startsWith('T#tenant-b#'))).toHaveLength(4);
	});
});

// =========================================================
// deleteItemsByExactPk — skPrefix 対応 + streaming
// =========================================================

describe('deleteItemsByExactPk', () => {
	it('skPrefix 指定時は同一 PK 内の別 SK を残す', async () => {
		table.push(
			{ PK: 'T#t1#SETTING', SK: 'A#1' },
			{ PK: 'T#t1#SETTING', SK: 'A#2' },
			{ PK: 'T#t1#SETTING', SK: 'B#1' },
		);
		const { deleteItemsByExactPk } = await loadBulkDelete();
		const deleted = await deleteItemsByExactPk('T#t1#SETTING', 'A#');
		expect(deleted).toBe(2);
		expect(table).toEqual([{ PK: 'T#t1#SETTING', SK: 'B#1' }]);
		expect(counts.scan).toBe(0);
	});

	it('複数ページでも page ごとに削除しながら全件消す (streaming)', async () => {
		pageSize = 2;
		table.push(
			{ PK: 'T#t1#SETTING', SK: 'A#1' },
			{ PK: 'T#t1#SETTING', SK: 'A#2' },
			{ PK: 'T#t1#SETTING', SK: 'A#3' },
			{ PK: 'T#t1#SETTING', SK: 'A#4' },
			{ PK: 'T#t1#SETTING', SK: 'A#5' },
		);
		const { deleteItemsByExactPk } = await loadBulkDelete();
		const deleted = await deleteItemsByExactPk('T#t1#SETTING');
		expect(deleted).toBe(5);
		expect(table).toHaveLength(0);
		// streaming: 2 ページ目の Query の前に 1 ページ目の BatchWrite が完了している
		const firstBatch = commandLog.indexOf('batchWrite');
		const secondQuery = commandLog.indexOf('query', commandLog.indexOf('query') + 1);
		expect(firstBatch).toBeGreaterThan(-1);
		expect(secondQuery).toBeGreaterThan(firstBatch);
	});
});

// =========================================================
// BatchWrite UnprocessedItems retry + 冪等再開 (AC3)
// =========================================================

describe('BatchWrite 完全性 (#3693 AC3)', () => {
	it('UnprocessedItems は retry され silent partial delete を残さない', async () => {
		seedTenant('tenant-a', [1], { 'STATUS#': 10 });
		unprocessedOnce = true;

		const { deleteChildScopedItems } = await loadBulkDelete();
		const deleted = await deleteChildScopedItems('tenant-a', [asChildId(1)], 'STATUS#');

		expect(deleted).toBe(10);
		expect(table).toHaveLength(0);
		// retry で BatchWrite が 2 回以上呼ばれている
		expect(counts.batchWrite).toBeGreaterThanOrEqual(2);
	});

	it('途中失敗は throw し (silent success 禁止)、再実行で残存が完全に消える (冪等再開)', async () => {
		seedTenant('tenant-a', [1, 2], { 'STATUS#': 3 });
		batchWriteRejectOnce = true;

		const { deleteChildScopedItems } = await loadBulkDelete();
		await expect(
			deleteChildScopedItems('tenant-a', [asChildId(1), asChildId(2)], 'STATUS#'),
		).rejects.toThrow('simulated transient BatchWrite failure');

		// 再実行 (冪等): 残存が全て消える
		const deletedOnRetry = await deleteChildScopedItems(
			'tenant-a',
			[asChildId(1), asChildId(2)],
			'STATUS#',
		);
		expect(deletedOnRetry).toBeGreaterThan(0);
		expect(table.filter((it) => it.SK.startsWith('STATUS#'))).toHaveLength(0);

		// 3 回目 (全消化後) は 0 件削除でエラーなく完了する
		const deletedThird = await deleteChildScopedItems(
			'tenant-a',
			[asChildId(1), asChildId(2)],
			'STATUS#',
		);
		expect(deletedThird).toBe(0);
	});
});

// =========================================================
// deleteOrphanChildPartitionItems — orphan child partition sweep (#3750)
// =========================================================

describe('deleteOrphanChildPartitionItems (#3750: orphan child partition sweep)', () => {
	it('childIds 非空 + orphan partition 混在時、per-child Query は orphan を取り漏らし、sweep が残骸のみ消す', async () => {
		const t = 'tenant-a';
		// 既知児童 1, 2 の scoped データ
		seedTenant(t, [1, 2], { 'STATUS#': 2, 'POINT#': 2 });
		// 既知児童の PROFILE (deleteAllChildrenData が後続で削除 + file 削除に必要なため sweep 対象外)
		table.push({ PK: childPkOf(t, 1), SK: 'PROFILE' }, { PK: childPkOf(t, 2), SK: 'PROFILE' });
		// orphan partition 99: 過去の部分失敗で profile なし・childId が active でも archived でもない
		// のに scoped データだけ残存 (childIds には含まれない)
		table.push(
			{ PK: childPkOf(t, 99), SK: 'STATUS#0000' },
			{ PK: childPkOf(t, 99), SK: 'POINT#0000' },
		);
		// 他 tenant の同名 orphan (tenant 境界の検証)
		seedTenant('tenant-b', [99], { 'STATUS#': 3 });

		const { deleteChildScopedItems, deleteOrphanChildPartitionItems } = await loadBulkDelete();

		// 1) 旧経路: 既知児童のみ per-child Query で削除 → orphan 99 は取り漏らす (#3750 の gap)
		await deleteChildScopedItems(t, [asChildId(1), asChildId(2)], 'STATUS#');
		await deleteChildScopedItems(t, [asChildId(1), asChildId(2)], 'POINT#');
		expect(table.filter((it) => it.PK === childPkOf(t, 99))).toHaveLength(2);

		// 2) 末尾 sweep: orphan 99 の残骸のみ削除
		const swept = await deleteOrphanChildPartitionItems(t, [asChildId(1), asChildId(2)]);
		expect(swept).toBe(2);
		expect(table.filter((it) => it.PK === childPkOf(t, 99))).toHaveLength(0);
		// 既知児童 PROFILE は残る (sweep が既知 partition を除外 = file 削除経路を壊さない)
		expect(table.filter((it) => it.PK === childPkOf(t, 1) && it.SK === 'PROFILE')).toHaveLength(1);
		expect(table.filter((it) => it.PK === childPkOf(t, 2) && it.SK === 'PROFILE')).toHaveLength(1);
		// 他 tenant は完全に不変 (tenant 境界)
		expect(table.filter((it) => it.PK.startsWith('T#tenant-b#'))).toHaveLength(3);
	});

	it('orphan がない場合 (既知児童のみ) は sweep で何も消さず 0 を返す', async () => {
		const t = 'tenant-a';
		seedTenant(t, [1, 2], { 'STATUS#': 2 });
		table.push({ PK: childPkOf(t, 1), SK: 'PROFILE' });

		const { deleteOrphanChildPartitionItems } = await loadBulkDelete();
		const swept = await deleteOrphanChildPartitionItems(t, [asChildId(1), asChildId(2)]);

		expect(swept).toBe(0);
		// 既知児童データは不変 (STATUS# 4 件 + PROFILE 1 件)
		expect(table.filter((it) => it.PK.startsWith('T#tenant-a#'))).toHaveLength(5);
	});

	it('knownChildIds が空配列でも child partition prefix 配下を全 sweep する (0 児童 orphan の受け皿)', async () => {
		const t = 'tenant-a';
		// 全て orphan (既知児童 0 人 = knownPKs 空)
		table.push(
			{ PK: childPkOf(t, 77), SK: 'STATUS#0000' },
			{ PK: childPkOf(t, 88), SK: 'POINT#0000' },
		);

		const { deleteOrphanChildPartitionItems } = await loadBulkDelete();
		const swept = await deleteOrphanChildPartitionItems(t, []);

		expect(swept).toBe(2);
		expect(table.filter((it) => it.PK.startsWith('T#tenant-a#CHILD#'))).toHaveLength(0);
	});
});

// =========================================================
// repo 配線 (代表: status-repo) — childIds 受領時に Query 化される
// =========================================================

describe('status-repo.deleteByTenantId 配線 (#3693)', () => {
	it('childIds 指定時に STATUS# + STATHIST# を Scan 0 回で削除する', async () => {
		const t = 'tenant-a';
		table.push(
			{ PK: childPkOf(t, 1), SK: 'STATUS#exercise' },
			{ PK: childPkOf(t, 1), SK: 'STATHIST#2026-07-01' },
			{ PK: childPkOf(t, 1), SK: 'POINT#0001' },
			{ PK: childPkOf(t, 2), SK: 'STATUS#study' },
		);
		const statusRepo = await import('../../../src/lib/server/db/dynamodb/status-repo');
		await statusRepo.deleteByTenantId(t, [asChildId(1), asChildId(2)]);

		expect(counts.scan).toBe(0);
		expect(table.filter((it) => it.SK.startsWith('STATUS#'))).toHaveLength(0);
		expect(table.filter((it) => it.SK.startsWith('STATHIST#'))).toHaveLength(0);
		// 別 prefix (POINT#) は残る
		expect(table.filter((it) => it.SK.startsWith('POINT#'))).toHaveLength(1);
	});

	it('childIds なし (従来呼び出し) では Scan fallback で削除される (後方互換)', async () => {
		const t = 'tenant-a';
		table.push({ PK: childPkOf(t, 1), SK: 'STATUS#exercise' });
		const statusRepo = await import('../../../src/lib/server/db/dynamodb/status-repo');
		await statusRepo.deleteByTenantId(t);

		expect(counts.scan).toBeGreaterThan(0);
		expect(table.filter((it) => it.SK.startsWith('STATUS#'))).toHaveLength(0);
	});
});
