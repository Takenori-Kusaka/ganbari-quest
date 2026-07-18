// tests/unit/db/dsql-checklist-repo.test.ts
// EPIC #3424 / PR-R7 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §5 / §10 / §11.2 / §P9
//
// DSQL IChecklistRepo 実装のテスト。実 schema (pushSchema 適用、dsql-test-db helper)。
// checklist は child-cluster 最複雑 = ADR-0055 family master template + per-child assignments
// + per-child progress(logs) + per-child override モデル (docs/design/dsql-data-model.md §10)。
//
// ── Templates (family master) ──
//   [T1] insertTemplate + findTemplateById round-trip (default 値 / 0-1 契約 / tenantId=family)
//   [T2] findTemplatesByTenant: includeInactive filter + archived 除外 + §P9 tenant 分離
//   [T3] updateTemplate: 部分更新 + updated_at 更新 + §P9 (他 tenant は no-op)
//   [T4] deleteTemplate: cascade (assignments / items / logs / log_items 消去) + §P9
// ── Distribution (assignments = 配信) ──
//   [A1] assignTemplateToChildren: only-new 返却 + 既配信 skip + tenant 境界 (他 family template→0)
//   [A2] findAssignmentsByTemplate / findAssignmentsByChild + §P9
//   [A3] unassignTemplateFromChildren (subset / 空 no-op) + unassignTemplate (全解除)
// ── Templates by child (assignments join) ──
//   [C1] findTemplatesByChild: 配信済 template のみ (assignments join) / includeArchived /
//        includeInactive / cross-child 分離 / §P9
//   [CP1] copy (別の子から取込) = assignments 追加。同一 family template を 2 人目に配信しても
//         template は複製されず (family 1 レコード) 両 child の findTemplatesByChild が同一 id を返す
// ── Items ──
//   [I1] insertTemplateItem + findTemplateItems (sort_order 順) + §P9
//   [I2] deleteTemplateItem: (templateId, id) composite — 別 template を名乗った削除は no-op
// ── Logs (§5 items_json text 据置: itemsJson は items_json 列に verbatim 保存、子表化しない) ──
//   [L1] upsertLog insert → findTodayLog が items_json を verbatim 返す +
//        completedAll 0/1 + pointsAwarded + §P9 / cross-child 分離
//   [L2] upsertLog update (再 upsert): items_json 集合を置換 + created_at 保全
//   [L3] findLogsByChild: 複数日をバルク取得 (checked_date desc) + §P9
//   [L4] items_json 据置: checked 集合を verbatim 保存 / 空 itemsJson → 空配列
// ── Overrides ──
//   [O1] insertOverride + findOverrides (child × date) + §P9
//   [O2] findOverridesByChild (全日) + insertOverrideForRestore (createdAt verbatim 保全)
//   [O3] deleteOverride: (childId, id) composite — 別 child を名乗った削除は no-op
// ── archive / restore ──
//   [R1] archiveChecklistTemplates(ids, reason) → findTemplatesByTenant から除外 +
//        restoreArchivedChecklistTemplates(reason) 復元 + §P9
// ── tenant bulk delete ──
//   [D1] deleteByTenantId: 全 6 表を tenant 限定削除、他 tenant 無傷
// ── CHECK / UNIQUE 実効 ──
//   [X1] time_slot CHECK / override action CHECK / assignment PK 二重 / log PK 二重 を直接 INSERT で拒否

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asChildId, type ChildId } from '../../../src/lib/domain/ids';
import { createDsqlChecklistRepo } from '../../../src/lib/server/db/dsql/checklist-repo';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { SqlExecutor } from '../../../src/lib/server/db/dsql/sql-executor';
import type { IChecklistRepo } from '../../../src/lib/server/db/interfaces/checklist-repo.interface';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import type { TransactionRunner } from '../../../src/lib/server/db/interfaces/transaction.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000d1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000d2';
// tenant-wide list assertion (findTemplatesByTenant / archive / deleteByTenantId) 用の隔離 family。
const FAM_T2 = '00000000-0000-4000-8000-0000000000d3';
const FAM_R1 = '00000000-0000-4000-8000-0000000000d4';
const FAM_D1 = '00000000-0000-4000-8000-0000000000d5';
const UUID_RE = /^[0-9a-f-]{36}$/;

const sortedIds = (json: string): string[] => (JSON.parse(json) as string[]).slice().sort();

