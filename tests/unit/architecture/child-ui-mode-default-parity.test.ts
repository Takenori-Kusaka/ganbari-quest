// tests/unit/architecture/child-ui-mode-default-parity.test.ts
// #4419 fitness function: 3 backend (dsql / sqlite / demo) の insertChild が
// **uiMode 未指定時に同じ既定値**を返すことを機械強制する。
//
// なぜ必要か: `tests/CLAUDE.md` §「backend 並行実装の整合性」が「sqlite ⇄ dsql のペアは
// undefined / null / 既定値ハンドリングを両実装で一致させる」と定めているのに、既定値の
// 不一致が検証されていなかった。結果、dsql は `'preschool'` 固定 / sqlite は 2 歳以下だけ
// baby / demo だけが getDefaultUiMode という 3 通りに割れ、**顧客が使う本番 (dsql) が
// 最も壊れている**状態が誰にも気づかれず残った (#4419)。
//
// 検証は 2 段:
//   [F1] 挙動 — 3 backend に実際に insert して既定値が互いに一致し、SSOT
//        (getDefaultUiMode) とも一致する。片方の backend を変えれば必ず落ちる
//   [F2] 由来 — 各 repo が SSOT 関数を経由し、年齢判定リテラルを repo 内に持たない
//        (今日たまたま値が合う literal の再混入を止める)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDefaultUiMode } from '../../../src/lib/domain/validation/age-tier';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';
import { closeDb, createTestDb, type TestDb, type TestSqlite } from '../helpers/test-db';

const FAMILY = '00000000-0000-4000-8000-0000000004b1';

/** 既定値の一致を確認する年齢 — 5 年齢帯すべての境界 (docs/DESIGN.md §8)。 */
const AGES = [0, 2, 3, 5, 6, 12, 13, 15, 16, 18];

// sqlite repo は module-level の db を握るのでテスト DB を差す。
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

const sqliteRepo = await import('$lib/server/db/sqlite/child-repo');
const demoRepo = await import('$lib/server/db/demo/child-repo');

describe('#4419 child insertChild の uiMode 既定値は 3 backend で一致する (fitness)', () => {
	let sqlite: TestSqlite;
	let t: DsqlTestDb;
	let dsqlRepo: ReturnType<typeof createDsqlChildRepo>;

	beforeAll(async () => {
		const created = createTestDb();
		sqlite = created.sqlite;
		testDb = created.db;
		t = await createDsqlTestDb();
		dsqlRepo = createDsqlChildRepo(
			t.db,
			createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 }),
		);
	}, 60_000);

	afterAll(async () => {
		closeDb(sqlite);
		await t.close();
	});

	it.each(AGES)('[F1] age=%i: dsql / sqlite / demo の既定 uiMode が一致する', async (age) => {
		const input = { nickname: `p${age}`, age, theme: 'pink' };
		const dsql = await dsqlRepo.insertChild(input, FAMILY);
		const sq = await sqliteRepo.insertChild(input, FAMILY);
		const demo = await demoRepo.insertChild(input, FAMILY);

		const expected = getDefaultUiMode(age);
		// backend 同士が一致すること (どれか 1 つを変えれば落ちる)
		expect(
			{ dsql: dsql.uiMode, sqlite: sq.uiMode, demo: demo.uiMode },
			`age=${age} で backend 間の既定 uiMode が割れている`,
		).toEqual({ dsql: expected, sqlite: expected, demo: expected });
	});

	it('[F1] 明示指定した uiMode は 3 backend とも尊重される (既定値で上書きしない)', async () => {
		const input = { nickname: 'manual', age: 15, theme: 'pink', uiMode: 'preschool' };
		const dsql = await dsqlRepo.insertChild(input, FAMILY);
		const sq = await sqliteRepo.insertChild(input, FAMILY);
		const demo = await demoRepo.insertChild(input, FAMILY);
		expect([dsql.uiMode, sq.uiMode, demo.uiMode]).toEqual(['preschool', 'preschool', 'preschool']);
	});

	// ---- [F2] 由来 (SSOT 経由であること) ----

	const REPO_FILES = [
		'src/lib/server/db/dsql/child-repo.ts',
		'src/lib/server/db/sqlite/child-repo.ts',
		'src/lib/server/db/demo/child-repo.ts',
	];

	/** `input.uiMode ?? <式>` の <式> を取り出す (空白を潰し、外側の閉じ括弧を落とす)。 */
	function extractDefaultExpr(source: string): string[] {
		const matches = [...source.matchAll(/input\.uiMode\s*\?\?\s*([^,;\n}]+)/g)];
		return matches.map((m) => {
			let expr = (m[1] ?? '').replace(/\s+/g, '');
			// 式の外側 (テンプレートリテラルや呼び出しの閉じ) の ')' を取り除く
			while (
				expr.endsWith(')') &&
				(expr.match(/\)/g)?.length ?? 0) > (expr.match(/\(/g)?.length ?? 0)
			) {
				expr = expr.slice(0, -1);
			}
			return expr;
		});
	}

	it.each(REPO_FILES)('[F2] %s の既定値式が getDefaultUiMode(input.age) である', (rel) => {
		const source = readFileSync(resolve(process.cwd(), rel), 'utf-8');
		const exprs = extractDefaultExpr(source);
		expect(exprs.length, `${rel} に uiMode 既定値式が見つからない`).toBeGreaterThan(0);
		for (const expr of exprs) {
			expect(expr, `${rel} は年齢判定を repo 内に書かず SSOT を呼ぶこと`).toBe(
				'getDefaultUiMode(input.age)',
			);
		}
	});

	it('[F2] 3 backend の既定値式は同一文字列である', () => {
		const exprs = REPO_FILES.map((rel) =>
			extractDefaultExpr(readFileSync(resolve(process.cwd(), rel), 'utf-8')).join('|'),
		);
		expect(new Set(exprs).size, `backend ごとに既定値式が違う: ${exprs.join(' / ')}`).toBe(1);
	});
});
