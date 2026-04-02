// DynamoDB implementation of IAccountLockoutRepo

import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { LockoutRecord } from '../interfaces/account-lockout-repo.interface';
import { TABLE_NAME, getDocClient } from './client';

function lockoutKey(email: string): { PK: string; SK: string } {
	return {
		PK: `LOCKOUT#${email.toLowerCase()}`,
		SK: 'STATUS',
	};
}

export async function getLockout(email: string): Promise<LockoutRecord | null> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: lockoutKey(email),
		}),
	);
	if (!result.Item) return null;
	return {
		email: result.Item.email as string,
		failedCount: (result.Item.failedCount as number) ?? 0,
		lockedUntil: (result.Item.lockedUntil as string) ?? null,
		lastFailedAt: (result.Item.lastFailedAt as string) ?? null,
	};
}

export async function upsertLockout(record: LockoutRecord): Promise<void> {
	const key = lockoutKey(record.email);
	const now = Date.now();

	// TTL: ロック中は解除後24時間、非ロック時は1時間後に自動削除
	const ttl = record.lockedUntil
		? Math.floor((new Date(record.lockedUntil).getTime() + 86400000) / 1000)
		: Math.floor((now + 3600000) / 1000);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				email: record.email.toLowerCase(),
				failedCount: record.failedCount,
				lockedUntil: record.lockedUntil,
				lastFailedAt: record.lastFailedAt,
				ttl,
			},
		}),
	);
}
