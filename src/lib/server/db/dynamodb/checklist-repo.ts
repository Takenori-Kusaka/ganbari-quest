// src/lib/server/db/dynamodb/checklist-repo.ts
// DynamoDB implementation of IChecklistRepo
//
// #2362 PR-5 (ADR-0055): family master template + per-child assignments + per-child progress logs。
//   - Templates: PK=T#<tenantId>#CKTPL, SK=CKTPL#<id> (旧 CHILD#<cId> 配下から tenant scope に変更)
//   - Assignments: PK=T#<tenantId>#CKTPL#<tplId>, SK=ASSIGN#<childId>
//   - Items: PK=T#<tenantId>#CKTPL#<tplId>, SK=ITEM#<sort>#<id> (既存維持)
//   - Logs: PK=CHILD#<cId>, SK=CKLOG#<tplId>#<date> (既存維持、per-child progress)
//   - Overrides: PK=CHILD#<cId>, SK=CKOVER#<date>#<id> (既存維持、per-child override)

import {
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
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
import { deleteItemsByPkPrefix } from './bulk-delete';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import {
	checklistAssignmentKey,
	checklistAssignmentPrefix,
	checklistItemKey,
	checklistItemPrefix,
	checklistLogKey,
	checklistLogPrefix,
	checklistOverrideDatePrefix,
	checklistOverrideKey,
	checklistOverridePrefix,
	checklistTemplateKey,
	checklistTemplatePrefix,
	childPK,
	ENTITY_NAMES,
	tenantPK,
} from './keys';
import { stripKeys } from './repo-helpers';

// ============================================================
// Templates (family scope)
// ============================================================

export async function findTemplatesByTenant(
	tenantId: string,
	includeInactive?: boolean,
): Promise<ChecklistTemplate[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': tenantPK('CKTPL', tenantId),
				':prefix': checklistTemplatePrefix(),
			},
		}),
	);

	let items = (result.Items ?? []).map((item) => stripKeys(item) as unknown as ChecklistTemplate);
	items = items.filter((t) => !t.isArchived || t.isArchived === 0);
	if (!includeInactive) {
		items = items.filter((t) => t.isActive === 1);
	}
	return items;
}

/**
 * 子供視点で「配信中の family templates」を取得 (assignments → templates の 2 段 query)。
 */
export async function findTemplatesByChild(
	childId: number,
	tenantId: string,
	includeInactive?: boolean,
): Promise<ChecklistTemplate[]> {
	const assignments = await findAssignmentsByChild(childId, tenantId);
	if (assignments.length === 0) return [];

	const templates: ChecklistTemplate[] = [];
	for (const a of assignments) {
		const t = await findTemplateById(a.templateId, tenantId);
		if (!t) continue;
		if (t.isArchived === 1) continue;
		if (!includeInactive && t.isActive !== 1) continue;
		templates.push(t);
	}
	return templates;
}

export async function findTemplateById(
	id: number,
	tenantId: string,
): Promise<ChecklistTemplate | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: checklistTemplateKey(id, tenantId),
		}),
	);
	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as ChecklistTemplate;
}

export async function insertTemplate(
	input: InsertChecklistTemplateInput,
	tenantId: string,
): Promise<ChecklistTemplate> {
	const id = await nextId(ENTITY_NAMES.checklistTemplate, tenantId);
	const now = new Date().toISOString();

	const template: ChecklistTemplate = {
		id,
		tenantId,
		name: input.name,
		icon: input.icon ?? '📋',
		pointsPerItem: input.pointsPerItem ?? 5,
		completionBonus: input.completionBonus ?? 10,
		timeSlot: input.timeSlot ?? 'anytime',
		isActive: input.isActive ?? 1,
		isArchived: 0,
		archivedReason: null,
		createdAt: now,
		updatedAt: now,
		sourcePresetId: input.sourcePresetId ?? null,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...checklistTemplateKey(id, tenantId),
				...template,
			},
		}),
	);

	return template;
}

