// src/lib/server/security/account-lockout.ts
// アカウント単位のログインロックアウト（DynamoDB永続化）
// Stripe要件3: 10回以下のログイン失敗でアカウントをロック

import { TABLE_NAME, getDocClient } from '$lib/server/db/dynamodb/client';
import { logger } from '$lib/server/logger';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30分

interface LockoutRecord {
	PK: string;
	SK: string;
	email: string;
	failedCount: number;
	lockedUntil: string | null;
	lastFailedAt: string | null;
	ttl: number;
}

function lockoutKey(email: string): { PK: string; SK: string } {
	return {
		PK: `LOCKOUT#${email.toLowerCase()}`,
		SK: 'STATUS',
	};
}

async function getLockoutRecord(email: string): Promise<LockoutRecord | null> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: lockoutKey(email),
		}),
	);
	return (result.Item as LockoutRecord) ?? null;
}

async function putLockoutRecord(record: LockoutRecord): Promise<void> {
	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: record,
		}),
	);
}

export interface LockoutCheckResult {
	locked: boolean;
	remainingMinutes?: number;
	failedCount: number;
}

/**
 * ログイン試行前にアカウントがロックされているかチェック
 */
export async function checkAccountLockout(email: string): Promise<LockoutCheckResult> {
	try {
		const record = await getLockoutRecord(email);
		if (!record) {
			return { locked: false, failedCount: 0 };
		}

		if (record.lockedUntil) {
			const lockedUntil = new Date(record.lockedUntil);
			const now = new Date();
			if (now < lockedUntil) {
				const remaining = Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000);
				return { locked: true, remainingMinutes: remaining, failedCount: record.failedCount };
			}
			// ロック期間が過ぎた → カウンターをリセット
		}

		return { locked: false, failedCount: record.failedCount };
	} catch (e) {
		logger.warn('[LOCKOUT] checkAccountLockout failed, allowing login', {
			context: { email, error: e instanceof Error ? e.message : String(e) },
		});
		return { locked: false, failedCount: 0 };
	}
}

/**
 * ログイン失敗時にカウンターをインクリメント。閾値超過でロック
 */
export async function recordLoginFailure(email: string): Promise<LockoutCheckResult> {
	try {
		const record = await getLockoutRecord(email);
		const now = new Date();
		const key = lockoutKey(email);

		// ロック期間が過ぎていたらリセット
		let currentCount = record?.failedCount ?? 0;
		if (record?.lockedUntil && new Date(record.lockedUntil) < now) {
			currentCount = 0;
		}

		const newCount = currentCount + 1;
		const shouldLock = newCount >= MAX_FAILED_ATTEMPTS;
		const lockedUntil = shouldLock
			? new Date(now.getTime() + LOCKOUT_DURATION_MS).toISOString()
			: null;

		// TTL: ロック解除後24時間、またはロックなしなら1時間後に自動削除
		const ttlSeconds = shouldLock
			? Math.floor((now.getTime() + LOCKOUT_DURATION_MS + 86400000) / 1000)
			: Math.floor((now.getTime() + 3600000) / 1000);

		await putLockoutRecord({
			...key,
			email: email.toLowerCase(),
			failedCount: newCount,
			lockedUntil,
			lastFailedAt: now.toISOString(),
			ttl: ttlSeconds,
		});

		if (shouldLock) {
			logger.warn('[LOCKOUT] Account locked due to excessive failed attempts', {
				context: { email, failedCount: newCount },
			});
			return {
				locked: true,
				remainingMinutes: Math.ceil(LOCKOUT_DURATION_MS / 60000),
				failedCount: newCount,
			};
		}

		return { locked: false, failedCount: newCount };
	} catch (e) {
		logger.warn('[LOCKOUT] recordLoginFailure failed', {
			context: { email, error: e instanceof Error ? e.message : String(e) },
		});
		return { locked: false, failedCount: 0 };
	}
}

/**
 * ログイン成功時にカウンターをリセット
 */
export async function resetLoginFailures(email: string): Promise<void> {
	try {
		const record = await getLockoutRecord(email);
		if (record && record.failedCount > 0) {
			const key = lockoutKey(email);
			const now = new Date();
			await putLockoutRecord({
				...key,
				email: email.toLowerCase(),
				failedCount: 0,
				lockedUntil: null,
				lastFailedAt: null,
				ttl: Math.floor((now.getTime() + 3600000) / 1000),
			});
		}
	} catch (e) {
		logger.warn('[LOCKOUT] resetLoginFailures failed', {
			context: { email, error: e instanceof Error ? e.message : String(e) },
		});
	}
}
