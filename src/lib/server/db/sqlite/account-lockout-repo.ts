// SQLite implementation of IAccountLockoutRepo
// settings テーブルを活用して lockout: プレフィックスでロックアウト状態を保存

import { eq } from 'drizzle-orm';
import { db } from '../client';
import type { LockoutRecord } from '../interfaces/account-lockout-repo.interface';
import { settings } from '../schema';

function lockoutSettingKey(email: string): string {
	return `lockout:${email.toLowerCase()}`;
}

export async function getLockout(email: string): Promise<LockoutRecord | null> {
	const key = lockoutSettingKey(email);
	const row = db.select().from(settings).where(eq(settings.key, key)).get();
	if (!row) return null;
	try {
		return JSON.parse(row.value) as LockoutRecord;
	} catch {
		return null;
	}
}

export async function upsertLockout(record: LockoutRecord): Promise<void> {
	const key = lockoutSettingKey(record.email);
	const now = new Date().toISOString();
	const value = JSON.stringify({
		email: record.email.toLowerCase(),
		failedCount: record.failedCount,
		lockedUntil: record.lockedUntil,
		lastFailedAt: record.lastFailedAt,
	});
	db.insert(settings)
		.values({ key, value, updatedAt: now })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value, updatedAt: now },
		})
		.run();
}
