// src/lib/server/db/dynamodb/checklist-repo.ts
// DynamoDB implementation of IChecklistRepo

import {
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
	ChecklistLog,
	ChecklistOverride,
	ChecklistTemplate,
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

function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

// ============================================================
// Templates
// ============================================================

export async function findTemplatesByChild(
	childId: number,
	tenantId: string,
	includeInactive?: boolean,
): Promise<ChecklistTemplate[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': checklistTemplatePrefix(),
			},
		}),
	);

	let items = (result.Items ?? []).map((item) => stripKeys(item) as unknown as ChecklistTemplate);

	if (!includeInactive) {
		items = items.filter((t) => t.isActive === 1);
	}

	return items;
}

export async function findTemplateById(
	id: number,
	_tenantId: string,
): Promise<ChecklistTemplate | undefined> {
	// Need to scan since we don't know childId
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :prefix) AND id = :id',
				ExpressionAttributeValues: {
					':prefix': checklistTemplatePrefix(),
					':id': id,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		if (result.Items && result.Items.length > 0) {
			return stripKeys(result.Items[0] as Record<string, unknown>) as unknown as ChecklistTemplate;
		}
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	return undefined;
}

export async function insertTemplate(
	input: InsertChecklistTemplateInput,
	tenantId: string,
): Promise<ChecklistTemplate> {
	const id = await nextId(ENTITY_NAMES.checklistTemplate, tenantId);
	const now = new Date().toISOString();

	const template: ChecklistTemplate = {
		id,
		childId: input.childId,
		name: input.name,
		icon: input.icon ?? '📋',
		pointsPerItem: input.pointsPerItem ?? 5,
		completionBonus: input.completionBonus ?? 10,
		timeSlot: input.timeSlot ?? 'anytime',
		isActive: input.isActive ?? 1,
		createdAt: now,
		updatedAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...checklistTemplateKey(input.childId, id, tenantId),
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

	const fields = ['name', 'icon', 'pointsPerItem', 'completionBonus', 'isActive'] as const;
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
			Key: checklistTemplateKey(existing.childId, id, tenantId),
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
	const existing = await findTemplateById(id, tenantId);
	if (!existing) return;

	await getDocClient().send(
		new DeleteCommand({
			TableName: TABLE_NAME,
			Key: checklistTemplateKey(existing.childId, id, tenantId),
		}),
	);
}

// ============================================================
// Template items
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

export async function deleteTemplateItem(id: number, _tenantId: string): Promise<void> {
	// Scan to find the item since we don't have templateId/sortOrder
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :prefix) AND id = :id',
				ExpressionAttributeValues: {
					':prefix': checklistItemPrefix(),
					':id': id,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		if (result.Items && result.Items.length > 0) {
			const item = result.Items[0] as Record<string, unknown>;
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
// Logs
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

// ============================================================
// Overrides
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

export async function deleteOverride(id: number): Promise<void> {
	// Scan to find the override
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :prefix) AND id = :id',
				ExpressionAttributeValues: {
					':prefix': 'CKOVER#',
					':id': id,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		if (result.Items && result.Items.length > 0) {
			const item = result.Items[0] as Record<string, unknown>;
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
 * - CHILD#* 配下: CKTPL# (テンプレート), CKLOG# (ログ), CKOVER# (オーバーライド)
 * - CKTPL#* 配下: ITEM# (テンプレートアイテム)
 */
export async function deleteByTenantId(tenantId: string): Promise<void> {
	// Delete checklist template items (PK=T#<tenantId>#CKTPL#*, SK=ITEM#*)
	await deleteItemsByPkPrefix(tenantPK('CKTPL#', tenantId));
	// Delete templates (CHILD#* 配下の CKTPL# アイテム)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), checklistTemplatePrefix());
	// Delete logs (CHILD#* 配下の CKLOG# アイテム)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), checklistLogPrefix());
	// Delete overrides (CHILD#* 配下の CKOVER# アイテム)
	await deleteItemsByPkPrefix(tenantPK('CHILD#', tenantId), checklistOverridePrefix());
}
