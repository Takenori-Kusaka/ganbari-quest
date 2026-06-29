/**
 * tests/unit/db/dynamodb-child-repo-reset.test.ts
 *
 * #3152 / #3177 (route-db-boundary fitness の follow-up data-integrity fix):
 *   DynamoDB child-repo の `resetChildProgressData` が POINT# 行だけでなく
 *   派生集計 (SK=BALANCE) も削除し、reset 後の `getBalance` が 0 に揃うことを検証する。
 *
 * 背景 (bug): DynamoDB では「使用可能残高」を `pointBalanceKey(childId)` (SK=BALANCE) という
 *   別アイテムに保持し、`insertPointEntry` が `ADD #balance` で増分維持する。`getBalance` は
 *   その集計アイテムを**直接 Get** して返す (POINT# 行を sum しない)。よって reset で POINT#
 *   行のみ消して BALANCE を残すと、`getBalance` が reset 前の残高を返し続ける phantom
 *   spendable point が発生し、行集計で 0 を返す SQLite backend と乖離する。
 *   修正は `resetChildProgressData` で `pointBalanceKey` も削除集合に含めること。
 *
 * harness: AWS SDK lib-dynamodb を vi.hoisted mock で置換し、PK|SK キーの
 *   **stateful な in-memory store** で Put / Update(ADD #balance) / Query(begins_with) /
 *   Get / BatchWrite(Delete) / counter(ReturnValues) を実演する。これにより
 *   insertPointEntry → resetChildProgressData → getBalance を実 round-trip で検証する
 *   (mockResolvedValueOnce 列挙ではなく実データ整合)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend, store, resetStore } = vi.hoisted(() => {
	type Item = Record<string, unknown>;
	type In = Record<string, unknown>;
	const map = new Map<string, Item>();
	const keyOf = (k: { PK: unknown; SK: unknown }) => `${String(k.PK)}|${String(k.SK)}`;

	const handlePut = (input: In) => {
		const item = input.Item as Item;
		map.set(keyOf(item as { PK: unknown; SK: unknown }), { ...item });
		return {};
	};

	// "ADD #balance :amount" (集計加算) / "ADD #counter :val" (採番) を実演する。
	const handleUpdate = (input: In) => {
		const key = input.Key as { PK: unknown; SK: unknown };
		const id = keyOf(key);
		const existing = map.get(id) ?? { ...key };
		const expr = String(input.UpdateExpression ?? '');
		const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
		const values = (input.ExpressionAttributeValues ?? {}) as Record<string, number>;
		const m = expr.startsWith('ADD ') ? expr.match(/ADD\s+(\S+)\s+(\S+)/) : null;
		if (m) {
			const nameRef = m[1] ?? '';
			const valueRef = m[2] ?? '';
			const attr = names[nameRef] ?? nameRef;
			existing[attr] = ((existing[attr] as number) ?? 0) + (values[valueRef] ?? 0);
		}
		map.set(id, existing);
		return { Attributes: { ...existing } };
	};

	const handleGet = (input: In) => {
		const item = map.get(keyOf(input.Key as { PK: unknown; SK: unknown }));
		return item ? { Item: { ...item } } : {};
	};

	const handleQuery = (input: In) => {
		const values = (input.ExpressionAttributeValues ?? {}) as Record<string, string>;
		const pk = values[':pk'];
		const prefix = values[':prefix'];
		const items = [...map.values()].filter(
			(item) =>
				String(item.PK) === pk && (prefix === undefined || String(item.SK).startsWith(prefix)),
		);
		return { Items: items.map((i) => ({ ...i })) };
	};

	const handleBatchWrite = (input: In) => {
		const requestItems = input.RequestItems as Record<
			string,
			Array<{ DeleteRequest?: { Key: { PK: unknown; SK: unknown } } }>
		>;
		for (const requests of Object.values(requestItems)) {
			for (const req of requests) {
				if (req.DeleteRequest) map.delete(keyOf(req.DeleteRequest.Key));
			}
		}
		return {};
	};

	const handlers: Record<string, (input: In) => unknown> = {
		Put: handlePut,
		Update: handleUpdate,
		Get: handleGet,
		Query: handleQuery,
		BatchWrite: handleBatchWrite,
	};

	const send = vi.fn(async (cmd: { __type: string; input: In }) =>
		(handlers[cmd.__type] ?? (() => ({})))(cmd.input),
	);

	return { mockSend: send, store: map, resetStore: () => map.clear() };
});

function tagged(type: string) {
	return class {
		__type = type;
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	};
}

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
	GetCommand: tagged('Get'),
	PutCommand: tagged('Put'),
	QueryCommand: tagged('Query'),
	UpdateCommand: tagged('Update'),
	BatchWriteCommand: tagged('BatchWrite'),
	DeleteCommand: tagged('Delete'),
	ScanCommand: tagged('Scan'),
}));

const TENANT = 'tenant-reset';
const CHILD_ID = 77;

async function loadPointRepo() {
	return import('../../../src/lib/server/db/dynamodb/point-repo');
}
async function loadChildRepo() {
	return import('../../../src/lib/server/db/dynamodb/child-repo');
}

beforeEach(() => {
	resetStore();
	mockSend.mockClear();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('resetChildProgressData (DynamoDB) — BALANCE 集計も削除する (#3177)', () => {
	it('reset 後に getBalance が 0 を返し、POINT# 行も消える', async () => {
		const point = await loadPointRepo();

		// seed: 2 件のポイント付与 → BALANCE = 30 が集計アイテムに維持される
		await point.insertPointEntry(
			{ childId: CHILD_ID, amount: 10, type: 'earn', description: 'a' },
			TENANT,
		);
		await point.insertPointEntry(
			{ childId: CHILD_ID, amount: 20, type: 'earn', description: 'b' },
			TENANT,
		);

		// 前提: getBalance は集計アイテムを直接読み 30 を返す / POINT# 行が 2 件存在する
		expect(await point.getBalance(CHILD_ID, TENANT)).toBe(30);
		const pointRowsBefore = [...store.values()].filter(
			(i) => String(i.PK).endsWith(`CHILD#${CHILD_ID}`) && String(i.SK).startsWith('POINT#'),
		);
		expect(pointRowsBefore).toHaveLength(2);
		// BALANCE 集計アイテムが存在する
		expect(
			[...store.values()].some(
				(i) => String(i.PK).endsWith(`CHILD#${CHILD_ID}`) && i.SK === 'BALANCE',
			),
		).toBe(true);

		// act: 進捗 reset
		const child = await loadChildRepo();
		await child.resetChildProgressData(CHILD_ID, TENANT);

		// assert: 残高は 0 (BALANCE 集計が消えたため)。SQLite (行集計) と一致。
		expect(await point.getBalance(CHILD_ID, TENANT)).toBe(0);

		// assert: POINT# 行も全て消えている
		const pointRowsAfter = [...store.values()].filter(
			(i) => String(i.PK).endsWith(`CHILD#${CHILD_ID}`) && String(i.SK).startsWith('POINT#'),
		);
		expect(pointRowsAfter).toHaveLength(0);

		// assert: BALANCE 集計アイテム自体が削除されている (phantom spendable 残らない)
		expect(
			[...store.values()].some(
				(i) => String(i.PK).endsWith(`CHILD#${CHILD_ID}`) && i.SK === 'BALANCE',
			),
		).toBe(false);
	});

	it('#3184 item2: deletedCounts を返す (POINT# 行数 + BALANCE 集計を診断用に集計)', async () => {
		const point = await loadPointRepo();
		await point.insertPointEntry(
			{ childId: CHILD_ID, amount: 10, type: 'earn', description: 'a' },
			TENANT,
		);
		await point.insertPointEntry(
			{ childId: CHILD_ID, amount: 20, type: 'earn', description: 'b' },
			TENANT,
		);

		const child = await loadChildRepo();
		const counts = await child.resetChildProgressData(CHILD_ID, TENANT);

		// POINT# 2 行 + BALANCE 集計 1 を削除したことが診断値に反映される
		expect(counts.pointLedger).toBe(2);
		expect(counts.pointBalance).toBe(1);
		expect(counts.activityLogs).toBe(0);
		expect(counts.loginBonuses).toBe(0);
		expect(counts.childAchievements).toBe(0);
	});

	it('#3184 item1: deletedCounts の key 集合が cross-backend 契約 (ChildProgressResetCounts) と一致する', async () => {
		// 両 backend (sqlite / dynamodb) は同一 entity allowlist を reset する契約。返り値の key 集合を
		// canonical な ChildProgressResetCounts と一致させることで「片方だけ別 entity を消す」乖離を機械検出する。
		const child = await loadChildRepo();
		const counts = await child.resetChildProgressData(CHILD_ID, TENANT);
		expect(Object.keys(counts).sort()).toEqual(
			['activityLogs', 'childAchievements', 'loginBonuses', 'pointBalance', 'pointLedger'].sort(),
		);
	});

	it('別の子供の BALANCE / POINT# は reset の影響を受けない', async () => {
		const point = await loadPointRepo();
		const OTHER = 88;

		await point.insertPointEntry(
			{ childId: CHILD_ID, amount: 15, type: 'earn', description: 'x' },
			TENANT,
		);
		await point.insertPointEntry(
			{ childId: OTHER, amount: 40, type: 'earn', description: 'y' },
			TENANT,
		);

		const child = await loadChildRepo();
		await child.resetChildProgressData(CHILD_ID, TENANT);

		// reset 対象の子は 0、別の子は残高維持
		expect(await point.getBalance(CHILD_ID, TENANT)).toBe(0);
		expect(await point.getBalance(OTHER, TENANT)).toBe(40);
	});
});
