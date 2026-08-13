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

// #4546 ②: 書き込む値は自 tenant prefix 配下でなければ repo が拒否する。URL は
// TENANT から組み立てる (prefix を固定文字列で書くと guard の意味が消える)。
const PLACEHOLDER = `/tenants/${TENANT}/avatars/1/placeholder.svg?v=abc`;
const PHOTO = `/tenants/${TENANT}/avatars/1/9f1c2d3e.webp`;
const NEW = `/tenants/${TENANT}/avatars/1/new.svg`;

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

		expect(await updateChildAvatarUrlIfMatches(childId, PLACEHOLDER, NEW, TENANT)).toBe(true);
		expect((await findChildForImage(childId, TENANT))?.avatarUrl).toBe(NEW);
	});

	it('間に写真アップロードが入ったら 0 行更新になり写真が残る', async () => {
		await updateChildAvatarUrl(childId, PLACEHOLDER, TENANT);
		// 割り込み: 保護者が写真をアップロードした
		await updateChildAvatarUrl(childId, PHOTO, TENANT);

		// 読んだ時点の値 (PLACEHOLDER) を期待した書き込みは負ける
		expect(await updateChildAvatarUrlIfMatches(childId, PLACEHOLDER, NEW, TENANT)).toBe(false);
		expect((await findChildForImage(childId, TENANT))?.avatarUrl).toBe(PHOTO);
	});

	it('null 戻しも条件付きで可能', async () => {
		await updateChildAvatarUrl(childId, PHOTO, TENANT);

		expect(await updateChildAvatarUrlIfMatches(childId, PHOTO, null, TENANT)).toBe(true);
		expect((await findChildForImage(childId, TENANT))?.avatarUrl).toBe(null);
	});

	// ── #4546 ②: 書き込む値の tenant prefix 検証 ──
	//
	// #4469 は「他人のファイルを消さない」だけを守っており、`avatar_url` に**何を書けるか**は
	// 無検査だった。他 tenant を指す URL を書けると、配信経路がそのまま他人の顔写真を返し
	// (IDOR)、account 削除の prefix 一括削除からも漏れる。両メソッドで拒否することを固定する。

	it('#4546: 他 tenant を指す URL は無条件更新で拒否される', async () => {
		await expect(
			updateChildAvatarUrl(childId, '/tenants/someone-else/avatars/1/photo.webp', TENANT),
		).rejects.toThrow(/tenant-scoped/);
		expect((await findChildForImage(childId, TENANT))?.avatarUrl).toBe(null);
	});

	it('#4546: 他 tenant を指す URL は条件付き更新でも拒否される', async () => {
		await expect(
			updateChildAvatarUrlIfMatches(
				childId,
				null,
				'/tenants/someone-else/avatars/1/photo.webp',
				TENANT,
			),
		).rejects.toThrow(/tenant-scoped/);
		expect((await findChildForImage(childId, TENANT))?.avatarUrl).toBe(null);
	});

	it('#4546: traversal (..) を含む URL も拒否される', async () => {
		await expect(
			updateChildAvatarUrl(childId, `/tenants/${TENANT}/avatars/../../etc/passwd`, TENANT),
		).rejects.toThrow(/tenant-scoped/);
	});

	// 期待値は「DB から読んだ値」なので検査対象にしない。tenant prefix 導入前の legacy な
	// avatar_url を持つ行 (#4413 以前) が永久に更新できなくなるのを防ぐ。
	it('#4546: 期待値は検査しない (legacy な avatar_url を持つ行も更新できる)', async () => {
		dbHolder.sqlite
			?.prepare('UPDATE children SET avatar_url = ? WHERE id = ?')
			.run('/uploads/avatars/legacy.png', Number(childId));

		expect(
			await updateChildAvatarUrlIfMatches(childId, '/uploads/avatars/legacy.png', NEW, TENANT),
		).toBe(true);
		expect((await findChildForImage(childId, TENANT))?.avatarUrl).toBe(NEW);
	});
});
