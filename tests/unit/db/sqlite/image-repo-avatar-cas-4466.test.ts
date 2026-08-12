// tests/unit/db/sqlite/image-repo-avatar-cas-4466.test.ts
//
// #4466: SQLite backend (NUC セルフホスト) 側の `updateChildAvatarUrlIfMatches`。
//
// 仮アバターの作り直しは「いま仮アバターのままか」を読んでから書くまでに await が挟まる。
// 無条件 UPDATE だと、その窓で完了した写真アップロードの URL を踏み潰す (lost update)。
// **この防御は両 backend に要る** — 片方だけだと NUC か cloud のどちらかで写真が消え続ける。
// DSQL / PGlite 側の同等検証は `tests/unit/db/dsql-family-satellite-repos.test.ts` [IM5]。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import { closeDb, createTestDb, type TestSqlite } from '../../helpers/test-db';

const dbHolder: { sqlite: TestSqlite | null; db: ReturnType<typeof createTestDb>['db'] | null } = {
	sqlite: null,
	db: null,
};

vi.mock('$lib/server/db/client', () => ({
	get db() {
		if (!dbHolder.db) throw new Error('test db not initialized');
		return dbHolder.db;
	},
}));

const TENANT = 't-4466-sqlite';

// import after mock
import {
	findChildForImage,
	updateChildAvatarUrl,
	updateChildAvatarUrlIfMatches,
} from '$lib/server/db/sqlite/image-repo';

const PLACEHOLDER = '/tenants/x/avatars/1/placeholder.svg?v=abc';
const PHOTO = '/tenants/x/avatars/1/9f1c2d3e.webp';

describe('#4466 sqlite image-repo: avatar_url は期待値一致時だけ書き換える', () => {
	let childId: ReturnType<typeof asChildId>;

	beforeEach(() => {
		const created = createTestDb();
		dbHolder.sqlite = created.sqlite;
		dbHolder.db = created.db;
		const info = created.sqlite
			.prepare("INSERT INTO children (nickname, age, theme, ui_mode) VALUES ('たろう', 7, ?, ?)")
			.run('blue', 'elementary');
		childId = asChildId(Number(info.lastInsertRowid));
	});

	afterEach(() => {
		if (dbHolder.sqlite) closeDb(dbHolder.sqlite);
		dbHolder.sqlite = null;
		dbHolder.db = null;
	});

	// `= NULL` は常に UNKNOWN なので、null 一致が効かないと「まだアバターが無い子供」が
	// 永久に更新できなくなる (#4413 以前に登録された子供が該当する)。
	it('avatar_url 未設定 (null) を期待した書き込みは通る', async () => {
		expect(await updateChildAvatarUrlIfMatches(childId, null, PLACEHOLDER, TENANT)).toBe(true);
		expect((await findChildForImage(childId, TENANT))?.avatarUrl).toBe(PLACEHOLDER);
	});

	it('読んだ時点の値と一致すれば書き換わる', async () => {
		await updateChildAvatarUrl(childId, PLACEHOLDER, TENANT);

		expect(await updateChildAvatarUrlIfMatches(childId, PLACEHOLDER, '/new.svg', TENANT)).toBe(
			true,
		);
		expect((await findChildForImage(childId, TENANT))?.avatarUrl).toBe('/new.svg');
	});

	it('間に写真アップロードが入ったら 0 行更新になり写真が残る', async () => {
		await updateChildAvatarUrl(childId, PLACEHOLDER, TENANT);
		// 割り込み: 保護者が写真をアップロードした
		await updateChildAvatarUrl(childId, PHOTO, TENANT);

		// 読んだ時点の値 (PLACEHOLDER) を期待した書き込みは負ける
		expect(await updateChildAvatarUrlIfMatches(childId, PLACEHOLDER, '/new.svg', TENANT)).toBe(
			false,
		);
		expect((await findChildForImage(childId, TENANT))?.avatarUrl).toBe(PHOTO);
	});

	it('null 戻しも条件付きで可能', async () => {
		await updateChildAvatarUrl(childId, PHOTO, TENANT);

		expect(await updateChildAvatarUrlIfMatches(childId, PHOTO, null, TENANT)).toBe(true);
		expect((await findChildForImage(childId, TENANT))?.avatarUrl).toBe(null);
	});
});
