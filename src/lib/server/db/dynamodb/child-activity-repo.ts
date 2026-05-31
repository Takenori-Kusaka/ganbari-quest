// src/lib/server/db/dynamodb/child-activity-repo.ts
// per-child activity instance repository — DynamoDB Pre-PMF fallback 実装
//
// #2263 regression hotfix (PR #2455 = #2362 PR-3 で 2026-05-24 導入):
//   本番 cognito Lambda は `AUTH_MODE=cognito + DATA_SOURCE=dynamodb` で main Lambda
//   として稼働する (`infra/lib/compute-stack.ts:159` で固定)。当初コメントの
//   「DATA_SOURCE='dynamodb' は ADR-0048 Multi-Lambda 設計外」は誤りで、本 stub の
//   `throw new Error('not implemented')` が `/preschool/home` 等の 5 age mode SSR で
//   `Promise.all([..., getChildActivities(...)])` 経路を reject し 500 を引き起こす
//   (子供 3-18 歳が本番アプリにアクセス不能)。ADR-0002 Critical 修正対象。
//
// 修正方針 (PR #2280 / child-challenge-repo (#2362 PR-7) と同型):
//   - read 系: warnRead + 空配列 / undefined / 0 を return (500 防止)
//   - write 系: throw 維持 (Pre-PMF で本番 write 経路に到達しない設計、ADR-0010
//     Bucket B「まだ作らない」を構造的に強制 — 将来 ADR-0055 per-child schema 本実装で解除)
//
// 関連: ADR-0002 / ADR-0010 / ADR-0055 / PR #2280 (12 repo hotfix) / PR #2479 (child-challenge)

import type { ArchivedReason } from '$lib/domain/archive-types';
import { logger } from '$lib/server/logger';
import type {
	Child,
	ChildActivity,
	InsertChildActivityInput,
	UpdateChildActivityInput,
} from '../types';

const SERVICE = 'child-activity-repo.dynamodb';

function warnRead(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] read fallback: returning empty (Pre-PMF stub, #2263 regression)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

function notImplemented(method: string): never {
	throw new Error(
		`[${SERVICE}] ${method} not implemented (ADR-0055 per-child schema 本実装は Pre-PMF 範囲外). ` +
			'write 経路は到達しない設計 — 到達した場合は ADR-0010 Bucket B 違反として要対応。',
	);
}

export async function findActivitiesByChild(
	childId: number,
	tenantId: string,
	options?: { includeArchived?: boolean; visibleOnly?: boolean },
): Promise<ChildActivity[]> {
	warnRead('findActivitiesByChild', { childId, tenantId, options });
	return [];
}

export async function findActivityById(
	id: number,
	childId: number,
	tenantId: string,
): Promise<ChildActivity | undefined> {
	warnRead('findActivityById', { id, childId, tenantId });
	return undefined;
}

export async function countMainQuestActivities(childId: number, tenantId: string): Promise<number> {
	warnRead('countMainQuestActivities', { childId, tenantId });
	return 0;
}

export async function findChildById(id: number, tenantId: string): Promise<Child | undefined> {
	warnRead('findChildById', { id, tenantId });
	return undefined;
}

export async function insertActivity(
	_input: InsertChildActivityInput,
	_tenantId: string,
): Promise<ChildActivity> {
	return notImplemented('insertActivity');
}

export async function insertActivitiesBulk(
	_inputs: InsertChildActivityInput[],
	_tenantId: string,
): Promise<ChildActivity[]> {
	return notImplemented('insertActivitiesBulk');
}

export async function updateActivity(
	_id: number,
	_childId: number,
	_input: UpdateChildActivityInput,
	_tenantId: string,
): Promise<ChildActivity | undefined> {
	return notImplemented('updateActivity');
}

export async function setActivityVisibility(
	_id: number,
	_childId: number,
	_visible: boolean,
	_tenantId: string,
): Promise<ChildActivity | undefined> {
	return notImplemented('setActivityVisibility');
}

export async function deleteActivity(
	_id: number,
	_childId: number,
	_tenantId: string,
): Promise<ChildActivity | undefined> {
	return notImplemented('deleteActivity');
}

export async function copyActivitiesAcrossChildren(
	_sourceChildId: number,
	_targetChildId: number,
	_tenantId: string,
): Promise<ChildActivity[]> {
	return notImplemented('copyActivitiesAcrossChildren');
}

// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
export async function archiveActivities(
	_ids: number[],
	_reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	return notImplemented('archiveActivities');
}

export async function restoreArchivedActivities(
	_reason: ArchivedReason,
	_tenantId: string,
): Promise<void> {
	return notImplemented('restoreArchivedActivities');
}
