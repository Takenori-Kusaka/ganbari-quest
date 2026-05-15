// Demo IViewerTokenRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { InsertViewerTokenInput, ViewerToken } from '../types';

export async function findByTenant(_tenantId: string): Promise<ViewerToken[]> {
	return [];
}

export async function findByToken(_token: string): Promise<ViewerToken | undefined> {
	return undefined;
}

export async function insert(
	input: InsertViewerTokenInput,
	tenantId: string,
): Promise<ViewerToken> {
	return {
		id: 0,
		tenantId,
		token: input.token,
		label: input.label ?? null,
		expiresAt: input.expiresAt ?? null,
		createdAt: new Date().toISOString(),
		revokedAt: null,
	};
}

export async function revoke(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function deleteById(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}
