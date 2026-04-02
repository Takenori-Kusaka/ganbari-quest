// src/lib/server/db/account-lockout-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { LockoutRecord } from './interfaces/account-lockout-repo.interface';

export async function getLockout(email: string): Promise<LockoutRecord | null> {
	return getRepos().accountLockout.getLockout(email);
}

export async function upsertLockout(record: LockoutRecord): Promise<void> {
	return getRepos().accountLockout.upsertLockout(record);
}
