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

/**
 * reset 後に partition (pk) に残存する SK を sort 済 list で返す。
 * Set の `toEqual` が環境により不安定なため、exact-set (列挙外 key 含む完全一致) 比較は
 * sort 済配列の同値で行う。membership ループでは捕捉できない「DELETED でも SURVIVOR でもない
 * 列挙外 key の残存」を検出するための基盤。
 */
function remainingSks(store: Map<string, Record<string, unknown>>, pk: string): string[] {
	return [...store.values()]
		.filter((i) => i.PK === pk)
		.map((i) => String(i.SK))
		.sort();
}

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

	it('#3475: BALANCE 行が存在しない child の pointBalance は 0 (旧実装の無条件 1 ハードコード是正)', async () => {
		// ポイント付与なし = BALANCE 集計行が無い。pointBalance は実削除件数 0 を返す
		// (旧実装は BALANCE 不在でも 1 を hardcode し「削除件数」と乖離していた)。
		const child = await loadChildRepo();
		const counts = await child.resetChildProgressData(CHILD_ID, TENANT);
		expect(counts.pointBalance).toBe(0);
		expect(counts.pointLedger).toBe(0);
	});

	it('#3477: BALANCE 削除は存在確認 read に gate されず、stale read-miss でも必ず削除集合に入る', async () => {
		// 安全不変条件 (ADR-0006): reset の BALANCE clear は結果整合 read に依存させない。
		// BALANCE 行は store に実在するが、存在確認 (count 用) の Get を stale read-miss
		// (eventual consistency で空応答) に差し替えても、決定的キーの無条件 push により
		// BALANCE は削除集合に入り getBalance() が 0 に揃うことを検証する。read-miss に
		// 削除を gate する実装 (旧 BLOCK 版) ならこの test は fail する。
		const point = await loadPointRepo();
		await point.insertPointEntry(
			{ childId: CHILD_ID, amount: 50, type: 'earn', description: 'seed' },
			TENANT,
		);
		// 前提: BALANCE 集計行が store に実在する
		expect(
			[...store.values()].some(
				(i) => String(i.PK).endsWith(`CHILD#${CHILD_ID}`) && i.SK === 'BALANCE',
			),
		).toBe(true);

		// SK=BALANCE への Get だけを stale read-miss (空応答) に差し替える。
		// 他コマンド (BatchWrite 削除含む) は実 store ロジックへ委譲する。
		const passthrough = mockSend.getMockImplementation();
		if (!passthrough) throw new Error('mockSend implementation missing');
		const balanceGetKeys: Array<{ PK: unknown; SK: unknown }> = [];
		mockSend.mockImplementation(async (cmd: { __type: string; input: Record<string, unknown> }) => {
			if (cmd.__type === 'Get') {
				const key = cmd.input.Key as { PK: unknown; SK: unknown };
				if (key?.SK === 'BALANCE') {
					balanceGetKeys.push(key);
					return {}; // stale read-miss
				}
			}
			return passthrough(cmd);
		});

		try {
			const child = await loadChildRepo();
			const counts = await child.resetChildProgressData(CHILD_ID, TENANT);

			// counts は read-miss を反映し 0 (診断値は read 由来のため)
			expect(counts.pointBalance).toBe(0);
			// だが BALANCE 行自体は削除されている (無条件 push、read に gate されない)
			expect(
				[...store.values()].some(
					(i) => String(i.PK).endsWith(`CHILD#${CHILD_ID}`) && i.SK === 'BALANCE',
				),
			).toBe(false);
			// read-miss を仕込んだ Get が実際に BALANCE へ発行されていたこと
			expect(balanceGetKeys.length).toBeGreaterThan(0);
		} finally {
			mockSend.mockImplementation(passthrough);
		}

		// 復旧後の getBalance も 0 (BALANCE 行が消えたため phantom 残高なし)
		expect(await point.getBalance(CHILD_ID, TENANT)).toBe(0);
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

	// #3485 (reset 完全性 class-lock / ADR-0061 same-class→guard): child partition の全 entity を seed し、
	// reset 後に「削除対象 (記録系 + BALANCE) のみ消え、意図的保持 entity (ステータス/図鑑/チャレンジ/評価/
	// ごほうび等) は残る」契約を partition 全件残渣で固定する。これにより #3475→#3485 と続いた「ADD 集計
	// 派生 entity が reset 残存」型の adversarial finding を 1 本の契約 test で先取り回答する (instance でなく
	// class を lock)。reset = dev-only 進捗リセット (記録系のみ) であり、COPPA 削除 (= deleteChild = partition
	// 全削除) とは別レイヤー (#3471 reset scope 契約)。enemyCollection(ENEMYCOL#)/defeatCount は意図的保持
	// (#3485 の defect 主張は本契約で「設計どおり」と確定、wontfix)。
	it('#3485: reset は記録系 + BALANCE のみ削除し、ステータス/図鑑/チャレンジ等は意図的に保持する (partition 全件残渣契約)', async () => {
		const pk = `T#${TENANT}#CHILD#${CHILD_ID}`;
		const seed = (sk: string) => store.set(`${pk}|${sk}`, { PK: pk, SK: sk });
		// 削除対象 (記録系 + 派生集計)
		const DELETED_SKS = [
			'LOG#2026-06-29#1',
			'POINT#100#1',
			'LOGIN#2026-06-29',
			'ACHV#1#m',
			'BALANCE',
		];
		// 意図的保持 (reset = 記録系のみ。status/dex/challenge/eval/reward/profile/activity は残す、#3471 契約)
		const SURVIVOR_SKS = [
			'PROFILE',
			'CHILDACT#1',
			'CHILDCHAL#1',
			'STATUS#01',
			'STATHIST#01#100#1',
			'ENEMYCOL#0001', // 敵図鑑 defeatCount (#3485 の対象、意図的保持)
			'EVAL#2026-06-22',
			'REWARD#100#1',
		];
		for (const sk of [...DELETED_SKS, ...SURVIVOR_SKS]) seed(sk);

		const child = await loadChildRepo();
		await child.resetChildProgressData(CHILD_ID, TENANT);

		const remainingList = remainingSks(store, pk);
		const remaining = new Set(remainingList);
		// 削除対象は全て消えている (既存 membership 契約は維持)
		for (const sk of DELETED_SKS) {
			expect(remaining.has(sk), `削除対象 ${sk} が残存している`).toBe(false);
		}
		// 意図的保持 entity は全て残る (将来 reset scope を誤って広げたら本 test が fail)
		for (const sk of SURVIVOR_SKS) {
			expect(remaining.has(sk), `保持対象 ${sk} が誤削除された`).toBe(true);
		}
		// exhaustive: 残存 SK 集合は survivor 集合と「完全一致」する。membership ループだけでは
		// DELETED でも SURVIVOR でもない列挙外 key の残存を見逃す (両 list に無く seed されず素通り)。
		// exact-set で固定することで、将来 child-partition に新設される ADD 集計 / 派生 entity が
		// reset 漏れした場合に「列挙外残存」として本契約が検出する (instance でなく class を lock、
		// ADR-0061 same-class→guard)。reset は記録系のみ削除するため、残存 = survivor と一致が不変。
		expect(remainingList).toEqual([...SURVIVOR_SKS].sort());
	});

	// #3485 fails-closed 証明: exact-set 契約が「reset 対象であるべきなのに実装が消し忘れている
	// 将来 entity」を検出して fail-closed になることを実証する。DELETED でも SURVIVOR でもない
	// 新規 prefix (FUTURE_AGG#) の余分 SK を 1 件 seed すると、reset は未知 prefix を消さないため
	// 残存し、exact-set 比較が survivor 集合と不一致になる。この「不一致を検出する」挙動自体を
	// positive に assert することで、将来 entity が増えたら上の partition 全件残渣契約が
	// fail-closed で気付かせる回帰ネットであることを示す (membership のみなら素通りしていた)。
	it('#3485 fails-closed: 列挙外の将来 entity (FUTURE_AGG#) が残存すると exact-set 契約が不一致を検出する', async () => {
		const pk = `T#${TENANT}#CHILD#${CHILD_ID}`;
		const seed = (sk: string) => store.set(`${pk}|${sk}`, { PK: pk, SK: sk });
		const SURVIVOR_SKS = ['PROFILE', 'STATUS#01', 'ENEMYCOL#0001'];
		// reset 対象であるべき (将来の ADD 集計 / 派生 entity) だが実装がまだ削除集合に含めていない、
		// を模した余分 key。DELETED_SKS にも SURVIVOR_SKS にも属さない新規 prefix。
		const LEAKED_FUTURE_SK = 'FUTURE_AGG#1';
		for (const sk of [...SURVIVOR_SKS, LEAKED_FUTURE_SK]) seed(sk);

		const child = await loadChildRepo();
		await child.resetChildProgressData(CHILD_ID, TENANT);

		const remainingList = remainingSks(store, pk);
		// 未知 prefix は reset の既知 prefix Query に掛からず残存する (= 消し忘れ将来 entity の再現)
		expect(remainingList).toContain(LEAKED_FUTURE_SK);
		// exact-set 契約は「列挙外 key の残存」を survivor 集合との不一致として検出する。
		// もし partition 全件残渣契約が membership のみだったら、この残存は両 list 外のため素通り
		// していた。exact-set 化により必ず不一致 (= 上の契約 test が fail) になることの positive 証明。
		expect(remainingList).not.toEqual([...SURVIVOR_SKS].sort());
	});
});
