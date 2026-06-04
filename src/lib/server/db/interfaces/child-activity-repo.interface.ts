/**
 * IChildActivityRepo — per-child activity instance repo interface (#2362 PR-3、ADR-0055)
 *
 * 旧 `IActivityRepo` (family master) の後継として、aggregate root が child に閉じた
 * per-child instance を扱う interface SSOT。
 *
 * 設計原則 (ADR-0055 §3.1):
 *   - `childId` を必須引数化 (cross-child cross access を構造的に防ぐ)
 *   - `tenantId` 引数の現セマンティクス (#2494 Phase 1): SQLite 実装では**意図的 no-op**
 *     (1 process = 1 DB = 1 tenant で越境入力が構造的に不能)、DynamoDB 実装は
 *     partition key (`T#<tenantId>#CHILD#<childId>`) で tenant isolation を構造的に
 *     強制 (#2820 本実装)。SQLite 側の filter 化 (Phase 2) は #2828 で管理。
 *     SSOT: docs/design/data-model-resource-scope.md §4.1「tenant isolation の現状 SSOT」
 *   - 旧 `IActivityRepo` は PR-3 期間中は並存。完全切替時に削除
 *
 * 関連:
 *   - docs/design/data-model-resource-scope.md §4.1 (schema 設計案)
 *   - docs/design/marketplace-import-flow.md §3 (取込時 child binding sequence)
 */

import type { ArchivedReason } from '$lib/domain/archive-types';
import type {
	Child,
	ChildActivity,
	InsertChildActivityInput,
	UpdateChildActivityInput,
} from '../types/index.js';

export interface IChildActivityRepo {
	// ── 一覧 / 取得 (child scope) ─────────────────────────────────
	/** 指定 child の activity 一覧。archived 除外可 */
	findActivitiesByChild(
		childId: number,
		tenantId: string,
		options?: { includeArchived?: boolean; visibleOnly?: boolean },
	): Promise<ChildActivity[]>;

	/** id + child + tenant の 3 軸で取得 (cross-child access 防止) */
	findActivityById(
		id: number,
		childId: number,
		tenantId: string,
	): Promise<ChildActivity | undefined>;

	/** main quest 数 (per-child) */
	countMainQuestActivities(childId: number, tenantId: string): Promise<number>;

	// ── 作成 / 更新 / 削除 (child scope) ──────────────────────────
	/** per-child instance 新規作成 */
	insertActivity(input: InsertChildActivityInput, tenantId: string): Promise<ChildActivity>;

	/**
	 * 一括作成 (取込時の per-child 配信)。
	 * 同一 source preset を複数 child に同時 instance 化する用途。
	 */
	insertActivitiesBulk(
		inputs: InsertChildActivityInput[],
		tenantId: string,
	): Promise<ChildActivity[]>;

	updateActivity(
		id: number,
		childId: number,
		input: UpdateChildActivityInput,
		tenantId: string,
	): Promise<ChildActivity | undefined>;

	setActivityVisibility(
		id: number,
		childId: number,
		visible: boolean,
		tenantId: string,
	): Promise<ChildActivity | undefined>;

	deleteActivity(id: number, childId: number, tenantId: string): Promise<ChildActivity | undefined>;

	// ── 兄弟共通化 UX (ADR-0055 §3.1 兄弟共通化、User §1) ────────
	/**
	 * 「他の子供から copy」: 指定 child の activity 全件を target child に複製。
	 * 戻り値は target child に作成された ChildActivity 一覧。
	 */
	copyActivitiesAcrossChildren(
		sourceChildId: number,
		targetChildId: number,
		tenantId: string,
	): Promise<ChildActivity[]>;

	// ── archive / restore (#783) ──────────────────────────────────
	// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
	archiveActivities(ids: number[], reason: ArchivedReason, tenantId: string): Promise<void>;
	restoreArchivedActivities(reason: ArchivedReason, tenantId: string): Promise<void>;

	// ── Child convenience lookup ─────────────────────────────────
	findChildById(id: number, tenantId: string): Promise<Child | undefined>;
}
