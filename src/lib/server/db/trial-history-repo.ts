// src/lib/server/db/trial-history-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type {
	InsertTrialHistoryInput,
	UpdateTrialConversionInput,
} from './interfaces/trial-history-repo.interface';

export async function findLatestByTenant(tenantId: string) {
	return getRepos().trialHistory.findLatestByTenant(tenantId);
}

export async function insert(input: InsertTrialHistoryInput) {
	return getRepos().trialHistory.insert(input);
}

export async function updateConversion(input: UpdateTrialConversionInput) {
	return getRepos().trialHistory.updateConversion(input);
}
