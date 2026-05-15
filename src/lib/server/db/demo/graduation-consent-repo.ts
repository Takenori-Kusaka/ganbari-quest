// Demo IGraduationConsentRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	CreateGraduationConsentInput,
	GraduationConsentRecord,
	GraduationStats,
} from '../interfaces/graduation-consent-repo.interface';

export async function create(
	input: CreateGraduationConsentInput,
): Promise<GraduationConsentRecord> {
	return {
		id: 0,
		tenantId: input.tenantId,
		nickname: input.nickname,
		consented: input.consented,
		userPoints: input.userPoints,
		usagePeriodDays: input.usagePeriodDays,
		message: input.message ?? null,
		consentedAt: new Date().toISOString(),
	};
}

export async function listByTenant(_tenantId: string): Promise<GraduationConsentRecord[]> {
	return [];
}

export async function aggregateRecent(_days?: number): Promise<{
	totalGraduations: number;
	consentedCount: number;
	avgUsagePeriodDays: number;
	publicSamples: GraduationStats['publicSamples'];
}> {
	return {
		totalGraduations: 0,
		consentedCount: 0,
		avgUsagePeriodDays: 0,
		publicSamples: [],
	};
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
