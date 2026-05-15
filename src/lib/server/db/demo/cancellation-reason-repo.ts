// Demo ICancellationReasonRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	CancellationReasonAggregation,
	CancellationReasonRecord,
	CreateCancellationReasonInput,
} from '../interfaces/cancellation-reason-repo.interface';

export async function create(
	input: CreateCancellationReasonInput,
): Promise<CancellationReasonRecord> {
	return {
		id: 0,
		tenantId: input.tenantId,
		category: input.category,
		freeText: input.freeText ?? null,
		planAtCancellation: input.planAtCancellation ?? null,
		stripeSubscriptionId: input.stripeSubscriptionId ?? null,
		createdAt: new Date().toISOString(),
	};
}

export async function listByTenant(_tenantId: string): Promise<CancellationReasonRecord[]> {
	return [];
}

export async function aggregateRecent(_days?: number): Promise<{
	total: number;
	breakdown: CancellationReasonAggregation[];
}> {
	return { total: 0, breakdown: [] };
}

export async function searchFreeText(
	_query: string,
	_limit?: number,
): Promise<CancellationReasonRecord[]> {
	return [];
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
