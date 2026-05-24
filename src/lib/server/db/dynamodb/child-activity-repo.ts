// src/lib/server/db/dynamodb/child-activity-repo.ts
// per-child activity instance repository — DynamoDB 実装 stub (#2362 PR-3, ADR-0055)
//
// Phase 2 段階では interface 整合のみ確保 (NotImplemented stub)。
// Phase 6/7 で旧 dynamodb activity-repo を per-child instance schema に refactor し、
// activity_logs.activityId → child_activity_id FK 切替と同時に本実装を埋める。
//
// Production deployment では現在 DATA_SOURCE='dynamodb' は ADR-0048 Multi-Lambda 設計外
// (main Lambda は sqlite local file + S3 backup を使用)。本 stub が production で
// 呼ばれる可能性はないが、factory.ts の型整合のため stub として配置する。

import type {
	Child,
	ChildActivity,
	InsertChildActivityInput,
	UpdateChildActivityInput,
} from '../types';

function notImplemented(method: string): never {
	throw new Error(
		`[child-activity-repo.dynamodb] ${method} not implemented (PR-3 Phase 2 stub). ` +
			'DynamoDB backend は Phase 6/7 で旧 activity-repo refactor 時に実装予定。',
	);
}

export async function findActivitiesByChild(
	_childId: number,
	_tenantId: string,
	_options?: { includeArchived?: boolean; visibleOnly?: boolean },
): Promise<ChildActivity[]> {
	return notImplemented('findActivitiesByChild');
}

export async function findActivityById(
	_id: number,
	_childId: number,
	_tenantId: string,
): Promise<ChildActivity | undefined> {
	return notImplemented('findActivityById');
}

export async function countMainQuestActivities(
	_childId: number,
	_tenantId: string,
): Promise<number> {
	return notImplemented('countMainQuestActivities');
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

export async function archiveActivities(
	_ids: number[],
	_reason: string,
	_tenantId: string,
): Promise<void> {
	return notImplemented('archiveActivities');
}

export async function restoreArchivedActivities(_reason: string, _tenantId: string): Promise<void> {
	return notImplemented('restoreArchivedActivities');
}

export async function findChildById(_id: number, _tenantId: string): Promise<Child | undefined> {
	return notImplemented('findChildById');
}