export async function updateTemplate(
	id: number,
	input: UpdateChecklistTemplateInput,
	tenantId: string,
): Promise<ChecklistTemplate | undefined> {
	const existing = await findTemplateById(id, tenantId);
	if (!existing) return undefined;

	const updates: string[] = ['#updatedAt = :updatedAt'];
	const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
	const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };

	const fields = [
		'name',
		'icon',
		'pointsPerItem',
		'completionBonus',
		'timeSlot',
		'isActive',
	] as const;
	for (const field of fields) {
		if (input[field] !== undefined) {
			updates.push(`#${field} = :${field}`);
			names[`#${field}`] = field;
			values[`:${field}`] = input[field];
		}
	}

	const result = await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: checklistTemplateKey(id, tenantId),
			UpdateExpression: `SET ${updates.join(', ')}`,
			ExpressionAttributeNames: names,
			ExpressionAttributeValues: values,
			ReturnValues: 'ALL_NEW',
		}),
	);

	if (!result.Attributes) return undefined;
	return stripKeys(result.Attributes) as unknown as ChecklistTemplate;
}

export async function deleteTemplate(id: number, tenantId: string): Promise<void> {
	// 関連 assignments / items を先に削除
	await unassignTemplate(id, tenantId);

	// items を全削除 (template 配下)
	const itemsResult = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': tenantPK(`CKTPL#${id}`, tenantId),
				':prefix': checklistItemPrefix(),
			},
		}),
	);
	for (const item of itemsResult.Items ?? []) {
		await getDocClient().send(
			new DeleteCommand({
				TableName: TABLE_NAME,
				Key: { PK: item.PK, SK: item.SK },
			}),
		);
	}

	// template 本体
	await getDocClient().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: checklistTemplateKey(id, tenantId),
		}),
	);
}

// ============================================================
// Distribution (template ↔ child assignments)
// ============================================================

export async function findAssignmentsByTemplate(
	templateId: number,
	tenantId: string,
): Promise<ChecklistTemplateAssignment[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': tenantPK(`CKTPL#${templateId}`, tenantId),
				':prefix': checklistAssignmentPrefix(),
			},
		}),
	);
	return (result.Items ?? []).map(
		(item) => stripKeys(item) as unknown as ChecklistTemplateAssignment,
	);
}

export async function findAssignmentsByChild(
	childId: number,
	tenantId: string,
): Promise<ChecklistTemplateAssignment[]> {
	// Scan: PK starts with T#<tenantId>#CKTPL# and SK = ASSIGN#<padded childId>
	// 件数は family scope = 高々数十 templates × 数 child のため Scan で許容範囲。
	// 将来 hot path 化したら GSI (childId index) を追加検討。
	let lastKey: Record<string, unknown> | undefined;
	const results: ChecklistTemplateAssignment[] = [];
	const tenantPrefix = `${tenantPK('CKTPL#', tenantId)}`;
	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :pkPrefix) AND begins_with(SK, :skPrefix) AND childId = :childId',
				ExpressionAttributeValues: {
					':pkPrefix': tenantPrefix,
					':skPrefix': checklistAssignmentPrefix(),
					':childId': childId,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			results.push(stripKeys(item) as unknown as ChecklistTemplateAssignment);
		}
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);
	return results;
}

export async function assignTemplateToChildren(
	templateId: number,
	childIds: readonly number[],
	tenantId: string,
): Promise<ChecklistTemplateAssignment[]> {
	if (childIds.length === 0) return [];
	const existing = await findAssignmentsByTemplate(templateId, tenantId);
	const existingSet = new Set(existing.map((a) => a.childId));
	const toInsert = childIds.filter((c) => !existingSet.has(c));
	const inserted: ChecklistTemplateAssignment[] = [];

	for (const childId of toInsert) {
		const id = await nextId(ENTITY_NAMES.checklistAssignment, tenantId);
		const now = new Date().toISOString();
		const assignment: ChecklistTemplateAssignment = {
			id,
			templateId,
			childId,
			createdAt: now,
		};
		await getDocClient().send(
			new PutCommand({
				TableName: TABLE_NAME,
				Item: {
					...checklistAssignmentKey(templateId, childId, tenantId),
					...assignment,
				},
			}),
		);
		inserted.push(assignment);
	}
	return inserted;
}

export async function unassignTemplateFromChildren(
	templateId: number,
	childIds: readonly number[],
	tenantId: string,
): Promise<void> {
	if (childIds.length === 0) return;
	for (const childId of childIds) {
		await getDocClient().send(
			new DeleteCommand({
				TableName: TABLE_NAME,
				Key: checklistAssignmentKey(templateId, childId, tenantId),
			}),
		);
	}
}

export async function unassignTemplate(templateId: number, tenantId: string): Promise<void> {
	const assignments = await findAssignmentsByTemplate(templateId, tenantId);
	for (const a of assignments) {
		await getDocClient().send(
			new DeleteCommand({
				TableName: TABLE_NAME,
				Key: checklistAssignmentKey(templateId, a.childId, tenantId),
			}),
		);
	}
}

