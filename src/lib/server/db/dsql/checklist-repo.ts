// src/lib/server/db/dsql/checklist-repo.ts
// EPIC #3424 / PR-R7 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §5 / §10 / §11.2 / §P9
//
// IChecklistRepo の DSQL backend 実装。child-cluster 最複雑 = ADR-0055 の
// **family master template + per-child assignments(配信) + per-child progress(logs) +
// per-child override** モデル (docs/design/dsql-data-model.md §10)。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) と
//     TransactionRunner を呼び出し側 (client factory / テスト) が渡す。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **template は family scope の 1 レコード** (ADR-0055 §10): checklist_templates は
//     (family_id, template_id) で一意化し child ごとに複製しない。per-child view は
//     assignments (checklist_template_assignments) を join して「配信済 template」を絞る。
//     「別の子から取込 (copy)」= assignments 追加のみ (template は複製しない)。この非対称を
//     findTemplatesByChild(assignments join) / assignTemplateToChildren(配信) で表現する。
//   - **§5 JSON 据置 (M3 §4.2 [must]A / reset-plan 決定#1)**: checklist_logs.items_json は
//     子表化せず text 列に据置する (子表 checklist_log_items は廃止)。log 読み出しは items_json
//     を verbatim 返し、upsertLog は checked 集合を items_json に丸ごと保存する (子表 join / 全置換
//     ループを廃止し原初のデータ喪失リスクを断つ)。itemsJson の意味は checklist-service の
//     `JSON.stringify(checkedIds)` (checked な item id 群) で SQLite SSOT と同 shape。
//   - **entity 境界**: isActive / isArchived / completedAll は number (0/1) 契約 — boolean 列を
//     読み出し時に変換 (既存 sqlite backend と同一 shape)。
//   - **surrogate 無し表の合成 id** (§11.2、daily-mission の自然キー戦略と同判断):
//     assignments PK = (family, template, child) / logs PK = (family, child, template, checked_date)
//     は surrogate id 列を持たないため entity の `id` は複合キーの合成文字列を返す
//     (ChecklistTemplateAssignment.id / ChecklistLog.id の消費は表示 key のみで grep 確認済 —
//      checklist-service は a.templateId / a.childId、admin +page は completedAll / points を使う)。
//   - **tenant 境界 (#3562 ③ parity)**: assignments の INSERT は「template が同 family に属する」
//     ことを INSERT ... SELECT FROM checklist_templates で強制し orphan / cross-family を構造排除。

import { sql } from 'drizzle-orm';
import type { ArchivedReason } from '$lib/domain/archive-types';
import { asChildId } from '$lib/domain/ids';
import type { IChecklistRepo } from '../interfaces/checklist-repo.interface';
import type { TransactionRunner } from '../interfaces/transaction.interface';
import type {
	ChecklistLog,
	ChecklistOverride,
	ChecklistTemplate,
	ChecklistTemplateAssignment,
	ChecklistTemplateItem,
} from '../types';
import { isUuidFormat, warnInvalidUuidId } from './pg-uuid';
import type { SqlExecutor } from './sql-executor';

interface TemplateRow {
	family_id: string;
	template_id: string;
	name: string;
	icon: string;
	points_per_item: number;
	completion_bonus: number;
	time_slot: string;
	is_active: boolean;
	is_archived: boolean;
	archived_reason: string | null;
	source_preset_id: string | null;
	created_at: string;
	updated_at: string;
}

interface AssignmentRow {
	family_id: string;
	template_id: string;
	child_id: string;
	created_at: string;
}

interface ItemRow {
	family_id: string;
	template_id: string;
	item_id: string;
	name: string;
	icon: string;
	frequency: string;
	direction: string;
	sort_order: number;
	created_at: string;
}

interface LogRow {
	family_id: string;
	child_id: string;
	template_id: string;
	checked_date: string;
	items_json: string;
	completed_all: boolean;
	points_awarded: number;
	created_at: string;
}

interface OverrideRow {
	family_id: string;
	child_id: string;
	override_id: string;
	target_date: string;
	action: string;
	item_name: string;
	icon: string;
	created_at: string;
}

