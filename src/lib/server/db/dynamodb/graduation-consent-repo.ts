// src/lib/server/db/dynamodb/graduation-consent-repo.ts
// DynamoDB implementation of IGraduationConsentRepo (#1603 / ADR-0023 §3.8 / §5 I10)
//
// Single-partition (PK=GRADUATION_CONSENT) with SK=<isoTs>#<uuid>。
// 集計とテナント削除のみがアクセスパターンで、低頻度書込み (<50/月) を想定。
// Tenant 単位の検索は属性フィルタによる Scan で対応 (Pre-PMF / ADR-0010)。
// #1596 cancellation-reason-repo と同じパターン。

import { randomUUID } from 'node:crypto';
import { DeleteCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type {
	CreateGraduationConsentInput,
	GraduationConsentRecord,
	GraduationStats,
} from '../interfaces/graduation-consent-repo.interface';
import { getDocClient, TABLE_NAME } from './client';
import { GRADUATION_CONSENT_PK, graduationConsentKey } from './keys';

const DEFAULT_AGGREGATION_DAYS = 90;
const DEFAULT_PUBLIC_SAMPLE_LIMIT = 20;

interface GraduationConsentItem {
	PK: string;
	SK: string;
	id: number;
	tenantId: string;
	nickname: string;
	consented: boolean;
	userPoints: number;
	usagePeriodDays: number;
	message: string | null;
	consentedAt: string;
}

function mapItem(item: Record<string, unknown>): GraduationConsentRecord {
	const i = item as unknown as GraduationConsentItem;
	return {
		id: i.id,
		tenantId: i.tenantId,
		nickname: i.nickname,
		consented: !!i.consented,
		userPoints: i.userPoints ?? 0,
		usagePeriodDays: i.usagePeriodDays ?? 0,
		message: i.message ?? null,
		consentedAt: i.consentedAt,
	};
}

function generateId(): number {
	return Math.floor(Math.random() * 1_000_000_000);
}

export async function create(
	input: CreateGraduationConsentInput,
): Promise<GraduationConsentRecord> {
	const consentedAt = new Date().toISOString();
	const id = generateId();
	const uuid = randomUUID();

	const item: GraduationConsentItem = {
		...graduationConsentKey(consentedAt, uuid),
		id,
		tenantId: input.tenantId,
		nickname: input.nickname,
		consented: input.consented,
		userPoints: input.userPoints,
		usagePeriodDays: input.usagePeriodDays,
		message: input.message ?? null,
		consentedAt,
	};

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: item,
		}),
	);

	return {
		id,
		tenantId: input.tenantId,
		nickname: input.nickname,
		consented: input.consented,
		userPoints: input.userPoints,
		usagePeriodDays: input.usagePeriodDays,
		message: input.message ?? null,
		consentedAt,
	};
}

async function queryAllInPartition(): Promise<GraduationConsentRecord[]> {
	const all: GraduationConsentRecord[] = [];
	let exclusiveStartKey: Record<string, unknown> | undefined;
	do {
		const res = await getDocClient().send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk',
				ExpressionAttributeValues: { ':pk': GRADUATION_CONSENT_PK },
				ExclusiveStartKey: exclusiveStartKey,
			}),
		);
		for (const item of res.Items ?? []) {
			all.push(mapItem(item));
		}
		exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (exclusiveStartKey);
	return all;
}

export async function listByTenant(tenantId: string): Promise<GraduationConsentRecord[]> {
	const all = await queryAllInPartition();
	return all.filter((r) => r.tenantId === tenantId);
}

export async function aggregateRecent(days: number = DEFAULT_AGGREGATION_DAYS): Promise<{
	totalGraduations: number;
	consentedCount: number;
	avgUsagePeriodDays: number;
	publicSamples: GraduationStats['publicSamples'];
}> {
	const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
	const sinceIso = new Date(sinceMs).toISOString();

	const res = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND SK >= :sk',
			ExpressionAttributeValues: {
				':pk': GRADUATION_CONSENT_PK,
				':sk': sinceIso,
			},
		}),
	);

	const items = (res.Items ?? []).map(mapItem);
	const totalGraduations = items.length;
	const consentedCount = items.filter((r) => r.consented).length;
	const sumUsage = items.reduce((s, r) => s + r.usagePeriodDays, 0);
	const avgUsagePeriodDays =
		totalGraduations > 0 ? Math.round((sumUsage / totalGraduations) * 10) / 10 : 0;

	const publicSamples = items
		.filter((r) => r.consented && r.message && r.message.length > 0)
		.sort((a, b) => (a.consentedAt < b.consentedAt ? 1 : -1))
		.slice(0, DEFAULT_PUBLIC_SAMPLE_LIMIT)
		.map((r) => ({
			id: r.id,
			nickname: r.nickname,
			userPoints: r.userPoints,
			usagePeriodDays: r.usagePeriodDays,
			message: r.message ?? '',
			consentedAt: r.consentedAt,
		}));

	return {
		totalGraduations,
		consentedCount,
		avgUsagePeriodDays,
		publicSamples,
	};
}

export async function deleteByTenantId(tenantId: string): Promise<void> {
	const res = await getDocClient().send(
		new ScanCommand({
			TableName: TABLE_NAME,
			FilterExpression: 'PK = :pk AND tenantId = :tid',
			ExpressionAttributeValues: {
				':pk': GRADUATION_CONSENT_PK,
				':tid': tenantId,
			},
		}),
	);
	for (const item of res.Items ?? []) {
		await getDocClient().send(
			new DeleteCommand({
				TableName: TABLE_NAME,
				Key: { PK: item.PK, SK: item.SK },
			}),
		);
	}
}
