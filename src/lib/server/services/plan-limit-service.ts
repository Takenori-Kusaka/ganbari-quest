// src/lib/server/services/plan-limit-service.ts
// プラン別機能制限サービス (#0196)

import { getAuthMode } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';

export interface PlanLimits {
	maxChildren: number | null; // null = 無制限
	maxActivities: number | null;
	historyRetentionDays: number | null;
	canExport: boolean;
	canCustomAvatar: boolean;
}

export type PlanTier = 'free' | 'paid';

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
	free: {
		maxChildren: 1,
		maxActivities: 5,
		historyRetentionDays: 30,
		canExport: false,
		canCustomAvatar: false,
	},
	paid: {
		maxChildren: null,
		maxActivities: null,
		historyRetentionDays: null,
		canExport: true,
		canCustomAvatar: true,
	},
};

/** テナントのプランティアを判定 */
export function resolvePlanTier(licenseStatus: string): PlanTier {
	// ローカル版（セルフホスト）は常に全機能解放
	if (getAuthMode() === 'local') return 'paid';
	return licenseStatus === 'active' ? 'paid' : 'free';
}

/** プラン別制限を取得 */
export function getPlanLimits(tier: PlanTier): PlanLimits {
	return PLAN_LIMITS[tier];
}

/** 子供追加の制限チェック */
export async function checkChildLimit(
	tenantId: string,
	licenseStatus: string,
): Promise<{ allowed: boolean; current: number; max: number | null }> {
	const limits = getPlanLimits(resolvePlanTier(licenseStatus));
	if (limits.maxChildren === null) {
		return { allowed: true, current: 0, max: null };
	}

	const repos = getRepos();
	const children = await repos.child.findAllChildren(tenantId);
	const current = children.length;

	return {
		allowed: current < limits.maxChildren,
		current,
		max: limits.maxChildren,
	};
}

/** 活動マスタ追加の制限チェック */
export async function checkActivityLimit(
	tenantId: string,
	licenseStatus: string,
): Promise<{ allowed: boolean; current: number; max: number | null }> {
	const limits = getPlanLimits(resolvePlanTier(licenseStatus));
	if (limits.maxActivities === null) {
		return { allowed: true, current: 0, max: null };
	}

	const repos = getRepos();
	const activities = await repos.activity.findActivities(tenantId);
	const customActivities = activities.filter((a) => a.source === 'custom');
	const current = customActivities.length;

	return {
		allowed: current < limits.maxActivities,
		current,
		max: limits.maxActivities,
	};
}
