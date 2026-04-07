// tests/unit/services/child-repo-legacy-ui-mode.test.ts
// #571: SQLite child-repo が旧 ui_mode コード（kinder/lower/upper/teen）を
// 自動正規化することを検証する。
//
// 背景:
//   旧 writeBackChildSv() は _sv フィールドだけを更新し、実際の transformer
//   を適用していなかった。そのため `ui_mode='kinder', _sv=3` という嘘
//   マイグレーション済み状態の行が DB に残り、`/${uiMode}/home` リダイレクト
//   が `/kinder/home` を生成して 404 を返していた。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, createTestDb, resetDb, type TestDb, type TestSqlite } from '../helpers/test-db';

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

import {
	findAllChildren,
	findChildById,
	findChildByUserId,
} from '$lib/server/db/sqlite/child-repo';

beforeAll(() => {
	const result = createTestDb();
	sqlite = result.sqlite;
	testDb = result.db;
});

afterAll(() => closeDb(sqlite));

beforeEach(() => {
	resetDb(sqlite);
});

/** 旧 ui_mode コードを直接 INSERT（broken writeback の状態を再現） */
function insertPoisonedChild(opts: {
	id: number;
	nickname: string;
	age: number;
	uiMode: string;
	sv?: number;
	userId?: string | null;
}) {
	sqlite
		.prepare(
			`INSERT INTO children (id, nickname, age, theme, ui_mode, user_id, _sv)
			 VALUES (?, ?, ?, 'pink', ?, ?, ?)`,
		)
		.run(opts.id, opts.nickname, opts.age, opts.uiMode, opts.userId ?? null, opts.sv ?? 3);
}

describe('#571 SQLite child-repo: 旧 ui_mode コードの正規化', () => {
	it('findChildById: ui_mode=kinder を preschool に正規化する', async () => {
		insertPoisonedChild({ id: 1, nickname: 'たろう', age: 5, uiMode: 'kinder' });

		const child = await findChildById(1, 'tenant');

		expect(child).toBeDefined();
		expect(child?.uiMode).toBe('preschool');
	});

	it('findChildById: ui_mode=lower を elementary に正規化する', async () => {
		insertPoisonedChild({ id: 2, nickname: 'はなこ', age: 9, uiMode: 'lower' });

		const child = await findChildById(2, 'tenant');

		expect(child?.uiMode).toBe('elementary');
	});

	it('findChildById: ui_mode=upper を junior に正規化する', async () => {
		insertPoisonedChild({ id: 3, nickname: 'けんた', age: 14, uiMode: 'upper' });

		const child = await findChildById(3, 'tenant');

		expect(child?.uiMode).toBe('junior');
	});

	it('findChildById: ui_mode=teen を senior に正規化する', async () => {
		insertPoisonedChild({ id: 4, nickname: 'みき', age: 17, uiMode: 'teen' });

		const child = await findChildById(4, 'tenant');

		expect(child?.uiMode).toBe('senior');
	});

	it('findChildById: 正規化後の値を DB に書き戻す', async () => {
		insertPoisonedChild({ id: 5, nickname: 'たろう', age: 5, uiMode: 'kinder' });

		await findChildById(5, 'tenant');

		const raw = sqlite.prepare('SELECT ui_mode FROM children WHERE id = ?').get(5) as {
			ui_mode: string;
		};
		expect(raw.ui_mode).toBe('preschool');
	});

	it('findAllChildren: 全行の旧コードを正規化する', async () => {
		insertPoisonedChild({ id: 1, nickname: 'たろう', age: 5, uiMode: 'kinder' });
		insertPoisonedChild({ id: 2, nickname: 'はなこ', age: 9, uiMode: 'lower' });
		insertPoisonedChild({ id: 3, nickname: 'けんた', age: 14, uiMode: 'upper' });

		const all = await findAllChildren('tenant');

		const map = new Map(all.map((c) => [c.id, c.uiMode]));
		expect(map.get(1)).toBe('preschool');
		expect(map.get(2)).toBe('elementary');
		expect(map.get(3)).toBe('junior');
	});

	it('findChildByUserId: 旧コードを正規化する', async () => {
		insertPoisonedChild({
			id: 10,
			nickname: 'こうじ',
			age: 7,
			uiMode: 'lower',
			userId: 'cognito-sub-xyz',
		});

		const child = await findChildByUserId('cognito-sub-xyz', 'tenant');

		expect(child?.uiMode).toBe('elementary');
	});

	it('既に新コード (preschool) の行は変更しない', async () => {
		insertPoisonedChild({ id: 20, nickname: 'みなと', age: 4, uiMode: 'preschool' });

		const child = await findChildById(20, 'tenant');

		expect(child?.uiMode).toBe('preschool');
		const raw = sqlite.prepare('SELECT ui_mode FROM children WHERE id = ?').get(20) as {
			ui_mode: string;
		};
		expect(raw.ui_mode).toBe('preschool');
	});

	it('存在しない id では undefined を返す', async () => {
		const child = await findChildById(999, 'tenant');
		expect(child).toBeUndefined();
	});
});
