import type { ArchivedReason } from '$lib/domain/archive-types';
import type {
	ChecklistLog,
	ChecklistOverride,
	ChecklistTemplate,
	ChecklistTemplateAssignment,
	ChecklistTemplateItem,
	InsertChecklistOverrideInput,
	InsertChecklistTemplateInput,
	InsertChecklistTemplateItemInput,
	UpdateChecklistTemplateInput,
	UpsertChecklistLogInput,
} from '../types';

/**
 * #2362 PR-5 (ADR-0055 / data-model-resource-scope §4.2):
 *
 * checklist は **family master + per-child progress** モデル。
 *   - `checklist_templates` は family scope (tenantId のみで一意化、childId なし)
 *   - 配信先 child は `checklist_template_assignments` (template ↔ child N:M) で表現
 *   - per-child progress は `checklist_logs` ((childId, templateId, checkedDate) UNIQUE) で維持
 *   - per-child 個別 override は `checklist_overrides` で維持
 *
 * Method 構成:
 *   - **Family scope (template)**: tenantId 引数で family 全体を操作。
 *     `findTemplatesByTenant` / `findTemplateById` / `insertTemplate` /
 *     `updateTemplate` / `deleteTemplate`
 *   - **Distribution (assignments)**: 1 family checklist を N child に配信 / 配信解除。
 *     `findAssignmentsByTemplate` / `findAssignmentsByChild` /
 *     `assignTemplateToChildren` / `unassignTemplateFromChildren` / `unassignTemplate`
 *   - **Templates by child (compat)**: 子供画面 + Phase 1 既存 callsite 互換用に
 *     「配信中の family templates」を child 視点で取得する read API を残す。
 *     内部実装は `assignments` join で family master を取得する。
 *   - **Items / Logs / Overrides**: 既存 API を維持 (per-child progress / override は family flip の影響なし)
 */
export interface IChecklistRepo {
	// ── Templates (family scope) ────────────────────────────────────

	/** family scope (tenant 全体) の family master template 一覧。 */
	findTemplatesByTenant(tenantId: string, includeInactive?: boolean): Promise<ChecklistTemplate[]>;

	/**
	 * 子供視点で「配信中の family templates」を取得 (assignments join)。
	 * Phase 1 既存 callsite (`getChecklistsForChild` 等) との互換 wrap。
	 */
	findTemplatesByChild(
		childId: number,
		tenantId: string,
		includeInactive?: boolean,
		// #3106: archive 済 template を含めるか。既定 false (従来どおり archived 除外)。
		// export/backup 文脈のみ true にし、archive 済 template の checklistLog 欠落を防ぐ。
		includeArchived?: boolean,
	): Promise<ChecklistTemplate[]>;

	findTemplateById(id: number, tenantId: string): Promise<ChecklistTemplate | undefined>;

	insertTemplate(input: InsertChecklistTemplateInput, tenantId: string): Promise<ChecklistTemplate>;

	updateTemplate(
		id: number,
		input: UpdateChecklistTemplateInput,
		tenantId: string,
	): Promise<ChecklistTemplate | undefined>;

	deleteTemplate(id: number, tenantId: string): Promise<void>;

	// ── Distribution (template ↔ child assignments) ─────────────────

	findAssignmentsByTemplate(
		templateId: number,
		tenantId: string,
	): Promise<ChecklistTemplateAssignment[]>;

	findAssignmentsByChild(childId: number, tenantId: string): Promise<ChecklistTemplateAssignment[]>;

	/** family checklist を指定 child 群に配信 (既配信は skip)。返り値は actually 追加された assignment 群。 */
	assignTemplateToChildren(
		templateId: number,
		childIds: readonly number[],
		tenantId: string,
	): Promise<ChecklistTemplateAssignment[]>;

	/** 指定 child 群への配信を解除。child 配列が空なら何もしない。 */
	unassignTemplateFromChildren(
		templateId: number,
		childIds: readonly number[],
		tenantId: string,
	): Promise<void>;

	/** template に紐づく全 assignments を削除 (template 削除前に呼ぶ)。 */
	unassignTemplate(templateId: number, tenantId: string): Promise<void>;

	// ── Template items (family items) ───────────────────────────────

	findTemplateItems(templateId: number, tenantId: string): Promise<ChecklistTemplateItem[]>;
	insertTemplateItem(
		input: InsertChecklistTemplateItemInput,
		tenantId: string,
	): Promise<ChecklistTemplateItem>;
	/**
	 * #2845 B1: templateId 必須 (composite key)。旧 id-only は DynamoDB 側で
	 * tenant 無束縛 Scan + 全 tenant delete 可能形状だった。
	 */
	deleteTemplateItem(templateId: number, id: number, tenantId: string): Promise<void>;

	// ── Per-child progress (logs) ────────────────────────────────────

	findTodayLog(
		childId: number,
		templateId: number,
		date: string,
		tenantId: string,
	): Promise<ChecklistLog | undefined>;
	upsertLog(input: UpsertChecklistLogInput, tenantId: string): Promise<ChecklistLog>;

	/**
	 * #3078: child 単位で per-child progress log を全件バルク取得する (export 用)。
	 * activityLog の `findActivityLogs` と対をなす一括取得 API。
	 */
	findLogsByChild(childId: number, tenantId: string): Promise<ChecklistLog[]>;

	// ── Per-child overrides (one-off items) ─────────────────────────

	findOverrides(childId: number, date: string, tenantId: string): Promise<ChecklistOverride[]>;
	insertOverride(input: InsertChecklistOverrideInput, tenantId: string): Promise<ChecklistOverride>;

	/** #3329 backup: child の全日次 override (日付不問、export 用)。 */
	findOverridesByChild(childId: number, tenantId: string): Promise<ChecklistOverride[]>;

	/**
	 * #3329 backup restore 用: createdAt を保全して日次 override を復元する。
	 * insertOverride は createdAt を schema default (now) で発番するため round-trip で作成日時が
	 * 失われる。本メソッドは export された値をそのまま書き戻す (id は新規採番、childId は解決済)。
	 */
	insertOverrideForRestore(
		input: Omit<ChecklistOverride, 'id'>,
		tenantId: string,
	): Promise<ChecklistOverride>;
	/**
	 * #2845 B1: childId 必須 (composite key)。旧 id-only は DynamoDB 側で
	 * tenant 無束縛 Scan + 全 tenant delete 可能形状だった。
	 */
	deleteOverride(childId: number, id: number, tenantId: string): Promise<void>;

	// ── #783: archive / restore ─────────────────────────────────────

	// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
	archiveChecklistTemplates(ids: number[], reason: ArchivedReason, tenantId: string): Promise<void>;
	restoreArchivedChecklistTemplates(reason: ArchivedReason, tenantId: string): Promise<void>;

	// ── Tenant bulk deletion ────────────────────────────────────────

	deleteByTenantId(tenantId: string): Promise<void>;
}