describe('DSQL checklist-repo (PR-R7、実 schema PGlite、family master + per-child)', () => {
	let t: DsqlTestDb;
	let childRepo: IChildRepo;
	let repo: IChecklistRepo;
	let runner: TransactionRunner<SqlExecutor>;

	const newChild = async (nickname: string, family = FAMILY): Promise<ChildId> => {
		const c = await childRepo.insertChild({ nickname, age: 8, birthDate: '2018-01-15' }, family);
		return c.id;
	};

	const countRows = async (query: ReturnType<typeof sql>): Promise<number> => {
		const r = await t.db.execute(query);
		return Number((r.rows[0] as { c: unknown }).c);
	};

	beforeAll(async () => {
		t = await createDsqlTestDb();
		runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		childRepo = createDsqlChildRepo(t.db, runner);
		repo = createDsqlChecklistRepo(t.db, runner);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// ─────────────────── Templates (family master) ───────────────────

	it('[T1] insertTemplate + findTemplateById: round-trip (default / 0-1 契約 / tenantId=family)', async () => {
		const created = await repo.insertTemplate({ name: 'あさのしたく' }, FAMILY);
		expect(created.id).toMatch(UUID_RE);
		expect(created.tenantId).toBe(FAMILY);
		expect(created.name).toBe('あさのしたく');
		expect(created.icon).toBe('📋'); // schema default
		expect(created.pointsPerItem).toBe(2);
		expect(created.completionBonus).toBe(5);
		expect(created.timeSlot).toBe('anytime');
		expect(created.isActive).toBe(1); // 0/1 契約
		expect(created.isArchived).toBe(0);
		expect(created.archivedReason).toBe(null);
		expect(created.sourcePresetId).toBe(null); // 非取込は null (#3601 Gap B)
		expect(typeof created.createdAt).toBe('string');

		const found = await repo.findTemplateById(created.id, FAMILY);
		expect(found?.id).toBe(created.id);
		expect(found?.name).toBe('あさのしたく');
		// §P9: 他 family からは不可視
		expect(await repo.findTemplateById(created.id, OTHER_FAMILY)).toBe(undefined);
	});

	it('[T1b] insertTemplate: sourcePresetId 永続 (#3601 Gap B、marketplace 取込帰属)', async () => {
		const created = await repo.insertTemplate(
			{ name: 'イベント持ち物', sourcePresetId: 'event-pool' },
			FAMILY,
		);
		expect(created.sourcePresetId).toBe('event-pool');
		// read 経路でも保全 (toTemplate が source_preset_id を verbatim 返す)
		const found = await repo.findTemplateById(created.id, FAMILY);
		expect(found?.sourcePresetId).toBe('event-pool');
	});

	it('[T2] findTemplatesByTenant: includeInactive filter + archived 除外 + §P9', async () => {
		const active = await repo.insertTemplate({ name: 'active', isActive: 1 }, FAM_T2);
		const inactive = await repo.insertTemplate({ name: 'inactive', isActive: 0 }, FAM_T2);
		const archived = await repo.insertTemplate({ name: 'archived' }, FAM_T2);
		await repo.archiveChecklistTemplates([archived.id], 'trial_expired', FAM_T2);

		// 既定: active のみ (inactive + archived 除外)
		const def = await repo.findTemplatesByTenant(FAM_T2);
		expect(def.map((r) => r.id).sort()).toEqual([active.id].sort());

		// includeInactive: active + inactive (archived は依然除外)
		const withInactive = await repo.findTemplatesByTenant(FAM_T2, true);
		expect(withInactive.map((r) => r.id).sort()).toEqual([active.id, inactive.id].sort());

		// §P9
		expect(await repo.findTemplatesByTenant(FAMILY)).not.toContainEqual(
			expect.objectContaining({ id: active.id }),
		);
	});

	it('[T3] updateTemplate: 部分更新 + updated_at 更新 + §P9 no-op', async () => {
		const tpl = await repo.insertTemplate(
			{ name: 'まえ', pointsPerItem: 2, timeSlot: 'morning' },
			FAMILY,
		);
		const updated = await repo.updateTemplate(tpl.id, { name: 'あと', pointsPerItem: 9 }, FAMILY);
		expect(updated?.name).toBe('あと');
		expect(updated?.pointsPerItem).toBe(9);
		expect(updated?.timeSlot).toBe('morning'); // 未指定は不変
		expect(Date.parse(updated?.updatedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(tpl.updatedAt));

		// §P9: 他 tenant を名乗った update は no-op (undefined) + 実データ不変
		expect(await repo.updateTemplate(tpl.id, { name: 'X' }, OTHER_FAMILY)).toBe(undefined);
		expect((await repo.findTemplateById(tpl.id, FAMILY))?.name).toBe('あと');
	});

	it('[T4] deleteTemplate: cascade (assignments / items / logs、items_json 据置) + §P9', async () => {
		const child = await newChild('カスケード太郎');
		const tpl = await repo.insertTemplate({ name: 'けす' }, FAMILY);
		const item = await repo.insertTemplateItem({ templateId: tpl.id, name: 'ぼうし' }, FAMILY);
		await repo.assignTemplateToChildren(tpl.id, [child], FAMILY);
		await repo.upsertLog(
			{
				childId: child,
				templateId: tpl.id,
				checkedDate: '2026-07-01',
				itemsJson: JSON.stringify([item.id]),
				completedAll: 1,
				pointsAwarded: 7,
			},
			FAMILY,
		);

		// §P9: 他 tenant を名乗った delete は no-op
		await repo.deleteTemplate(tpl.id, OTHER_FAMILY);
		expect(await repo.findTemplateById(tpl.id, FAMILY)).toBeDefined();

		await repo.deleteTemplate(tpl.id, FAMILY);
		expect(await repo.findTemplateById(tpl.id, FAMILY)).toBe(undefined);
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM checklist_template_assignments WHERE template_id = ${tpl.id}`,
			),
		).toBe(0);
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM checklist_template_items WHERE template_id = ${tpl.id}`,
			),
		).toBe(0);
		expect(
			await countRows(sql`SELECT count(*) AS c FROM checklist_logs WHERE template_id = ${tpl.id}`),
		).toBe(0);
	});

	// ─────────────────── Distribution (assignments) ───────────────────

	it('[A1] assignTemplateToChildren: only-new 返却 + 既配信 skip + tenant 境界', async () => {
		const a = await newChild('配信A');
		const b = await newChild('配信B');
		const tpl = await repo.insertTemplate({ name: 'くばる' }, FAMILY);

		const first = await repo.assignTemplateToChildren(tpl.id, [a, b], FAMILY);
		expect(first.map((r) => r.childId).sort()).toEqual([a, b].sort());
		expect(first[0]?.templateId).toBe(tpl.id);

		// 既配信 a は skip、新規 c のみ返る
		const c = await newChild('配信C');
		const second = await repo.assignTemplateToChildren(tpl.id, [a, c], FAMILY);
		expect(second.map((r) => r.childId)).toEqual([c]);

		// tenant 境界: 他 family template を名乗った配信は 0 件 (orphan assignment を作らない)
		const foreign = await repo.assignTemplateToChildren(tpl.id, [a], OTHER_FAMILY);
		expect(foreign).toEqual([]);
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM checklist_template_assignments WHERE family_id = ${OTHER_FAMILY} AND template_id = ${tpl.id}`,
			),
		).toBe(0);

		// 空配列は no-op
		expect(await repo.assignTemplateToChildren(tpl.id, [], FAMILY)).toEqual([]);
	});

	// #3603 ①: DSQL は FK 非対応。存在しない child_id への orphan assignment を children JOIN で
	// 構造排除する (同 family でも children に無い child は 0 行 emit で挿入されない)。
	it('[A1b] assignTemplateToChildren: 存在しない child は JOIN で構造排除 (orphan を作らない)', async () => {
		const real = await newChild('実在配信');
		const ghost = asChildId('00000000-0000-4000-8000-0000009999e1'); // children 未登録
		const tpl = await repo.insertTemplate({ name: 'ゴースト配信' }, FAMILY);

		const result = await repo.assignTemplateToChildren(tpl.id, [ghost, real], FAMILY);
		// 実在 child のみ配信され、ghost は載らない
		expect(result.map((r) => r.childId)).toEqual([real]);
		// ghost の orphan assignment 行は物理的に存在しない
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM checklist_template_assignments
					WHERE family_id = ${FAMILY} AND template_id = ${tpl.id} AND child_id = ${String(ghost)}`,
			),
		).toBe(0);
	});

	it('[A2] findAssignmentsByTemplate / findAssignmentsByChild + §P9', async () => {
		const a = await newChild('照会A');
		const b = await newChild('照会B');
		const tpl = await repo.insertTemplate({ name: 'しらべる' }, FAMILY);
		await repo.assignTemplateToChildren(tpl.id, [a, b], FAMILY);

		const byTpl = await repo.findAssignmentsByTemplate(tpl.id, FAMILY);
		expect(byTpl.map((r) => r.childId).sort()).toEqual([a, b].sort());
		expect(await repo.findAssignmentsByTemplate(tpl.id, OTHER_FAMILY)).toEqual([]);

		const byChild = await repo.findAssignmentsByChild(a, FAMILY);
		expect(byChild.some((r) => r.templateId === tpl.id)).toBe(true);
		expect(await repo.findAssignmentsByChild(a, OTHER_FAMILY)).toEqual([]);
	});

	it('[A2b] #3581 ②: findAssignmentsByChild は非 uuid id で throw せず空配列 (22P02 正規化)', async () => {
		// checklist toggle action (child POST) が stale cookie 由来の旧数値 id を最初に渡す repo 経路。
		// guard 無しだと WHERE child_id = <非uuid> で 22P02 throw → 500。空配列 = 「配信なし」に正規化。
		await expect(repo.findAssignmentsByChild(asChildId('3'), FAMILY)).resolves.toEqual([]);
		await expect(repo.findAssignmentsByChild(asChildId('not-a-uuid'), FAMILY)).resolves.toEqual([]);
		await expect(repo.findAssignmentsByChild(asChildId(''), FAMILY)).resolves.toEqual([]);
	});

	it('[A3] unassignTemplateFromChildren (subset / 空 no-op) + unassignTemplate (全解除)', async () => {
		const a = await newChild('解除A');
		const b = await newChild('解除B');
		const c = await newChild('解除C');
		const tpl = await repo.insertTemplate({ name: 'はずす' }, FAMILY);
		await repo.assignTemplateToChildren(tpl.id, [a, b, c], FAMILY);

		// 空配列 no-op
		await repo.unassignTemplateFromChildren(tpl.id, [], FAMILY);
		expect((await repo.findAssignmentsByTemplate(tpl.id, FAMILY)).length).toBe(3);

		// subset 解除 (a のみ)
		await repo.unassignTemplateFromChildren(tpl.id, [a], FAMILY);
		expect(
			(await repo.findAssignmentsByTemplate(tpl.id, FAMILY)).map((r) => r.childId).sort(),
		).toEqual([b, c].sort());

		// §P9: 他 tenant を名乗った解除は no-op
		await repo.unassignTemplateFromChildren(tpl.id, [b], OTHER_FAMILY);
		expect((await repo.findAssignmentsByTemplate(tpl.id, FAMILY)).length).toBe(2);

		// 全解除
		await repo.unassignTemplate(tpl.id, FAMILY);
		expect(await repo.findAssignmentsByTemplate(tpl.id, FAMILY)).toEqual([]);
	});

	// ─────────────────── Templates by child ───────────────────

	it('[C1] findTemplatesByChild: 配信済のみ / includeArchived / includeInactive / cross-child / §P9', async () => {
		const a = await newChild('子視点A');
		const b = await newChild('子視点B');
		const active = await repo.insertTemplate({ name: 'active-c', isActive: 1 }, FAMILY);
		const inactive = await repo.insertTemplate({ name: 'inactive-c', isActive: 0 }, FAMILY);
		const archived = await repo.insertTemplate({ name: 'archived-c' }, FAMILY);
		await repo.assignTemplateToChildren(active.id, [a], FAMILY);
		await repo.assignTemplateToChildren(inactive.id, [a], FAMILY);
		await repo.assignTemplateToChildren(archived.id, [a], FAMILY);
		await repo.archiveChecklistTemplates([archived.id], 'trial_expired', FAMILY);

		// 既定: 配信済 かつ active かつ 非 archived のみ → active-c だけ
		const def = await repo.findTemplatesByChild(a, FAMILY);
		expect(def.map((r) => r.id)).toEqual([active.id]);

		// includeInactive
		const withInactive = await repo.findTemplatesByChild(a, FAMILY, true);
		expect(withInactive.map((r) => r.id).sort()).toEqual([active.id, inactive.id].sort());

		// includeArchived (+ includeInactive) → 3 件
		const all = await repo.findTemplatesByChild(a, FAMILY, true, true);
		expect(all.map((r) => r.id).sort()).toEqual([active.id, inactive.id, archived.id].sort());

		// cross-child: b には未配信 → 空
		expect(await repo.findTemplatesByChild(b, FAMILY, true, true)).toEqual([]);
		// §P9
		expect(await repo.findTemplatesByChild(a, OTHER_FAMILY, true, true)).toEqual([]);
	});

	it('[CP1] copy = assignments 追加: template は複製されず 2 child が同一 template id を共有', async () => {
		const a = await newChild('コピー元');
		const b = await newChild('コピー先');
		const tpl = await repo.insertTemplate({ name: 'きょうつう' }, FAMILY);
		await repo.assignTemplateToChildren(tpl.id, [a], FAMILY);

		// 「別の子から取込」= 同一 family template を b にも配信 (assignments 追加のみ)
		await repo.assignTemplateToChildren(tpl.id, [b], FAMILY);

		const forA = await repo.findTemplatesByChild(a, FAMILY);
		const forB = await repo.findTemplatesByChild(b, FAMILY);
		expect(forA.map((r) => r.id)).toEqual([tpl.id]);
		expect(forB.map((r) => r.id)).toEqual([tpl.id]); // 複製でなく同一 id
		// template は family に 1 レコードのまま
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM checklist_templates WHERE family_id = ${FAMILY} AND template_id = ${tpl.id}`,
			),
		).toBe(1);
	});

	// ─────────────────── Items ───────────────────

	it('[I1] insertTemplateItem + findTemplateItems (sort_order 順) + §P9', async () => {
		const tpl = await repo.insertTemplate({ name: 'もちもの' }, FAMILY);
		const i2 = await repo.insertTemplateItem(
			{ templateId: tpl.id, name: 'ふでばこ', sortOrder: 2 },
			FAMILY,
		);
		const i1 = await repo.insertTemplateItem(
			{ templateId: tpl.id, name: 'きょうかしょ', sortOrder: 1, icon: '📗', direction: 'take' },
			FAMILY,
		);
		expect(i1.id).toMatch(UUID_RE);
		expect(i1.templateId).toBe(tpl.id);
		expect(i1.icon).toBe('📗');
		expect(i1.direction).toBe('take');
		expect(i2.icon).toBe('🏫'); // schema default

		const items = await repo.findTemplateItems(tpl.id, FAMILY);
		expect(items.map((r) => r.id)).toEqual([i1.id, i2.id]); // sort_order 昇順
		// §P9
		expect(await repo.findTemplateItems(tpl.id, OTHER_FAMILY)).toEqual([]);
	});

	it('[I2] deleteTemplateItem: (templateId, id) composite — 別 template 名乗りは no-op', async () => {
		const tpl = await repo.insertTemplate({ name: 'こうさく' }, FAMILY);
		const other = await repo.insertTemplate({ name: 'べつ' }, FAMILY);
		const item = await repo.insertTemplateItem({ templateId: tpl.id, name: 'のり' }, FAMILY);

		// 別 template を名乗った削除は no-op (composite key 不一致)
		await repo.deleteTemplateItem(other.id, item.id, FAMILY);
		expect((await repo.findTemplateItems(tpl.id, FAMILY)).length).toBe(1);

		await repo.deleteTemplateItem(tpl.id, item.id, FAMILY);
		expect(await repo.findTemplateItems(tpl.id, FAMILY)).toEqual([]);
	});

	// #3603 ①: DSQL は FK 非対応。存在しない / 他 family の template_id を名乗った item 挿入を
	// INSERT ... SELECT FROM checklist_templates で構造排除する (0 行 emit → orphan item を作らず
	// loud に throw。silent drop しない安全側)。assignTemplateToChildren の children JOIN と同型。
	it('[I1c] insertTemplateItem: 存在しない / 他 family template は orphan item を作らず throw', async () => {
		const ghostTemplateId = '00000000-0000-4000-8000-00000000f001'; // templates 未登録
		await expect(
			repo.insertTemplateItem({ templateId: ghostTemplateId, name: 'ゴースト item' }, FAMILY),
		).rejects.toThrow();
		// orphan item 行は物理的に存在しない
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM checklist_template_items
					WHERE family_id = ${FAMILY} AND template_id = ${ghostTemplateId}`,
			),
		).toBe(0);

		// 他 family の実在 template を名乗っても (tenant 越境) 0 行 → throw
		const foreignTpl = await repo.insertTemplate({ name: '他 family 帳票' }, OTHER_FAMILY);
		await expect(
			repo.insertTemplateItem({ templateId: foreignTpl.id, name: '越境 item' }, FAMILY),
		).rejects.toThrow();
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM checklist_template_items
					WHERE template_id = ${foreignTpl.id}`,
			),
		).toBe(0);
	});

	// ─────────────────── Logs (§5 items_json text 据置) ───────────────────

	it('[L1] upsertLog insert → findTodayLog が items_json を verbatim 返す', async () => {
		const child = await newChild('記録太郎');
		const tpl = await repo.insertTemplate({ name: 'にっか', pointsPerItem: 3 }, FAMILY);
		const i1 = await repo.insertTemplateItem({ templateId: tpl.id, name: 'A' }, FAMILY);
		const i2 = await repo.insertTemplateItem({ templateId: tpl.id, name: 'B' }, FAMILY);
		await repo.assignTemplateToChildren(tpl.id, [child], FAMILY);

		const saved = await repo.upsertLog(
			{
				childId: child,
				templateId: tpl.id,
				checkedDate: '2026-07-02',
				itemsJson: JSON.stringify([i1.id, i2.id]),
				completedAll: 1,
				pointsAwarded: 11,
			},
			FAMILY,
		);
		expect(saved.completedAll).toBe(1); // 0/1 契約
		expect(saved.pointsAwarded).toBe(11);

		const log = await repo.findTodayLog(child, tpl.id, '2026-07-02', FAMILY);
		expect(log).toBeDefined();
		// §5: itemsJson は items_json text 列に据置した JSON blob を verbatim 返す
		expect(sortedIds(log?.itemsJson ?? '[]')).toEqual([i1.id, i2.id].sort());
		expect(log?.completedAll).toBe(1);
		expect(log?.pointsAwarded).toBe(11);
		expect(log?.childId).toBe(child);
		expect(log?.templateId).toBe(tpl.id);

		// §P9 / cross-child 分離
		expect(await repo.findTodayLog(child, tpl.id, '2026-07-02', OTHER_FAMILY)).toBe(undefined);
		const stranger = await newChild('他人');
		expect(await repo.findTodayLog(stranger, tpl.id, '2026-07-02', FAMILY)).toBe(undefined);
	});

	it('[L2] upsertLog update: items_json 集合を置換 + created_at 保全', async () => {
		const child = await newChild('更新太郎');
		const tpl = await repo.insertTemplate({ name: 'こうしん' }, FAMILY);
		const i1 = await repo.insertTemplateItem({ templateId: tpl.id, name: 'A' }, FAMILY);
		const i2 = await repo.insertTemplateItem({ templateId: tpl.id, name: 'B' }, FAMILY);
		const i3 = await repo.insertTemplateItem({ templateId: tpl.id, name: 'C' }, FAMILY);

		const first = await repo.upsertLog(
			{
				childId: child,
				templateId: tpl.id,
				checkedDate: '2026-07-03',
				itemsJson: JSON.stringify([i1.id, i2.id]),
				completedAll: 0,
				pointsAwarded: 4,
			},
			FAMILY,
		);
		// 再 upsert: checked 集合 (items_json) を {i3} に置換
		await repo.upsertLog(
			{
				childId: child,
				templateId: tpl.id,
				checkedDate: '2026-07-03',
				itemsJson: JSON.stringify([i3.id]),
				completedAll: 0,
				pointsAwarded: 2,
			},
			FAMILY,
		);
		const log = await repo.findTodayLog(child, tpl.id, '2026-07-03', FAMILY);
		expect(sortedIds(log?.itemsJson ?? '[]')).toEqual([i3.id]); // i1/i2 は消え i3 のみ
		expect(log?.pointsAwarded).toBe(2);
		expect(log?.createdAt).toBe(first.createdAt); // 再 upsert で created_at は不変
		// 行は 1 件のまま (PK upsert)
		expect(
			await countRows(sql`
				SELECT count(*) AS c FROM checklist_logs
				WHERE family_id = ${FAMILY} AND child_id = ${String(child)}
					AND template_id = ${tpl.id} AND checked_date = '2026-07-03'
			`),
		).toBe(1);
	});

	it('[L3] findLogsByChild: 複数日をバルク取得 (checked_date desc) + §P9', async () => {
		const child = await newChild('バルク太郎');
		const tpl = await repo.insertTemplate({ name: 'まとめ' }, FAMILY);
		const item = await repo.insertTemplateItem({ templateId: tpl.id, name: 'A' }, FAMILY);
		for (const date of ['2026-07-01', '2026-07-05', '2026-07-03']) {
			await repo.upsertLog(
				{
					childId: child,
					templateId: tpl.id,
					checkedDate: date,
					itemsJson: JSON.stringify([item.id]),
					completedAll: 1,
					pointsAwarded: 5,
				},
				FAMILY,
			);
		}
		const logs = await repo.findLogsByChild(child, FAMILY);
		expect(logs.map((l) => l.checkedDate)).toEqual(['2026-07-05', '2026-07-03', '2026-07-01']);
		expect(sortedIds(logs[0]?.itemsJson ?? '[]')).toEqual([item.id]);
		expect(await repo.findLogsByChild(child, OTHER_FAMILY)).toEqual([]);
	});

	it('[L4] items_json 据置: checked 集合を verbatim 保存 / 空 itemsJson → 空配列', async () => {
		const child = await newChild('原子太郎');
		const tpl = await repo.insertTemplate({ name: 'げんし' }, FAMILY);
		const i1 = await repo.insertTemplateItem({ templateId: tpl.id, name: 'A' }, FAMILY);
		const i2 = await repo.insertTemplateItem({ templateId: tpl.id, name: 'B' }, FAMILY);

		await repo.upsertLog(
			{
				childId: child,
				templateId: tpl.id,
				checkedDate: '2026-07-06',
				itemsJson: JSON.stringify([i1.id, i2.id]),
				completedAll: 1,
				pointsAwarded: 4,
			},
			FAMILY,
		);
		const saved = await repo.findTodayLog(child, tpl.id, '2026-07-06', FAMILY);
		expect(sortedIds(saved?.itemsJson ?? '[]')).toEqual([i1.id, i2.id].sort());

		// 空 itemsJson → log 行は残り items_json は空配列
		await repo.upsertLog(
			{
				childId: child,
				templateId: tpl.id,
				checkedDate: '2026-07-06',
				itemsJson: JSON.stringify([]),
				completedAll: 0,
				pointsAwarded: 0,
			},
			FAMILY,
		);
		const log = await repo.findTodayLog(child, tpl.id, '2026-07-06', FAMILY);
		expect(JSON.parse(log?.itemsJson ?? 'null')).toEqual([]);
		// log 行自体は残る (items_json 空置換のみ、PK upsert)
		expect(
			await countRows(sql`
				SELECT count(*) AS c FROM checklist_logs
				WHERE family_id = ${FAMILY} AND child_id = ${String(child)}
					AND template_id = ${tpl.id} AND checked_date = '2026-07-06'
			`),
		).toBe(1);
	});

	// ─────────────────── Overrides ───────────────────

	it('[O1] insertOverride + findOverrides (child × date) + §P9', async () => {
		const child = await newChild('例外太郎');
		const ov = await repo.insertOverride(
			{ childId: child, targetDate: '2026-07-07', action: 'add', itemName: 'かさ', icon: '☂' },
			FAMILY,
		);
		expect(ov.id).toMatch(UUID_RE);
		expect(ov.action).toBe('add');
		expect(ov.itemName).toBe('かさ');

		const found = await repo.findOverrides(child, '2026-07-07', FAMILY);
		expect(found.map((r) => r.id)).toEqual([ov.id]);
		// 別日は空
		expect(await repo.findOverrides(child, '2026-07-08', FAMILY)).toEqual([]);
		// §P9
		expect(await repo.findOverrides(child, '2026-07-07', OTHER_FAMILY)).toEqual([]);
	});

	// #3603 ①: DSQL は FK 非対応。存在しない / 他 family の child_id を名乗った override 挿入を
	// INSERT ... SELECT FROM children で構造排除する (0 行 emit → orphan override を作らず loud に
	// throw)。assignTemplateToChildren の children JOIN と同型。insertOverrideForRestore (backup
	// restore 経路) は child 復元順序に依存するため本 guard 対象外 (issue #3603 ① scope)。
	it('[O1b] insertOverride: 存在しない / 他 family child は orphan override を作らず throw', async () => {
		const ghostChild = asChildId('00000000-0000-4000-8000-0000009999f1'); // children 未登録
		await expect(
			repo.insertOverride(
				{ childId: ghostChild, targetDate: '2026-07-07', action: 'add', itemName: 'ゴースト' },
				FAMILY,
			),
		).rejects.toThrow();
		// orphan override 行は物理的に存在しない
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM checklist_overrides
					WHERE family_id = ${FAMILY} AND child_id = ${String(ghostChild)}`,
			),
		).toBe(0);

		// 他 family の実在 child を名乗っても (tenant 越境) 0 行 → throw
		const foreignChild = await newChild('他 family っ子', OTHER_FAMILY);
		await expect(
			repo.insertOverride(
				{ childId: foreignChild, targetDate: '2026-07-07', action: 'add', itemName: '越境' },
				FAMILY,
			),
		).rejects.toThrow();
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM checklist_overrides
					WHERE family_id = ${FAMILY} AND child_id = ${String(foreignChild)}`,
			),
		).toBe(0);
	});

	it('[O2] findOverridesByChild (全日) + insertOverrideForRestore (createdAt verbatim)', async () => {
		const child = await newChild('復元太郎');
		await repo.insertOverride(
			{ childId: child, targetDate: '2026-07-10', action: 'remove', itemName: 'A' },
			FAMILY,
		);
		const restored = await repo.insertOverrideForRestore(
			{
				childId: child,
				targetDate: '2026-06-01',
				action: 'add',
				itemName: 'B',
				icon: '📦',
				createdAt: '2025-12-24T08:00:00+00:00',
			},
			FAMILY,
		);
		// verbatim 保全: insertOverride と違い createdAt を default(now) に落とさない
		// #3394 統一冪等契約: fresh 行の restore は必ず non-null (null = 重複 skip)
		if (!restored) throw new Error('insertForRestore returned null for fresh row');
		expect(Date.parse(restored.createdAt)).toBe(Date.parse('2025-12-24T08:00:00+00:00'));

		const all = await repo.findOverridesByChild(child, FAMILY);
		expect(all.map((r) => r.targetDate)).toEqual(['2026-06-01', '2026-07-10']); // target_date 昇順
		expect(await repo.findOverridesByChild(child, OTHER_FAMILY)).toEqual([]);
	});

	it('[O3] deleteOverride: (childId, id) composite — 別 child 名乗りは no-op', async () => {
		const child = await newChild('削除太郎');
		const stranger = await newChild('無関係太郎');
		const ov = await repo.insertOverride(
			{ childId: child, targetDate: '2026-07-11', action: 'add', itemName: 'A' },
			FAMILY,
		);
		// 別 child を名乗った削除は no-op
		await repo.deleteOverride(stranger, ov.id, FAMILY);
		expect((await repo.findOverrides(child, '2026-07-11', FAMILY)).length).toBe(1);

		await repo.deleteOverride(child, ov.id, FAMILY);
		expect(await repo.findOverrides(child, '2026-07-11', FAMILY)).toEqual([]);
	});

	// ─────────────────── archive / restore ───────────────────

	it('[R1] archiveChecklistTemplates → findTemplatesByTenant 除外 → restore 復元 + §P9', async () => {
		const keep = await repo.insertTemplate({ name: 'のこす' }, FAM_R1);
		const gone = await repo.insertTemplate({ name: 'アーカイブ' }, FAM_R1);
		await repo.archiveChecklistTemplates([gone.id], 'downgrade_user_selected', FAM_R1);

		expect((await repo.findTemplatesByTenant(FAM_R1)).map((r) => r.id)).toEqual([keep.id]);
		expect((await repo.findTemplateById(gone.id, FAM_R1))?.isArchived).toBe(1);
		expect((await repo.findTemplateById(gone.id, FAM_R1))?.archivedReason).toBe(
			'downgrade_user_selected',
		);

		// §P9: 他 tenant の archive は本 family に影響しない (reason filter restore)
		await repo.restoreArchivedChecklistTemplates('downgrade_user_selected', OTHER_FAMILY);
		expect((await repo.findTemplateById(gone.id, FAM_R1))?.isArchived).toBe(1);

		await repo.restoreArchivedChecklistTemplates('downgrade_user_selected', FAM_R1);
		expect((await repo.findTemplateById(gone.id, FAM_R1))?.isArchived).toBe(0);
		expect((await repo.findTemplateById(gone.id, FAM_R1))?.archivedReason).toBe(null);
		expect((await repo.findTemplatesByTenant(FAM_R1)).map((r) => r.id).sort()).toEqual(
			[keep.id, gone.id].sort(),
		);
	});

	// ─────────────────── tenant bulk delete ───────────────────

	it('[D1] deleteByTenantId: 全 5 表を tenant 限定削除、他 tenant 無傷', async () => {
		const victim = await newChild('全消し', FAM_D1);
		const keeper = await newChild('無傷', FAMILY);
		const vTpl = await repo.insertTemplate({ name: 'victim' }, FAM_D1);
		const vItem = await repo.insertTemplateItem({ templateId: vTpl.id, name: 'A' }, FAM_D1);
		await repo.assignTemplateToChildren(vTpl.id, [victim], FAM_D1);
		await repo.upsertLog(
			{
				childId: victim,
				templateId: vTpl.id,
				checkedDate: '2026-07-01',
				itemsJson: JSON.stringify([vItem.id]),
				completedAll: 1,
				pointsAwarded: 3,
			},
			FAM_D1,
		);
		await repo.insertOverride(
			{ childId: victim, targetDate: '2026-07-01', action: 'add', itemName: 'X' },
			FAM_D1,
		);
		// 無傷側
		const kTpl = await repo.insertTemplate({ name: 'keep' }, FAMILY);
		await repo.assignTemplateToChildren(kTpl.id, [keeper], FAMILY);

		await repo.deleteByTenantId(FAM_D1);

		for (const table of [
			'checklist_templates',
			'checklist_template_items',
			'checklist_template_assignments',
			'checklist_logs',
			'checklist_overrides',
		]) {
			expect(
				await countRows(
					sql`SELECT count(*) AS c FROM ${sql.raw(table)} WHERE family_id = ${FAM_D1}`,
				),
			).toBe(0);
		}
		// 他 tenant は無傷
		expect(await repo.findTemplateById(kTpl.id, FAMILY)).toBeDefined();
		expect((await repo.findAssignmentsByChild(keeper, FAMILY)).length).toBe(1);
	});

	// ─────────────────── CHECK / UNIQUE 実効 ───────────────────

	it('[X1] CHECK / UNIQUE / PK 二重を直接 INSERT で拒否', async () => {
		const child = await newChild('制約太郎');
		// time_slot CHECK
		await expect(
			t.db.execute(sql`
				INSERT INTO checklist_templates (family_id, name, time_slot)
				VALUES (${FAMILY}, 'bad', 'bogus')
			`),
		).rejects.toThrow();
		// override action CHECK
		await expect(
			t.db.execute(sql`
				INSERT INTO checklist_overrides (family_id, child_id, target_date, action, item_name)
				VALUES (${FAMILY}, ${String(child)}, '2026-07-01', 'bogus', 'X')
			`),
		).rejects.toThrow();

		// assignment PK 二重
		const tpl = await repo.insertTemplate({ name: 'ゆに' }, FAMILY);
		await repo.assignTemplateToChildren(tpl.id, [child], FAMILY);
		await expect(
			t.db.execute(sql`
				INSERT INTO checklist_template_assignments (family_id, template_id, child_id)
				VALUES (${FAMILY}, ${tpl.id}, ${String(child)})
			`),
		).rejects.toThrow();

		// log PK 二重 (family, child, template, checked_date)
		await t.db.execute(sql`
			INSERT INTO checklist_logs (family_id, child_id, template_id, checked_date)
			VALUES (${FAMILY}, ${String(child)}, ${tpl.id}, '2026-07-09')
		`);
		await expect(
			t.db.execute(sql`
				INSERT INTO checklist_logs (family_id, child_id, template_id, checked_date)
				VALUES (${FAMILY}, ${String(child)}, ${tpl.id}, '2026-07-09')
			`),
		).rejects.toThrow();
	});
});
