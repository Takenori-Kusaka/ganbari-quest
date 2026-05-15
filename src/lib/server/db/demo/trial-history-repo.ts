// Demo ITrialHistoryRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	InsertTrialHistoryInput,
	TrialHistoryRow,
	UpdateTrialConversionInput,
} from '../interfaces/trial-history-repo.interface';

export async function findLatestByTenant(_tenantId: string): Promise<TrialHistoryRow | undefined> {
	return undefined;
}

export async function findActiveTrials(): Promise<TrialHistoryRow[]> {
	return [];
}

export async function insert(_input: InsertTrialHistoryInput): Promise<void> {
	// Stub: no-op
}

export async function updateConversion(_input: UpdateTrialConversionInput): Promise<void> {
	// Stub: no-op
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