const TEMPLATE_COLUMNS = sql.raw(
	`family_id, template_id, name, icon, points_per_item, completion_bonus, time_slot,
	 is_active, is_archived, archived_reason, source_preset_id, created_at, updated_at`,
);
const ASSIGNMENT_COLUMNS = sql.raw('family_id, template_id, child_id, created_at');
const ITEM_COLUMNS = sql.raw(
	'family_id, template_id, item_id, name, icon, frequency, direction, sort_order, created_at',
);
const LOG_COLUMNS = sql.raw(
	'family_id, child_id, template_id, checked_date, items_json, completed_all, points_awarded, created_at',
);
const OVERRIDE_COLUMNS = sql.raw(
	'family_id, child_id, override_id, target_date, action, item_name, icon, created_at',
);

/** row → ChecklistTemplate entity (boolean → 0/1、sqlite 互換 shape)。
 * sourcePresetId: marketplace 取込 checklist の帰属記録 (#3601 Gap B、兄弟 type child_activities/
 * special_rewards と同様 source_preset_id 列に永続。非取込は null)。 */
function toTemplate(row: TemplateRow): ChecklistTemplate {
	return {
		id: row.template_id,
		tenantId: row.family_id,
		name: row.name,
		icon: row.icon,
		pointsPerItem: row.points_per_item,
		completionBonus: row.completion_bonus,
		timeSlot: row.time_slot,
		isActive: row.is_active ? 1 : 0,
		isArchived: row.is_archived ? 1 : 0,
		archivedReason: row.archived_reason,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		sourcePresetId: row.source_preset_id,
	};
}

/** 合成 id (§11.2 surrogate 無し): assignments = `${template}:${child}`。 */
function toAssignment(row: AssignmentRow): ChecklistTemplateAssignment {
	return {
		id: `${row.template_id}:${row.child_id}`,
		templateId: row.template_id,
		childId: asChildId(row.child_id),
		createdAt: row.created_at,
	};
}

function toItem(row: ItemRow): ChecklistTemplateItem {
	return {
		id: row.item_id,
		templateId: row.template_id,
		name: row.name,
		icon: row.icon,
		frequency: row.frequency,
		direction: row.direction,
		sortOrder: row.sort_order,
		createdAt: row.created_at,
	};
}

/** 合成 id (§11.2 surrogate 無し): logs = `${child}:${template}:${date}`。
 * itemsJson は items_json text 列を verbatim 返す (子表 join を廃止、§5 text 据置)。 */
function toLog(row: LogRow): ChecklistLog {
	return {
		id: `${row.child_id}:${row.template_id}:${row.checked_date}`,
		childId: asChildId(row.child_id),
		templateId: row.template_id,
		checkedDate: row.checked_date,
		itemsJson: row.items_json,
		completedAll: row.completed_all ? 1 : 0,
		pointsAwarded: row.points_awarded,
		createdAt: row.created_at,
	};
}

function toOverride(row: OverrideRow): ChecklistOverride {
	return {
		id: row.override_id,
		childId: asChildId(row.child_id),
		targetDate: row.target_date,
		action: row.action,
		itemName: row.item_name,
		icon: row.icon,
		createdAt: row.created_at,
	};
}

/** itemsJson (checked item id の配列文字列) を parse (legacy number 配列も String 正規化)。 */
function parseCheckedIds(itemsJson: string): string[] {
	const raw = JSON.parse(itemsJson) as (string | number)[];
	return raw.map(String);
}

