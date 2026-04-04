// src/lib/server/db/trial-history-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertTrialHistoryInput } from './interfaces/trial-history-repo.interface';

export async function findLatestByTenant(tenantId: string) {
	return getRepos().trialHistory.findLatestByTenant(tenantId);
}

export async function insert(input: InsertTrialHistoryInput) {
	return getRepos().trialHistory.insert(input);
}
