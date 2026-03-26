// src/lib/server/services/license-service.ts
// ライセンス情報取得サービス (#0130)

import type { Tenant } from '$lib/server/auth/entities';
import { getRepos } from '$lib/server/db/factory';

export interface LicenseInfo {
	plan: Tenant['plan'] | 'free';
	status: Tenant['status'];
	licenseKey?: string;
	tenantName: string;
	stripeCustomerId?: string;
	stripeSubscriptionId?: string;
	planExpiresAt?: string;
	createdAt: string;
	updatedAt: string;
}

/** テナントのライセンス情報を取得 */
export async function getLicenseInfo(tenantId: string): Promise<LicenseInfo | null> {
	const repos = getRepos();
	const tenant = await repos.auth.findTenantById(tenantId);
	if (!tenant) return null;

	return {
		plan: tenant.plan ?? 'free',
		status: tenant.status,
		licenseKey: tenant.licenseKey,
		tenantName: tenant.name,
		stripeCustomerId: tenant.stripeCustomerId,
		stripeSubscriptionId: tenant.stripeSubscriptionId,
		planExpiresAt: tenant.planExpiresAt,
		createdAt: tenant.createdAt,
		updatedAt: tenant.updatedAt,
	};
}