/** DSQL 用 IChecklistRepo を生成する (db/runner は注入、fitness#8)。 */
export function createDsqlChecklistRepo<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): IChecklistRepo {
	return {
		// ── Templates (family scope) ──────────────────────────────

		async findTemplatesByTenant(tenantId, includeInactive = false) {
			const tenantConditions = [sql`family_id = ${tenantId}`, sql`is_archived = false`];
			if (!includeInactive) tenantConditions.push(sql`is_active = true`);
			const result = await db.execute(sql`
				SELECT ${TEMPLATE_COLUMNS} FROM checklist_templates
				WHERE ${sql.join(tenantConditions, sql` AND `)}
				ORDER BY created_at, template_id
			`);
			return (result.rows as unknown as TemplateRow[]).map(toTemplate);
		},

		async findTemplatesByChild(
			childId,
			tenantId,
			includeInactive = false,
			includeArchived = false,
		) {
			// 配信済 (assignments join) の family master を child 視点で取得 (§10)。
			const conditions = [sql`a.family_id = ${tenantId}`, sql`a.child_id = ${String(childId)}`];
			if (!includeArchived) conditions.push(sql`t.is_archived = false`);
			if (!includeInactive) conditions.push(sql`t.is_active = true`);
			const result = await db.execute(sql`
				SELECT t.family_id, t.template_id, t.name, t.icon, t.points_per_item, t.completion_bonus,
					t.time_slot, t.is_active, t.is_archived, t.archived_reason, t.source_preset_id,
					t.created_at, t.updated_at
				FROM checklist_templates t
				JOIN checklist_template_assignments a
					ON a.family_id = t.family_id AND a.template_id = t.template_id
				WHERE ${sql.join(conditions, sql` AND `)}
				ORDER BY t.created_at, t.template_id
			`);
			return (result.rows as unknown as TemplateRow[]).map(toTemplate);
		},

		async findTemplateById(id, tenantId) {
			const result = await db.execute(sql`
				SELECT ${TEMPLATE_COLUMNS} FROM checklist_templates
				WHERE family_id = ${tenantId} AND template_id = ${id}
			`);
			const row = result.rows[0] as unknown as TemplateRow | undefined;
			return row ? toTemplate(row) : undefined;
		},

		async insertTemplate(input, tenantId) {
			// 未指定は schema default に合わせた値を明示 (child-activity buildInsertSql と同方針)。
			const result = await db.execute(sql`
				INSERT INTO checklist_templates
					(family_id, name, icon, points_per_item, completion_bonus, time_slot, is_active,
					 is_archived, source_preset_id)
				VALUES (${tenantId}, ${input.name}, ${input.icon ?? '📋'}, ${input.pointsPerItem ?? 2},
					${input.completionBonus ?? 5}, ${input.timeSlot ?? 'anytime'},
					${(input.isActive ?? 1) !== 0}, ${(input.isArchived ?? 0) !== 0},
					${input.sourcePresetId ?? null})
				RETURNING ${TEMPLATE_COLUMNS}
			`);
			return toTemplate(result.rows[0] as unknown as TemplateRow);
		},

		async updateTemplate(id, input, tenantId) {
			const sets = [sql`updated_at = now()`];
			if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
			if (input.icon !== undefined) sets.push(sql`icon = ${input.icon}`);
			if (input.pointsPerItem !== undefined)
				sets.push(sql`points_per_item = ${input.pointsPerItem}`);
			if (input.completionBonus !== undefined)
				sets.push(sql`completion_bonus = ${input.completionBonus}`);
			if (input.timeSlot !== undefined) sets.push(sql`time_slot = ${input.timeSlot}`);
			if (input.isActive !== undefined) sets.push(sql`is_active = ${input.isActive !== 0}`);
			const result = await db.execute(sql`
				UPDATE checklist_templates SET ${sql.join(sets, sql`, `)}
				WHERE family_id = ${tenantId} AND template_id = ${id}
				RETURNING ${TEMPLATE_COLUMNS}
			`);
			const row = result.rows[0] as unknown as TemplateRow | undefined;
			return row ? toTemplate(row) : undefined;
		},

		async deleteTemplate(id, tenantId) {
			// cascade を単一 txn (fitness#7: work 内 await は tx.execute 直呼びのみ)。関連表 →
			// 親 template の順で削除し orphan を残さない。§P9: family 述語で他 tenant を保護。
			// checklist_log_items 子表は廃止 (items_json text 据置) ゆえ削除対象から除外。
			await runner.runInTransaction(async (tx) => {
				await tx.execute(
					sql`DELETE FROM checklist_logs WHERE family_id = ${tenantId} AND template_id = ${id}`,
				);
				await tx.execute(
					sql`DELETE FROM checklist_template_assignments WHERE family_id = ${tenantId} AND template_id = ${id}`,
				);
				await tx.execute(
					sql`DELETE FROM checklist_template_items WHERE family_id = ${tenantId} AND template_id = ${id}`,
				);
				await tx.execute(
					sql`DELETE FROM checklist_templates WHERE family_id = ${tenantId} AND template_id = ${id}`,
				);
			});
		},

		// ── Distribution (assignments) ────────────────────────────

		async findAssignmentsByTemplate(templateId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${ASSIGNMENT_COLUMNS} FROM checklist_template_assignments
				WHERE family_id = ${tenantId} AND template_id = ${templateId}
				ORDER BY child_id
			`);
			return (result.rows as unknown as AssignmentRow[]).map(toAssignment);
		},

		async findAssignmentsByChild(childId, tenantId) {
			// #3581 ②: checklist toggle action (child POST) が raw cookie id を最初に渡す repo 経路。
			// 非 uuid は「配信なし」= 空配列 (not-found と同 shape) を返し、22P02 → 500 を避ける。
			if (!isUuidFormat(String(childId))) {
				warnInvalidUuidId('checklist-repo.findAssignmentsByChild');
				return [];
			}
			const result = await db.execute(sql`
				SELECT ${ASSIGNMENT_COLUMNS} FROM checklist_template_assignments
				WHERE family_id = ${tenantId} AND child_id = ${String(childId)}
				ORDER BY template_id
			`);
			return (result.rows as unknown as AssignmentRow[]).map(toAssignment);
		},

		async assignTemplateToChildren(templateId, childIds, tenantId) {
			if (childIds.length === 0) return [];
			// 配信を all-or-nothing に (単一 txn)。#3562 ③ parity: template 所有を INSERT ... SELECT で
			// 強制し、他 family template / 存在しない template への orphan 配信を構造排除。既配信は
			// PK ON CONFLICT DO NOTHING で skip し、RETURNING で「実際に追加された」assignment のみ返す。
			// #3603 ①: DSQL は FK 非対応のため child_id をリテラル無検証で挿入すると同 family 内でも
			// 存在しない child への orphan assignment を許容する。children を JOIN し child 実在を
			// 構造強制する (template と child が両方存在するときのみ 1 行 emit)。存在しない child は
			// JOIN で 0 行 → 挿入されず inserted に載らない (findTemplatesByChild で返らない無害データも作らない)。
			return runner.runInTransaction(async (tx) => {
				const inserted: ChecklistTemplateAssignment[] = [];
				for (const childId of childIds) {
					const result = await tx.execute(sql`
						INSERT INTO checklist_template_assignments (family_id, template_id, child_id)
						SELECT t.family_id, t.template_id, c.child_id
						FROM checklist_templates t
						JOIN children c ON c.family_id = t.family_id AND c.child_id = ${String(childId)}
						WHERE t.family_id = ${tenantId} AND t.template_id = ${templateId}
						ON CONFLICT (family_id, template_id, child_id) DO NOTHING
						RETURNING ${ASSIGNMENT_COLUMNS}
					`);
					const row = result.rows[0] as unknown as AssignmentRow | undefined;
					if (row) inserted.push(toAssignment(row));
				}
				return inserted;
			});
		},

		async unassignTemplateFromChildren(templateId, childIds, tenantId) {
			if (childIds.length === 0) return;
			await db.execute(sql`
				DELETE FROM checklist_template_assignments
				WHERE family_id = ${tenantId} AND template_id = ${templateId}
					AND child_id IN (${sql.join(
						childIds.map((c) => sql`${String(c)}`),
						sql`, `,
					)})
			`);
		},

		async unassignTemplate(templateId, tenantId) {
			await db.execute(sql`
				DELETE FROM checklist_template_assignments
				WHERE family_id = ${tenantId} AND template_id = ${templateId}
			`);
		},

		// ── Template items ────────────────────────────────────────

		async findTemplateItems(templateId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${ITEM_COLUMNS} FROM checklist_template_items
				WHERE family_id = ${tenantId} AND template_id = ${templateId}
				ORDER BY sort_order, item_id
			`);
			return (result.rows as unknown as ItemRow[]).map(toItem);
		},

		async insertTemplateItem(input, tenantId) {
			// item_id は schema default (gen_random_uuid())。
			// #3603 ①: DSQL は FK 非対応。template_id を family タグのみで受理すると、同 family 内でも
			// 存在しない / archive 済でない別 template を名乗った item が orphan として挿入され得る
			// (assignTemplateToChildren の children JOIN と同じ穴)。INSERT ... SELECT FROM
			// checklist_templates で「template が同 family に実在する」ことを構造強制し、family_id は
			// 親 template 行から採る (§P9: template が別 tenant なら 0 行 → 挿入されない)。0 行 emit は
			// caller の programming error (実在しない template) ゆえ silent drop せず loud に throw する。
			const result = await db.execute(sql`
				INSERT INTO checklist_template_items
					(family_id, template_id, name, icon, frequency, direction, sort_order)
				SELECT t.family_id, t.template_id, ${input.name}, ${input.icon ?? '🏫'},
					${input.frequency ?? 'daily'}, ${input.direction ?? 'bring'}, ${input.sortOrder ?? 0}
				FROM checklist_templates t
				WHERE t.family_id = ${tenantId} AND t.template_id = ${input.templateId}
				RETURNING ${ITEM_COLUMNS}
			`);
			const row = result.rows[0] as unknown as ItemRow | undefined;
			if (!row) {
				throw new Error(
					'checklist insertTemplateItem: template not found in tenant (orphan item rejected)',
				);
			}
			return toItem(row);
		},

		async deleteTemplateItem(templateId, id, tenantId) {
			// #2845 B1: (family, template, item) composite — 不一致は affected 0 の no-op。
			await db.execute(sql`
				DELETE FROM checklist_template_items
				WHERE family_id = ${tenantId} AND template_id = ${templateId} AND item_id = ${id}
			`);
		},

		// ── Per-child progress (logs、§5 子表化) ──────────────────

		async findTodayLog(childId, templateId, date, tenantId) {
			const result = await db.execute(sql`
				SELECT ${LOG_COLUMNS} FROM checklist_logs
				WHERE family_id = ${tenantId} AND child_id = ${String(childId)}
					AND template_id = ${templateId} AND checked_date = ${date}
			`);
			const row = result.rows[0] as unknown as LogRow | undefined;
			if (!row) return undefined;
			return toLog(row);
		},

		async upsertLog(input, tenantId) {
			// log 行を items_json text 据置で保存 (§5: 子表 checklist_log_items 廃止、M3 §4.2)。
			// checked 集合は items_json に丸ごと保存する (checklist-service は全 checked id を渡すため
			// 全置換が正)。log 行は PK ON CONFLICT DO UPDATE (created_at は不変、items_json も置換)。
			// legacy number 配列を String 正規化した JSON を据置 (read と同 shape、順序非依存)。
			const itemsJson = JSON.stringify(parseCheckedIds(input.itemsJson));
			const childId = String(input.childId);
			const { templateId, checkedDate } = input;
			const completedAll = input.completedAll !== 0;
			const upserted = await db.execute(sql`
				INSERT INTO checklist_logs
					(family_id, child_id, template_id, checked_date, items_json, completed_all, points_awarded)
				VALUES (${tenantId}, ${childId}, ${templateId}, ${checkedDate}, ${itemsJson}, ${completedAll},
					${input.pointsAwarded})
				ON CONFLICT (family_id, child_id, template_id, checked_date)
				DO UPDATE SET items_json = ${itemsJson}, completed_all = ${completedAll},
					points_awarded = ${input.pointsAwarded}
				RETURNING ${LOG_COLUMNS}
			`);
			return toLog(upserted.rows[0] as unknown as LogRow);
		},

		async findLogsByChild(childId, tenantId) {
			const id = String(childId);
			const logsResult = await db.execute(sql`
				SELECT ${LOG_COLUMNS} FROM checklist_logs
				WHERE family_id = ${tenantId} AND child_id = ${id}
				ORDER BY checked_date DESC
			`);
			// items_json は各 log 行に据置済 (子表 join 廃止、§5 text 据置)。
			return (logsResult.rows as unknown as LogRow[]).map(toLog);
		},

		// ── Per-child overrides ───────────────────────────────────

		async findOverrides(childId, date, tenantId) {
			const result = await db.execute(sql`
				SELECT ${OVERRIDE_COLUMNS} FROM checklist_overrides
				WHERE family_id = ${tenantId} AND child_id = ${String(childId)} AND target_date = ${date}
				ORDER BY created_at, override_id
			`);
			return (result.rows as unknown as OverrideRow[]).map(toOverride);
		},

		async insertOverride(input, tenantId) {
			// #3603 ①: DSQL は FK 非対応。child_id を family タグのみで受理すると、同 family 内でも
			// 存在しない child を名乗った override が orphan として挿入され得る
			// (assignTemplateToChildren の children JOIN と同じ穴)。INSERT ... SELECT FROM children で
			// 「child が同 family に実在する」ことを構造強制し、family_id は children 行から採る
			// (§P9: child が別 tenant なら 0 行 → 挿入されない)。0 行 emit は caller の programming error
			// (実在しない child) ゆえ silent drop せず loud に throw する。backup restore 経路
			// (insertOverrideForRestore) は child 復元順序に依存するため本 guard の対象外。
			const result = await db.execute(sql`
				INSERT INTO checklist_overrides (family_id, child_id, target_date, action, item_name, icon)
				SELECT c.family_id, c.child_id, ${input.targetDate}, ${input.action},
					${input.itemName}, ${input.icon ?? '📦'}
				FROM children c
				WHERE c.family_id = ${tenantId} AND c.child_id = ${String(input.childId)}
				RETURNING ${OVERRIDE_COLUMNS}
			`);
			const row = result.rows[0] as unknown as OverrideRow | undefined;
			if (!row) {
				throw new Error(
					'checklist insertOverride: child not found in tenant (orphan override rejected)',
				);
			}
			return toOverride(row);
		},

		async findOverridesByChild(childId, tenantId) {
			const result = await db.execute(sql`
				SELECT ${OVERRIDE_COLUMNS} FROM checklist_overrides
				WHERE family_id = ${tenantId} AND child_id = ${String(childId)}
				ORDER BY target_date, override_id
			`);
			return (result.rows as unknown as OverrideRow[]).map(toOverride);
		},

		async insertOverrideForRestore(input, tenantId) {
			// #3329 backup restore: createdAt を verbatim 保全 (insertOverride と違い default(now)
			// に落とさない)。override_id は新規採番 (schema default)。
			const result = await db.execute(sql`
				INSERT INTO checklist_overrides
					(family_id, child_id, target_date, action, item_name, icon, created_at)
				VALUES (${tenantId}, ${String(input.childId)}, ${input.targetDate}, ${input.action},
					${input.itemName}, ${input.icon}, ${input.createdAt}::timestamptz)
				RETURNING ${OVERRIDE_COLUMNS}
			`);
			return toOverride(result.rows[0] as unknown as OverrideRow);
		},

		async deleteOverride(childId, id, tenantId) {
			// #2845 B1: (family, child, override) composite — 不一致は affected 0 の no-op。
			await db.execute(sql`
				DELETE FROM checklist_overrides
				WHERE family_id = ${tenantId} AND child_id = ${String(childId)} AND override_id = ${id}
			`);
		},

		// ── archive / restore (family scope) ──────────────────────

		async archiveChecklistTemplates(ids, reason: ArchivedReason, tenantId) {
			if (ids.length === 0) return;
			await db.execute(sql`
				UPDATE checklist_templates
				SET is_archived = true, archived_reason = ${reason}, updated_at = now()
				WHERE family_id = ${tenantId} AND template_id IN (${sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `,
				)})
			`);
		},

		async restoreArchivedChecklistTemplates(reason: ArchivedReason, tenantId) {
			await db.execute(sql`
				UPDATE checklist_templates
				SET is_archived = false, archived_reason = NULL, updated_at = now()
				WHERE family_id = ${tenantId} AND is_archived = true AND archived_reason = ${reason}
			`);
		},

		// ── Tenant bulk deletion ──────────────────────────────────

		async deleteByTenantId(tenantId) {
			// 全 5 表を単一 txn で tenant 限定削除 (fitness#7)。sqlite (シングルテナント全行削除) と
			// 違い family 述語で tenant 限定 (§P9)。子表 → 親の順で削除。
			await runner.runInTransaction(async (tx) => {
				await tx.execute(sql`DELETE FROM checklist_logs WHERE family_id = ${tenantId}`);
				await tx.execute(sql`DELETE FROM checklist_overrides WHERE family_id = ${tenantId}`);
				await tx.execute(
					sql`DELETE FROM checklist_template_assignments WHERE family_id = ${tenantId}`,
				);
				await tx.execute(sql`DELETE FROM checklist_template_items WHERE family_id = ${tenantId}`);
				await tx.execute(sql`DELETE FROM checklist_templates WHERE family_id = ${tenantId}`);
			});
		},
	};
}
