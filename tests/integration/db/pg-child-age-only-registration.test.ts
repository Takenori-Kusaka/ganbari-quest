// tests/integration/db/pg-child-age-only-registration.test.ts
// #4718: 本番 backend (pg-core = cloud DSQL / NUC PGlite) で「年齢だけで登録した子供が 0 歳になる」
// の再現 → 是正を、実 migration (drizzle/pglite/) を適用した PGlite + factory (DATA_SOURCE=pglite)
// + service 層 (addChild / editChild / importFamilyData) の貫通で固定する。
//
// sqlite (local / E2E) は age 列に保存するため再現しない class (#4680)。本テストは pg 経路で:
//   [A1] /setup/children 相当 (年齢のみ) → 一覧 / findChildById の age が入力値
//   [A2] 推定誕生日は公開 entity の birthDate に出ない (誕生日ボーナス / 🎂 表示の対象外)
//   [A3] 誕生日を入力した子は birthDate が実値で age も一致
//   [A4] 年齢のみ編集: 実誕生日を持つ子は上書きされず、推定の子は年齢が更新される
//   [A5] backup import (export の birthDate null + age) でも 0 歳にならない
//   [A6] 旧行 (birth_date NULL) の backfill: migration 0007 が ui_mode から推定誕生日を合成する

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { calculateAgeFromBirthDate, todayDateJST } from '../../../src/lib/domain/date-utils';

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const TENANT = '00000000-0000-4000-8000-00000000a718';
const originalDataSource = process.env.DATA_SOURCE;
const originalDataDir = process.env.PGLITE_DATA_DIR;

type PgliteConn = typeof import('../../../src/lib/server/db/pglite/connection');
let pgliteConn: PgliteConn;
let childService: typeof import('../../../src/lib/server/services/child-service');
let repos: ReturnType<typeof import('../../../src/lib/server/db/factory').getRepos>;

beforeAll(async () => {
	vi.resetModules();
	process.env.DATA_SOURCE = 'pglite';
	delete process.env.PGLITE_DATA_DIR; // in-memory、実 migration を適用
	pgliteConn = await import('../../../src/lib/server/db/pglite/connection');
	await pgliteConn.resetPgliteConnectionForTesting();
	await pgliteConn.initPgliteConnection();
	childService = await import('../../../src/lib/server/services/child-service');
	const { getRepos } = await import('../../../src/lib/server/db/factory');
	repos = getRepos();
}, 120_000);

afterAll(async () => {
	await pgliteConn?.resetPgliteConnectionForTesting();
	if (originalDataSource === undefined) delete process.env.DATA_SOURCE;
	else process.env.DATA_SOURCE = originalDataSource;
	if (originalDataDir === undefined) delete process.env.PGLITE_DATA_DIR;
	else process.env.PGLITE_DATA_DIR = originalDataDir;
});

describe('#4718 pg-core (PGlite 実 migration) で年齢だけの子供登録', () => {
	it('[A1] 年齢のみ (setup 相当) → 一覧 / 単体取得の age が入力値 (0 歳にならない)', async () => {
		const created = await childService.addChild({ nickname: 'たろう', age: 10 }, TENANT);
		expect(created.age).toBe(10);
		expect(created.uiMode).toBe('elementary');

		const listed = await childService.getAllChildren(TENANT);
		const taro = listed.find((c) => c.id === created.id);
		expect(taro?.age).toBe(10);

		const byId = await childService.getChildById(created.id, TENANT);
		expect(byId?.age).toBe(10);
	});

	it('[A2] 推定誕生日は公開 entity の birthDate に出ない (誕生日ボーナス対象外)', async () => {
		const created = await childService.addChild({ nickname: 'はな', age: 4 }, TENANT);
		expect(created.birthDate).toBeNull();
		expect(created.age).toBe(4);

		// 物理行には推定誕生日 (今年−4 の 1/1) と印が入っている
		const db = await pgliteConn.getPgliteDb();
		const row = (
			await db.execute(
				sql`SELECT birth_date, birth_date_estimated FROM children WHERE family_id = ${TENANT} AND child_id = ${created.id}`,
			)
		).rows[0] as { birth_date: string; birth_date_estimated: boolean };
		expect(row.birth_date).toBe(`${Number(todayDateJST().slice(0, 4)) - 4}-01-01`);
		expect(row.birth_date_estimated).toBe(true);
	});

	it('[A3] 誕生日を入力した子は birthDate が実値で age も一致', async () => {
		const created = await childService.addChild(
			{ nickname: 'けん', age: 0, birthDate: '2018-01-15' },
			TENANT,
		);
		expect(created.birthDate).toBe('2018-01-15');
		expect(created.age).toBe(calculateAgeFromBirthDate('2018-01-15'));
	});

	it('[A4] 年齢のみ編集: 実誕生日は上書きされない / 推定の子は年齢が更新される', async () => {
		const real = await childService.addChild(
			{ nickname: 'みき', age: 0, birthDate: '2016-06-01' },
			TENANT,
		);
		await childService.editChild(real.id, { age: 3 }, TENANT);
		const realAfter = await childService.getChildById(real.id, TENANT);
		expect(realAfter?.birthDate).toBe('2016-06-01'); // 誕生日が SSOT、年齢入力で壊れない

		const est = await childService.addChild({ nickname: 'ゆう', age: 7 }, TENANT);
		await childService.editChild(est.id, { age: 12 }, TENANT);
		const estAfter = await childService.getChildById(est.id, TENANT);
		expect(estAfter?.age).toBe(12);
		expect(estAfter?.birthDate).toBeNull();

		// 推定の子に誕生日を後から入れると実誕生日になる
		await childService.editChild(est.id, { birthDate: '2014-03-03' }, TENANT);
		const withBirth = await childService.getChildById(est.id, TENANT);
		expect(withBirth?.birthDate).toBe('2014-03-03');
	});

	it('[A5] backup import (birthDate null + age) でも 0 歳にならない', async () => {
		const { insertChild } = await import('../../../src/lib/server/db/child-repo');
		// import-service は facade insertChild 経由 (birthDate: exportChild.birthDate ?? undefined)
		const imported = await insertChild({ nickname: '復元太郎', age: 9 }, TENANT);
		expect(imported.age).toBe(9);
		expect(imported.birthDate).toBeNull();
	});

	it('[A6] 旧行 (birth_date NULL) は backfill されて ui_mode 帯の代表年齢になる', async () => {
		// 0007 適用前の旧行を模して birth_date NULL で直接 INSERT し、0007 の backfill 文を再適用する
		// (冪等: WHERE birth_date IS NULL)。
		const db = await pgliteConn.getPgliteDb();
		const otherFamily = '00000000-0000-4000-8000-00000000a719';
		await db.execute(sql`
			INSERT INTO children (family_id, nickname, birth_date, birth_date_estimated, theme, ui_mode)
			VALUES (${otherFamily}, '旧行', NULL, false, 'pink', 'junior')
		`);
		const { readFileSync } = await import('node:fs');
		const { resolve } = await import('node:path');
		const migration = readFileSync(
			resolve(process.cwd(), 'drizzle', 'pglite', '0007_child_birth_date_estimated.sql'),
			'utf8',
		);
		for (const stmt of migration.split('--> statement-breakpoint')) {
			await db.execute(sql.raw(stmt));
		}
		const [legacy] = await repos.child.findAllChildren(otherFamily);
		expect(legacy?.age).toBe(14); // junior 帯 (13-15) の代表年齢
		expect(legacy?.birthDate).toBeNull(); // 推定なので公開 birthDate は null
	});
});
