import { asChildId } from '$lib/domain/ids';
// tests/unit/services/point-service.test.ts
// ポイント管理サービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { assertSuccess } from '../helpers/assert-result';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
} from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));

import { POINT_LEDGER_LABELS } from '../../../src/lib/domain/labels';
import {
	convertPoints,
	getPointBalance,
	getPointHistory,
	grantInitialPoints,
} from '../../../src/lib/server/services/point-service';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

function resetDb() {
	resetAllTables(sqlite);
}

function seedChild() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();
}

function addPoints(childId: number, amount: number, type: string, description: string) {
	testDb.insert(schema.pointLedger).values({ childId, amount, type, description }).run();
}

describe('point-service', () => {
	beforeEach(() => {
		seedChild();
	});

	// 残高取得
	it('ポイント残高0を返す（初期状態）', async () => {
		const result = assertSuccess(await getPointBalance(asChildId(1), 'test-tenant'));
		expect(result.balance).toBe(0);
		expect(result.convertableAmount).toBe(0);
	});

	it('ポイント残高を正しく計算する', async () => {
		addPoints(1, 100, 'activity', 'テスト活動');
		addPoints(1, 200, 'activity', 'テスト活動2');
		addPoints(1, -50, 'cancel', 'キャンセル');

		const result = assertSuccess(await getPointBalance(asChildId(1), 'test-tenant'));
		expect(result.balance).toBe(250);
		expect(result.convertableAmount).toBe(0); // 500未満
	});

	it('変換可能額を正しく計算する（500P単位）', async () => {
		addPoints(1, 1250, 'activity', '大量ポイント');

		const result = assertSuccess(await getPointBalance(asChildId(1), 'test-tenant'));
		expect(result.balance).toBe(1250);
		expect(result.convertableAmount).toBe(1000); // 500 * 2
	});

	it('存在しない子供のポイント残高はNOT_FOUND', async () => {
		const result = await getPointBalance(asChildId(999), 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	// #3593 ④: archived child への加点は service 層 business rule で拒否する (repo は primitive)。
	// insertPointEntry (writer) は is_archived を filter せず total_point を加点するため、
	// 「archived な子には加点しない」判断は service で担保する。
	describe('grantInitialPoints: archived 子への加点ガード (#3593 ④)', () => {
		function seedArchivedChild() {
			resetDb();
			testDb
				.insert(schema.children)
				.values({ nickname: 'アーカイブちゃん', age: 4, theme: 'pink', isArchived: 1 })
				.run();
		}

		it('archived child への grantInitialPoints は CHILD_ARCHIVED を返し加点しない', async () => {
			seedArchivedChild();
			const result = await grantInitialPoints(asChildId(1), 500, 'test-tenant');
			expect(result).toEqual({ error: 'CHILD_ARCHIVED' });
			// 加点されていない (total は 0 のまま)
			const rows = testDb.select().from(schema.pointLedger).all();
			expect(rows.length).toBe(0);
		});

		it('active child への grantInitialPoints は成功して加点する', async () => {
			seedChild(); // active child (isArchived 未指定 = 0)
			const result = assertSuccess(await grantInitialPoints(asChildId(1), 500, 'test-tenant'));
			expect(result.balance).toBe(500);
		});
	});

	// #3593 ④: system 生成 ledger description は labels SSOT (POINT_LEDGER_LABELS) 経由。
	// UI (ポイント履歴) に表示される system 文言をコード直書きせず 1 箇所に集約する (ADR-0045)。
	describe('ledger description は labels SSOT 経由 (#3593 ④)', () => {
		it('grantInitialPoints の description は POINT_LEDGER_LABELS.initialSetup と一致', async () => {
			seedChild();
			assertSuccess(await grantInitialPoints(asChildId(1), 100, 'test-tenant'));
			const rows = testDb.select().from(schema.pointLedger).all();
			expect(rows[0]?.description).toBe(POINT_LEDGER_LABELS.initialSetup);
		});

		it('#4722: 変換の二重送信で残高がマイナスにならない (原子境界)', async () => {
			seedChild();
			addPoints(1, 100, 'activity', '元手');

			// 連打 / 二重送信を模す。旧実装は「残高を読む → 台帳に insert」が await を跨いでいたため、
			// 両方が残高 100 を読んで 100 ずつ引き、残高が -100 になり得た。
			const results = await Promise.all([
				convertPoints(asChildId(1), 100, 'test-tenant', 'manual'),
				convertPoints(asChildId(1), 100, 'test-tenant', 'manual'),
			]);
			const ok = results.filter((r) => !('error' in r));
			const insufficient = results.filter((r) => 'error' in r && r.error === 'INSUFFICIENT_POINTS');
			expect(ok).toHaveLength(1);
			expect(insufficient).toHaveLength(1);

			const balance = sqlite
				.prepare('SELECT coalesce(sum(amount), 0) AS total FROM point_ledger WHERE child_id = 1')
				.get() as { total: number };
			expect(balance.total).toBe(0);
			expect(balance.total).toBeGreaterThanOrEqual(0); // 残高はマイナスにならない
		});

		it('convertPoints の description は POINT_LEDGER_LABELS.convert(mode) と一致', async () => {
			seedChild();
			addPoints(1, 1000, 'activity', '元手');
			const result = assertSuccess(await convertPoints(asChildId(1), 500, 'test-tenant', 'manual'));
			expect(result.message).toBe(POINT_LEDGER_LABELS.convert(500, 'manual'));
		});
	});

	// 履歴取得
	it('ポイント履歴を取得する', async () => {
		addPoints(1, 100, 'activity', '活動1');
		addPoints(1, 200, 'activity', '活動2');
		addPoints(1, 50, 'login_bonus', 'ログインボーナス');

		const result = assertSuccess(
			await getPointHistory(asChildId(1), { limit: 50, offset: 0 }, 'test-tenant'),
		);
		const history = await result.history;
		expect(history.length).toBe(3);
	});

	it('履歴のlimit/offsetが動作する', async () => {
		addPoints(1, 10, 'activity', '1');
		addPoints(1, 20, 'activity', '2');
		addPoints(1, 30, 'activity', '3');

		const result = assertSuccess(
			await getPointHistory(asChildId(1), { limit: 2, offset: 0 }, 'test-tenant'),
		);
		const history = await result.history;
		expect(history.length).toBe(2);
	});

	it('存在しない子供の履歴はNOT_FOUND', async () => {
		const result = await getPointHistory(asChildId(999), { limit: 50, offset: 0 }, 'test-tenant');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	// ポイント変換
	it('ポイントを正常に変換できる（500P）', async () => {
		addPoints(1, 700, 'activity', 'テスト');

		const result = assertSuccess(await convertPoints(asChildId(1), 500, 'test-tenant', 'preset'));
		expect(result.convertedAmount).toBe(500);
		expect(result.remainingBalance).toBe(200);

		// 残高確認
		const balance = assertSuccess(await getPointBalance(asChildId(1), 'test-tenant'));
		expect(balance.balance).toBe(200);
	});

	it('残高不足時はINSUFFICIENT_POINTSエラー', async () => {
		addPoints(1, 300, 'activity', 'テスト');

		const result = await convertPoints(asChildId(1), 500, 'test-tenant', 'preset');
		expect(result).toEqual({ error: 'INSUFFICIENT_POINTS' });
	});

	it('存在しない子供の変換はNOT_FOUND', async () => {
		const result = await convertPoints(asChildId(999), 500, 'test-tenant', 'preset');
		expect(result).toEqual({ error: 'NOT_FOUND' });
	});

	it('1000P変換が正常に動作する', async () => {
		addPoints(1, 1500, 'activity', '大量');

		const result = assertSuccess(await convertPoints(asChildId(1), 1000, 'test-tenant', 'preset'));
		expect(result.convertedAmount).toBe(1000);
		expect(result.remainingBalance).toBe(500);
	});

	it('変換後に履歴にconvertエントリが追加される', async () => {
		addPoints(1, 600, 'activity', 'テスト');
		await convertPoints(asChildId(1), 500, 'test-tenant', 'preset');

		const historyResult = assertSuccess(
			await getPointHistory(asChildId(1), { limit: 50, offset: 0 }, 'test-tenant'),
		);
		const historyList = await historyResult.history;
		const convertEntry = historyList.find((h: { type: string }) => h.type === 'convert');
		expect(convertEntry).toBeDefined();
		expect(convertEntry?.amount).toBe(-500);
	});

	// 自由入力モード
	it('手動入力モードで1P単位の変換ができる', async () => {
		addPoints(1, 700, 'activity', 'テスト');

		const result = assertSuccess(await convertPoints(asChildId(1), 123, 'test-tenant', 'manual'));
		expect(result.convertedAmount).toBe(123);
		expect(result.remainingBalance).toBe(577);
		expect(result.message).toContain('手動入力');
	});

	it('領収書モードで変換できる', async () => {
		addPoints(1, 1000, 'activity', 'テスト');

		const result = assertSuccess(await convertPoints(asChildId(1), 648, 'test-tenant', 'receipt'));
		expect(result.convertedAmount).toBe(648);
		expect(result.remainingBalance).toBe(352);
		expect(result.message).toContain('領収書読み取り');
	});

	it('プリセットモード（デフォルト）の説明文にサフィックスがない', async () => {
		addPoints(1, 600, 'activity', 'テスト');

		const result = assertSuccess(await convertPoints(asChildId(1), 500, 'test-tenant', 'preset'));
		expect(result.message).not.toContain('手動入力');
		expect(result.message).not.toContain('領収書');
	});
});
