// tests/unit/db/dsql-child-repo.test.ts
// EPIC #3424 / PR-R1 / 設計 SSOT: dsql-data-model.md §11.1 / §3 / §P9
//
// DSQL IChildRepo 実装のテスト。実 schema (pushSchema 適用、dsql-test-db helper) に対して:
//   [C1] insert → findById round-trip (uuid 採番、entity 0/1 変換)
//   [C2] compute-on-read: birth_date から age 導出 + 非手動児は年齢で ui_mode 再導出 (§11.1)
//   [C3] 手動 override 児は stored ui_mode 維持 / 年齢のみ登録は推定誕生日で age=入力値 (#4718)
//   [C4] §P9 tenant 分離: 他 family の child は見えない・更新できない
//   [C5] update の部分更新 + updated_at 更新
//   [C6] archive/restore/findArchived (findAll から archived が消える)
//   [C7] deleteChild = 集約全削除の単一 txn (関連表の行が消え、兄弟 child のデータは残る)
//   [C8] resetChildProgressData = allowlist 3 表のみ削除 + total_point 0 リセット
//        (statuses は survive = 契約) + counts が実削除数

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asActivityId, asCategoryId, asChildId } from '../../../src/lib/domain/ids';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000a1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000a2';

describe('DSQL child-repo (PR-R1、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let repo: IChildRepo;

	beforeAll(async () => {
		t = await createDsqlTestDb();
		const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		repo = createDsqlChildRepo(t.db, runner);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	it('[C1] insert → findById round-trip (uuid 採番、0/1 数値契約)', async () => {
		const created = await repo.insertChild(
			{ nickname: 'けんた', age: 8, birthDate: '2018-01-15', theme: 'blue' },
			FAMILY,
		);
		expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(created.nickname).toBe('けんた');
		expect(created.uiModeManuallySet).toBe(0);
		expect(created.isArchived).toBe(0);

		const found = await repo.findChildById(created.id, FAMILY);
		expect(found?.nickname).toBe('けんた');
		expect(found?.birthDate).toBe('2018-01-15');
	});

	it('[C2] compute-on-read: age 導出 + 非手動児の ui_mode 年齢再導出 (§11.1)', async () => {
		// 2018-01-15 生まれ → 今日 (2026-07) 時点で 8 歳 = elementary。
		// stored ui_mode を意図的に古い値 (preschool 既定) のままにして、read が再導出することを確認。
		const created = await repo.insertChild(
			{ nickname: 'さくら', age: 8, birthDate: '2018-01-15' },
			FAMILY,
		);
		const found = await repo.findChildById(created.id, FAMILY);
		expect(found?.age).toBe(8);
		expect(found?.uiMode).toBe('elementary'); // stored 'preschool' でなく年齢由来 (§11.1)
	});

	it('[C3] 手動 override は stored 維持 / birth_date NULL は age=0 + stored', async () => {
		const manual = await repo.insertChild(
			{ nickname: 'まなみ', age: 8, birthDate: '2018-01-15', uiMode: 'junior' },
			FAMILY,
		);
		await repo.updateChild(manual.id, { uiModeManuallySet: 1 }, FAMILY);
		const foundManual = await repo.findChildById(manual.id, FAMILY);
		expect(foundManual?.uiMode).toBe('junior'); // 手動 override 維持

		// #4718: 年齢のみの登録は推定誕生日 (今年−age の 1/1) を保存するので age は入力値で読める。
		// 推定値は公開 birthDate に出さない (誕生日ボーナス対象外)。
		const noBirth = await repo.insertChild({ nickname: 'ふめい', age: 5 }, FAMILY);
		const foundNoBirth = await repo.findChildById(noBirth.id, FAMILY);
		expect(foundNoBirth?.age).toBe(5);
		expect(foundNoBirth?.birthDate).toBeNull();
		expect(foundNoBirth?.uiMode).toBe('preschool');
	});

	it('[C4b] #3709: 非 uuid の stale id は throw せず undefined (22P02 正規化)', async () => {
		// cutover 前の旧 SQLite 数値 id が Cookie に残存したケース。guard 無しだと PGlite/DSQL が
		// 22P02 (invalid input syntax for type uuid) を throw し route 層が 500 になる回帰の再現。
		await expect(repo.findChildById(asChildId('3'), FAMILY)).resolves.toBeUndefined();
		await expect(repo.findChildById(asChildId('not-a-uuid'), FAMILY)).resolves.toBeUndefined();
		await expect(repo.findChildById(asChildId(''), FAMILY)).resolves.toBeUndefined();
		// uuid 形式だが存在しない id は従来どおり undefined (query は実行される)
		await expect(
			repo.findChildById(asChildId('00000000-0000-4000-8000-00000000dead'), FAMILY),
		).resolves.toBeUndefined();
	});

	it('[C4c] #3581 ②: updateChild は非 uuid id で DB 到達せず undefined (not-found 契約)', async () => {
		// admin の子供編集 form が stale cookie 由来の旧数値 id を渡すケース。guard 無しだと
		// UPDATE ... WHERE child_id = <非uuid> で 22P02 throw → 500。guard で undefined に正規化。
		await expect(
			repo.updateChild(asChildId('3'), { nickname: 'x' }, FAMILY),
		).resolves.toBeUndefined();
		await expect(
			repo.updateChild(asChildId('not-a-uuid'), { nickname: 'x' }, FAMILY),
		).resolves.toBeUndefined();
		await expect(
			repo.updateChild(asChildId(''), { nickname: 'x' }, FAMILY),
		).resolves.toBeUndefined();
		// uuid 形式だが存在しない id は従来どおり undefined (UPDATE は実行され 0 行)。
		await expect(
			repo.updateChild(
				asChildId('00000000-0000-4000-8000-00000000dead'),
				{ nickname: 'x' },
				FAMILY,
			),
		).resolves.toBeUndefined();
	});

	it('[C4d] #3581 ②: deleteChild は非 uuid id で throw せず no-op (無関係な児は無傷)', async () => {
		const keep = await repo.insertChild({ nickname: '無傷', age: 7 }, FAMILY);
		await expect(repo.deleteChild(asChildId('3'), FAMILY)).resolves.toBeUndefined();
		await expect(repo.deleteChild(asChildId('not-a-uuid'), FAMILY)).resolves.toBeUndefined();
		// guard は該当行なし = no-op のため、無関係な既存児は削除されない。
		expect(await repo.findChildById(keep.id, FAMILY)).toBeTruthy();
	});

	it('[C4] §P9 tenant 分離: 他 family から不可視・更新不能', async () => {
		const mine = await repo.insertChild({ nickname: 'うち', age: 6 }, FAMILY);
		expect(await repo.findChildById(mine.id, OTHER_FAMILY)).toBeUndefined();
		expect(await repo.updateChild(mine.id, { nickname: '乗っ取り' }, OTHER_FAMILY)).toBeUndefined();
		const intact = await repo.findChildById(mine.id, FAMILY);
		expect(intact?.nickname).toBe('うち');
	});

	it('[C5] update: 部分更新 + updated_at 更新', async () => {
		const c = await repo.insertChild({ nickname: '更新前', age: 6 }, FAMILY);
		const updated = await repo.updateChild(c.id, { nickname: '更新後', theme: 'green' }, FAMILY);
		expect(updated?.nickname).toBe('更新後');
		expect(updated?.theme).toBe('green');
		expect(updated?.birthDate).toBe(null); // 未指定 field は不変
		expect(Date.parse(updated?.updatedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(c.updatedAt));
	});

	it('[C6] archive → findAll から消え、restore で復帰 (reason 束縛)', async () => {
		const c = await repo.insertChild({ nickname: 'アーカイブ', age: 6 }, FAMILY);
		await repo.archiveChildren([c.id], 'trial_expired', FAMILY);

		const all = await repo.findAllChildren(FAMILY);
		expect(all.some((x) => x.id === c.id)).toBe(false);
		const archived = await repo.findArchivedChildren(FAMILY);
		expect(archived.some((x) => x.id === c.id && x.archivedReason === 'trial_expired')).toBe(true);

		await repo.restoreArchivedChildren('trial_expired', FAMILY);
		const restored = await repo.findChildById(c.id, FAMILY);
		expect(restored?.isArchived).toBe(0);
		expect(restored?.archivedReason).toBe(null);
	});

	it('[C7] deleteChild: 集約全削除 (関連表消滅、兄弟の行は残る)', async () => {
		const target = await repo.insertChild({ nickname: '削除対象', age: 8 }, FAMILY);
		const sibling = await repo.insertChild({ nickname: '兄弟', age: 10 }, FAMILY);

		const seed = async (childId: string) => {
			const act = await t.db.execute(sql`
				INSERT INTO child_activities (family_id, child_id, name, category_id, icon)
				VALUES (${FAMILY}, ${childId}, 'テスト活動', '1', '🏃') RETURNING activity_id
			`);
			const activityId = (act.rows[0] as { activity_id: string }).activity_id;
			await t.db.execute(sql`
				INSERT INTO activity_logs (family_id, child_id, activity_id, points, recorded_date, recorded_at)
				VALUES (${FAMILY}, ${childId}, ${activityId}, 10, '2026-07-04', now())
			`);
			// #3592 ③: pin 直列化 anchor は「pin 対象 activity の child が存在する」前提で成立する。
			// DSQL は FK 非対応のため orphan pref/mastery が残ると anchor が silent no-op になり
			// write-skew を招く。deleteChild が preferences/mastery を同 txn で cascade 除去し orphan を
			// 生じさせないことを [C7] で検証し、cascade からの脱落を regression として捕捉する。
			await t.db.execute(sql`
				INSERT INTO child_activity_preferences (family_id, child_id, activity_id, is_pinned, pin_order)
				VALUES (${FAMILY}, ${childId}, ${activityId}, true, 1)
			`);
			await t.db.execute(sql`
				INSERT INTO activity_mastery (family_id, child_id, activity_id, total_count, level)
				VALUES (${FAMILY}, ${childId}, ${activityId}, 3, 1)
			`);
			await t.db.execute(sql`
				INSERT INTO point_ledger (family_id, child_id, amount, type, recorded_date)
				VALUES (${FAMILY}, ${childId}, 10, 'activity', '2026-07-04')
			`);
			const card = await t.db.execute(sql`
				INSERT INTO stamp_cards (family_id, child_id, week_start, week_end)
				VALUES (${FAMILY}, ${childId}, '2026-06-29', '2026-07-05') RETURNING card_id
			`);
			await t.db.execute(sql`
				INSERT INTO stamp_entries (family_id, card_id, slot, login_date)
				VALUES (${FAMILY}, ${(card.rows[0] as { card_id: string }).card_id}, 1, '2026-07-01')
			`);
		};
		await seed(String(target.id));
		await seed(String(sibling.id));
		await t.db.execute(sql`
			INSERT INTO sibling_cheers (family_id, from_child_id, to_child_id, stamp_code)
			VALUES (${FAMILY}, ${String(target.id)}, ${String(sibling.id)}, 'star')
		`);

		await repo.deleteChild(target.id, FAMILY);

		expect(await repo.findChildById(target.id, FAMILY)).toBeUndefined();
		const countFor = async (table: string, childId: string) =>
			Number(
				(
					(await t.db.execute(
						sql`SELECT count(*) AS c FROM ${sql.raw(table)} WHERE family_id = ${FAMILY} AND child_id = ${childId}`,
					)) as { rows: { c: unknown }[] }
				).rows[0]?.c,
			);
		for (const table of [
			'child_activities',
			'activity_logs',
			'point_ledger',
			'stamp_cards',
			'child_activity_preferences', // #3592 ③ anchor 前提保証
			'activity_mastery', // #3592 ③ anchor 前提保証
		]) {
			expect(await countFor(table, String(target.id)), `${table} 消滅`).toBe(0);
			expect(await countFor(table, String(sibling.id)), `${table} 兄弟 survive`).toBe(1);
		}
		const cheers = await t.db.execute(
			sql`SELECT count(*) AS c FROM sibling_cheers WHERE family_id = ${FAMILY}`,
		);
		expect(Number((cheers.rows[0] as { c: unknown }).c)).toBe(0); // from 側参照でも消える
		const entries = await t.db.execute(sql`
			SELECT count(*) AS c FROM stamp_entries WHERE family_id = ${FAMILY}
		`);
		expect(Number((entries.rows[0] as { c: unknown }).c)).toBe(1); // 兄弟 card の entry のみ残存
	});

	it('[C7b] #3584 ②: deleteChild が mid-txn で失敗すると部分削除は全て rollback される (原子性)', async () => {
		// [C7] は正常系のみ。本 test は txn 途中で失敗を注入し、先行した DELETE が
		// rollback されて全表が元に戻ることを実証する (TransactionRunner の atomicity を回帰固定。
		// FK/CASCADE 非対応 DSQL では repo の明示 DELETE 列が唯一の整合性装置のため、部分失敗で
		// 「一部の表だけ消えた child」が残ると復旧不能な半壊状態になる)。
		const victim = await repo.insertChild({ nickname: '巻戻対象', age: 7 }, FAMILY);
		const vid = String(victim.id);
		const act = await t.db.execute(sql`
			INSERT INTO child_activities (family_id, child_id, name, category_id, icon)
			VALUES (${FAMILY}, ${vid}, '巻戻活動', '1', '🏃') RETURNING activity_id
		`);
		const activityId = (act.rows[0] as { activity_id: string }).activity_id;
		await t.db.execute(sql`
			INSERT INTO activity_logs (family_id, child_id, activity_id, points, recorded_date, recorded_at)
			VALUES (${FAMILY}, ${vid}, ${activityId}, 10, '2026-07-05', now())
		`);
		await t.db.execute(sql`
			INSERT INTO point_ledger (family_id, child_id, amount, type, recorded_date)
			VALUES (${FAMILY}, ${vid}, 10, 'activity', '2026-07-05')
		`);

		// 失敗注入 runner: work に渡す tx を proxy し、N 回目以降の execute で throw する。
		// CHILD_SCOPED_TABLES 先頭数表の DELETE を実行させた後に失敗させる (= 部分削除状態を作る)。
		const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 1, baseDelayMs: 1 });
		const failAfter = 4;
		const failingRunner: typeof runner = {
			runInTransaction: (work) =>
				runner.runInTransaction((tx) => {
					let calls = 0;
					const proxy = new Proxy(tx as object, {
						get(target, prop, receiver) {
							if (prop === 'execute') {
								return (...args: unknown[]) => {
									calls++;
									if (calls > failAfter) throw new Error('inject: mid-txn failure (#3584②)');
									return (target as { execute: (...a: unknown[]) => Promise<unknown> }).execute(
										...args,
									);
								};
							}
							return Reflect.get(target, prop, receiver);
						},
					});
					return work(proxy as Parameters<typeof work>[0]);
				}),
		};
		const failingRepo = createDsqlChildRepo(t.db, failingRunner);

		await expect(failingRepo.deleteChild(victim.id, FAMILY)).rejects.toThrow(
			'inject: mid-txn failure',
		);

		// 全表が元のまま (先行 DELETE 分も rollback 済み = 半壊 child が残らない)
		const countFor = async (table: string) =>
			Number(
				(
					(await t.db.execute(
						sql`SELECT count(*) AS c FROM ${sql.raw(table)} WHERE family_id = ${FAMILY} AND child_id = ${vid}`,
					)) as { rows: { c: unknown }[] }
				).rows[0]?.c,
			);
		expect(await repo.findChildById(victim.id, FAMILY), 'child 本体が残存').toBeTruthy();
		expect(await countFor('child_activities'), 'child_activities rollback').toBe(1);
		expect(await countFor('activity_logs'), 'activity_logs rollback').toBe(1);
		expect(await countFor('point_ledger'), 'point_ledger rollback').toBe(1);

		// 後始末 (正常 runner で本削除)
		await repo.deleteChild(victim.id, FAMILY);
	});

	it('[C8] resetChildProgressData: allowlist 3 表 + total_point 0 (statuses は survive)', async () => {
		const c = await repo.insertChild({ nickname: 'リセット', age: 8 }, FAMILY);
		const id = String(c.id);
		await t.db.execute(sql`
			INSERT INTO point_ledger (family_id, child_id, amount, type, recorded_date)
			VALUES (${FAMILY}, ${id}, 30, 'activity', '2026-07-04'), (${FAMILY}, ${id}, 20, 'bonus', '2026-07-04')
		`);
		await t.db.execute(
			sql`UPDATE children SET total_point = 50 WHERE family_id = ${FAMILY} AND child_id = ${id}`,
		);
		await t.db.execute(sql`
			INSERT INTO login_streaks (family_id, child_id, last_login_date, current_streak)
			VALUES (${FAMILY}, ${id}, '2026-07-04', 3)
		`);
		await t.db.execute(sql`
			INSERT INTO statuses (family_id, child_id, category_id, total_xp, updated_at)
			VALUES (${FAMILY}, ${id}, '1', 100, now())
		`);

		const counts = await repo.resetChildProgressData(c.id, FAMILY);
		expect(counts).toEqual({
			activityLogs: 0,
			pointLedger: 2,
			loginBonuses: 1,
			childAchievements: 0,
			pointBalance: 0,
		});
		const status = await t.db.execute(
			sql`SELECT total_xp FROM statuses WHERE family_id = ${FAMILY} AND child_id = ${id}`,
		);
		expect((status.rows[0] as { total_xp: number }).total_xp).toBe(100); // survive 契約
		const tp = await t.db.execute(
			sql`SELECT total_point FROM children WHERE family_id = ${FAMILY} AND child_id = ${id}`,
		);
		expect((tp.rows[0] as { total_point: number }).total_point).toBe(0); // fitness#14 整合
	});

	it('branded id が repo 境界で維持される (ChildId 受け渡しの型整合)', () => {
		// compile-time 検証: asChildId 以外の string を渡すと型エラーになる (実行時 assert 不要)
		const id = asChildId('00000000-0000-4000-8000-00000000ffff');
		const _catId = asCategoryId('1');
		const _actId = asActivityId('x');
		expect(typeof id).toBe('string');
	});
});
