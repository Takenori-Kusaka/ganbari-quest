// src/lib/server/security/account-lockout.ts
// アカウント単位のログインロックアウト（ファクトリ経由でバックエンド透過）
// Stripe要件3: 10回以下のログイン失敗でアカウントをロック

import { getLockout, upsertLockout } from '$lib/server/db/account-lockout-repo';
import { logger } from '$lib/server/logger';

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30分

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
		const record = await getLockout(email);
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
		const record = await getLockout(email);
		const now = new Date();

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

		await upsertLockout({
			email: email.toLowerCase(),
			failedCount: newCount,
			lockedUntil,
			lastFailedAt: now.toISOString(),
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
		const record = await getLockout(email);
		if (record && record.failedCount > 0) {
			await upsertLockout({
				email: email.toLowerCase(),
				failedCount: 0,
				lockedUntil: null,
				lastFailedAt: null,
			});
		}
	} catch (e) {
		logger.warn('[LOCKOUT] resetLoginFailures failed', {
			context: { email, error: e instanceof Error ? e.message : String(e) },
		});
	}
}