// ============================================================
// Template items (family items)
// ============================================================

export async function findTemplateItems(
	templateId: number,
	tenantId: string,
): Promise<ChecklistTemplateItem[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': tenantPK(`CKTPL#${templateId}`, tenantId),
				':prefix': checklistItemPrefix(),
			},
		}),
	);

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as ChecklistTemplateItem);
}

export async function insertTemplateItem(
	input: InsertChecklistTemplateItemInput,
	tenantId: string,
): Promise<ChecklistTemplateItem> {
	const id = await nextId(ENTITY_NAMES.checklistItem, tenantId);
	const now = new Date().toISOString();
	const sortOrder = input.sortOrder ?? 0;

	const item: ChecklistTemplateItem = {
		id,
		templateId: input.templateId,
		name: input.name,
		icon: input.icon ?? '✅',
		frequency: input.frequency ?? 'daily',
		direction: input.direction ?? 'morning',
		sortOrder,
		createdAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...checklistItemKey(input.templateId, sortOrder, id, tenantId),
				...item,
			},
		}),
	);

	return item;
}

/**
 * #2845 B1: 旧実装は tenant prefix を含まない全テーブル Scan (`begins_with(SK,'ITEM#') + id`)
 * で全 tenant の item を delete できる形状だった。templateId を受け取り
 * template partition Query (PK = T#<tenant>#CKTPL#<tplId>、tenant 境界を KeyCondition で
 * 構造的に担保) + id filter で解決する。SK = ITEM#<sort>#<id> で sortOrder が不明なため
 * exact Key 構成は不可、全ページ走査 + 一致で早期 return (#2842 paging 正パターン)。
 */
export async function deleteTemplateItem(
	templateId: number,
	id: number,
	tenantId: string,
): Promise<void> {
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				FilterExpression: 'id = :id',
				ExpressionAttributeValues: {
					':pk': tenantPK(`CKTPL#${templateId}`, tenantId),
					':prefix': checklistItemPrefix(),
					':id': id,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		const item = (result.Items ?? [])[0] as Record<string, unknown> | undefined;
		if (item) {
			await getDocClient().send(
				new DeleteCommand({
					TableName: TABLE_NAME,
					Key: { PK: item.PK, SK: item.SK },
				}),
			);
			return;
		}
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);
}

// ============================================================
// Logs (per-child progress)
// ============================================================

export async function findTodayLog(
	childId: number,
	templateId: number,
	date: string,
	tenantId: string,
): Promise<ChecklistLog | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: checklistLogKey(childId, templateId, date, tenantId),
		}),
	);

	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as ChecklistLog;
}

export async function upsertLog(
	input: UpsertChecklistLogInput,
	tenantId: string,
): Promise<ChecklistLog> {
	const existing = await findTodayLog(input.childId, input.templateId, input.checkedDate, tenantId);

	if (existing) {
		const result = await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: checklistLogKey(input.childId, input.templateId, input.checkedDate, tenantId),
				UpdateExpression:
					'SET itemsJson = :itemsJson, completedAll = :completedAll, pointsAwarded = :pointsAwarded',
				ExpressionAttributeValues: {
					':itemsJson': input.itemsJson,
					':completedAll': input.completedAll,
					':pointsAwarded': input.pointsAwarded,
				},
				ReturnValues: 'ALL_NEW',
			}),
		);
		return stripKeys(result.Attributes as Record<string, unknown>) as unknown as ChecklistLog;
	}

	const id = await nextId(ENTITY_NAMES.checklistLog, tenantId);
	const now = new Date().toISOString();

	const log: ChecklistLog = {
		id,
		childId: input.childId,
		templateId: input.templateId,
		checkedDate: input.checkedDate,
		itemsJson: input.itemsJson,
		completedAll: input.completedAll,
		pointsAwarded: input.pointsAwarded,
		createdAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...checklistLogKey(input.childId, input.templateId, input.checkedDate, tenantId),
				...log,
			},
		}),
	);

	return log;
}

/**
 * #3078: child 単位で per-child progress log を全件バルク取得する (export 用)。
 * PK=CHILD#<childId> + begins_with(SK, 'CKLOG#') を全ページ走査する。
 */
export async function findLogsByChild(
	childId: number,
	tenantId: string,
): Promise<ChecklistLog[]> {
	const logs: ChecklistLog[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': childPK(childId, tenantId),
					':prefix': checklistLogPrefix(),
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			logs.push(stripKeys(item) as unknown as ChecklistLog);
		}
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);
	return logs;
}

