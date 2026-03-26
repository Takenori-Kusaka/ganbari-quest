// src/lib/server/db/dynamodb/career-repo.ts
// DynamoDB implementation of ICareerRepo

import {
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
	CareerField,
	CareerPlan,
	CareerPlanHistory,
	InsertCareerPlanHistoryInput,
	InsertCareerPlanInput,
	InsertCareerPointInput,
	PointLedgerEntry,
	UpdateCareerPlanInput,
} from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import {
	ENTITY_NAMES,
	careerFieldKey,
	careerPlanHistoryKey,
	careerPlanHistoryPrefix,
	careerPlanKey,
	careerPlanPrefix,
	childPK,
	pointBalanceKey,
	pointLedgerKey,
	tenantPK,
} from './keys';

function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

// ============================================================
// Career fields
// ============================================================

export async function findAllCareerFields(): Promise<CareerField[]> {
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
				ExpressionAttributeValues: {
					':prefix': 'CAREER#',
					':sk': 'MASTER',
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		items.push(...(result.Items ?? []));
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	return items.map((item) => stripKeys(item) as unknown as CareerField);
}

export async function findCareerFieldsByAge(
	age: number,
	_tenantId: string,
): Promise<CareerField[]> {
	const all = await findAllCareerFields();
	return all.filter((f) => f.minAge <= age);
}

export async function findCareerFieldById(
	id: number,
	_tenantId: string,
): Promise<CareerField | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: careerFieldKey(id),
		}),
	);
	if (!result.Item) return undefined;
	return stripKeys(result.Item) as unknown as CareerField;
}

// ============================================================
// Career plans
// ============================================================

export async function findActiveCareerPlan(
	childId: number,
	tenantId: string,
): Promise<CareerPlan | undefined> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			FilterExpression: 'isActive = :active',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': careerPlanPrefix(),
				':active': 1,
			},
			Limit: 1,
		}),
	);
	if (!result.Items || result.Items.length === 0) return undefined;
	return stripKeys(result.Items[0] as Record<string, unknown>) as unknown as CareerPlan;
}

export async function findCareerPlansByChildId(
	childId: number,
	tenantId: string,
): Promise<CareerPlan[]> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': childPK(childId, tenantId),
				':prefix': careerPlanPrefix(),
			},
		}),
	);
	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as CareerPlan);
}

export async function insertCareerPlan(
	input: InsertCareerPlanInput,
	tenantId: string,
): Promise<CareerPlan> {
	const id = await nextId(ENTITY_NAMES.careerPlan, tenantId);
	const now = new Date().toISOString();

	const plan: CareerPlan = {
		id,
		childId: input.childId,
		careerFieldId: input.careerFieldId ?? null,
		dreamText: input.dreamText ?? null,
		mandalaChart: input.mandalaChart ?? '{}',
		timeline3y: input.timeline3y ?? null,
		timeline5y: input.timeline5y ?? null,
		timeline10y: input.timeline10y ?? null,
		targetStatuses: '{}',
		version: 1,
		isActive: 1,
		createdAt: now,
		updatedAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...careerPlanKey(input.childId, id, tenantId),
				...plan,
			},
		}),
	);

	return plan;
}

export async function updateCareerPlan(
	planId: number,
	input: UpdateCareerPlanInput,
	_tenantId: string,
): Promise<CareerPlan | undefined> {
	// First find the plan to get childId
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await getDocClient().send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression: 'begins_with(SK, :prefix) AND id = :id',
				ExpressionAttributeValues: {
					':prefix': careerPlanPrefix(),
					':id': planId,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		items.push(...(result.Items ?? []));
		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	if (items.length === 0) return undefined;

	const existing = items[0]!;
	const updates: string[] = ['#updatedAt = :updatedAt'];
	const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
	const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };

	const fields = [
		'careerFieldId',
		'dreamText',
		'mandalaChart',
		'timeline3y',
		'timeline5y',
		'timeline10y',
		'version',
	] as const;
	for (const field of fields) {
		if (input[field as keyof UpdateCareerPlanInput] !== undefined) {
			updates.push(`#${field} = :${field}`);
			names[`#${field}`] = field;
			values[`:${field}`] = input[field as keyof UpdateCareerPlanInput];
		}
	}

	const result = await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: { PK: existing.PK, SK: existing.SK },
			UpdateExpression: `SET ${updates.join(', ')}`,
			ExpressionAttributeNames: names,
			ExpressionAttributeValues: values,
			ReturnValues: 'ALL_NEW',
		}),
	);

	if (!result.Attributes) return undefined;
	return stripKeys(result.Attributes) as unknown as CareerPlan;
}

export async function deactivateCareerPlans(childId: number, tenantId: string): Promise<void> {
	const plans = await findCareerPlansByChildId(childId, tenantId);
	for (const plan of plans) {
		if (plan.isActive === 1) {
			await getDocClient().send(
				new UpdateCommand({
					TableName: TABLE_NAME,
					Key: careerPlanKey(childId, plan.id, tenantId),
					UpdateExpression: 'SET isActive = :inactive, updatedAt = :now',
					ExpressionAttributeValues: {
						':inactive': 0,
						':now': new Date().toISOString(),
					},
				}),
			);
		}
	}
}

// ============================================================
// Plan history
// ============================================================

export async function insertCareerPlanHistory(
	input: InsertCareerPlanHistoryInput,
	tenantId: string,
): Promise<CareerPlanHistory> {
	const id = await nextId(ENTITY_NAMES.careerPlanHistory, tenantId);
	const now = new Date().toISOString();

	const history: CareerPlanHistory = {
		id,
		careerPlanId: input.careerPlanId,
		action: input.action,
		pointsEarned: input.pointsEarned,
		snapshot: input.snapshot ?? '{}',
		createdAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...careerPlanHistoryKey(input.careerPlanId, now, id, tenantId),
				...history,
			},
		}),
	);

	return history;
}

export async function findLatestHistoryByAction(
	careerPlanId: number,
	action: string,
	tenantId: string,
): Promise<CareerPlanHistory | undefined> {
	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			FilterExpression: '#action = :action',
			ExpressionAttributeNames: { '#action': 'action' },
			ExpressionAttributeValues: {
				':pk': tenantPK(`CARPLAN#${careerPlanId}`, tenantId),
				':prefix': careerPlanHistoryPrefix(),
				':action': action,
			},
			ScanIndexForward: false,
			Limit: 1,
		}),
	);

	if (!result.Items || result.Items.length === 0) return undefined;
	return stripKeys(result.Items[0] as Record<string, unknown>) as unknown as CareerPlanHistory;
}

// ============================================================
// Points
// ============================================================

export async function insertCareerPointEntry(
	input: InsertCareerPointInput,
	tenantId: string,
): Promise<PointLedgerEntry> {
	const id = await nextId(ENTITY_NAMES.pointLedger, tenantId);
	const now = new Date().toISOString();

	const entry: PointLedgerEntry = {
		id,
		childId: input.childId,
		amount: input.amount,
		type: 'career',
		description: input.description,
		referenceId: input.referenceId ?? null,
		createdAt: now,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...pointLedgerKey(input.childId, now, id, tenantId),
				...entry,
			},
		}),
	);

	// Update balance atomically
	await getDocClient().send(
		new UpdateCommand({
			TableName: TABLE_NAME,
			Key: pointBalanceKey(input.childId, tenantId),
			UpdateExpression: 'ADD balance :amount',
			ExpressionAttributeValues: {
				':amount': input.amount,
			},
		}),
	);

	return entry;
}
