import type { ArchivedReason } from '$lib/domain/archive-types';
import type { Child, InsertChildInput, UpdateChildInput } from '../types';

export interface IChildRepo {
	findAllChildren(tenantId: string): Promise<Child[]>;
	findChildById(id: number, tenantId: string): Promise<Child | undefined>;
	findChildByUserId(userId: string, tenantId: string): Promise<Child | undefined>;
	insertChild(input: InsertChildInput, tenantId: string): Promise<Child>;
	updateChild(id: number, input: UpdateChildInput, tenantId: string): Promise<Child | undefined>;
	deleteChild(id: number, tenantId: string): Promise<void>;

	/**
	 * #3152: 子供 1 人分の進捗データ (activity_logs / point_ledger / login_bonuses /
	 * child_achievements) を全削除する。child 行自体は残す (dev-only デバッグ用途)。
	 */
	resetChildProgressData(id: number, tenantId: string): Promise<void>;

	// #783: archive / restore
	// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
	archiveChildren(ids: number[], reason: ArchivedReason, tenantId: string): Promise<void>;
	restoreArchivedChildren(reason: ArchivedReason, tenantId: string): Promise<void>;
	findArchivedChildren(tenantId: string): Promise<Child[]>;
}