// ============================================================
// Overrides (per-child)
// ============================================================

export async function findOverrides(
	childId: number,
	date: string,
	tenantId: string,
): Promise<ChecklistOverride[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': checklistOverrideDatePrefix(date),
			},
		}),
	);

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as ChecklistOverride);
}

export async function insertOverride(
	input: InsertChecklistOverrideInput,
	tenantId: string,
): Promise<ChecklistOverride> {
	const id = await nextId(ENTITY_NAMES.checklistOverride, tenantId);
	const now = new Date().toISOString();

	const override: ChecklistOverride = {
		id,
		childId: input.childId,
		targetDate: input.targetDate,
		action: input.action,
		itemName: input.itemName,
		icon: input.icon ?? '✅',
		createdAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...checklistOverrideKey(input.childId, input.targetDate, id, tenantId),
				...override,
			},
		}),
	);

	return override;
}

/**
 * #2845 B1: 旧実装は tenant prefix を含まない全テーブル Scan (`begins_with(SK,'CKOVER#') + id`)
 * で全 tenant の override を delete できる形状だった。childId を受け取り
 * child partition Query (tenant + child 境界を KeyCondition で構造的に担保) + id filter で
 * 解決する。SK = CKOVER#<date>#<id> で date が不明なため exact Key 構成は不可、
 * 全ページ走査 + 一致で早期 return (#2842 paging 正パターン)。
 */
export async function deleteOverride(childId: number, id: number, tenantId: string): Promise<void> {
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				FilterExpression: 'id = :id',
				ExpressionAttributeValues: {
					':pk': childPK(childId, tenantId),
					':prefix': checklistOverridePrefix(),
					':id': id,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		const item = (result.Items ?? [])[0] as Record<string, unknown> | undefined;
		if (item) {
			await getDocClient().send(
				new DeleteCommand({
					TableName: TABLE_NAME,
					Key: { PK: item.PK, SK: item.SK },
				}),
			);
			return;
		}
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);
}

/**
 * テナントの全チェックリストデータを削除。
 * - T#<tenantId>#CKTPL 配下: CKTPL# (テンプレート本体)
 * - T#<tenantId>#CKTPL#<tplId> 配下: ITEM# (item) / ASSIGN# (assignment)
 * - CHILD#* 配下: CKLOG# (ログ), CKOVER# (override)
 */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	// Templates 本体
	await deleteItemsByPkPrefix(tenantPK('CKTPL', tenantId));
	// Items + Assignments (PK=T#<tenantId>#CKTPL#*)
	await deleteItemsByPkPrefix(tenantPK('CKTPL#', tenantId));
	// Logs / Overrides (CHILD#* 配下)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), checklistLogPrefix());
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), checklistOverridePrefix());
}

// ============================================================
// #783: archive / restore (family scope)
// ============================================================

// Phase 7 PR-2a (#2688): reason は ArchivedReason 型 (`ARCHIVED_REASONS` SSOT)。
export async function archiveChecklistTemplates(
	ids: number[],
	reason: ArchivedReason,
	tenantId: string,
): Promise<void> {
	for (const id of ids) {
		const existing = await findTemplateById(id, tenantId);
		if (!existing) continue;
		await getDocClient().send(
			new UpdateCommand({
				TableName: TABLE_NAME,
				Key: checklistTemplateKey(id, tenantId),
				UpdateExpression: 'SET isArchived = :archived, archivedReason = :reason, updatedAt = :now',
				ExpressionAttributeValues: {
					':archived': 1,
					':reason': reason,
					':now': new Date().toISOString(),
				},
			}),
		);
	}
}

export async function restoreArchivedChecklistTemplates(
	reason: ArchivedReason,
	tenantId: string,
): Promise<void> {
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :pkPrefix) AND begins_with(SK, :skPrefix) AND archivedReason = :reason',
				ExpressionAttributeValues: {
					':pkPrefix': tenantPK('CKTPL', tenantId),
					':skPrefix': checklistTemplatePrefix(),
					':reason': reason,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) {
			await getDocClient().send(
				new UpdateCommand({
					TableName: TABLE_NAME,
					Key: { PK: item.PK, SK: item.SK },
					UpdateExpression: 'SET isArchived = :zero, updatedAt = :now REMOVE archivedReason',
					ExpressionAttributeValues: {
						':zero': 0,
						':now': new Date().toISOString(),
					},
				}),
			);
		}
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);
}
