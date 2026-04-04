// src/lib/server/services/plan-limit-service.ts
// プラン別機能制限サービス (#0196, #0269, #0270)

import { getAuthMode } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { getTrialEndDate } from '$lib/server/services/trial-service';

export interface PlanLimits {
	maxChildren: number | null; // null = 無制限
	maxActivities: number | null;
	historyRetentionDays: number | null;
	canExport: boolean;
	canCustomAvatar: boolean;
	canFreeTextMessage: boolean; // 自由テキストメッセージ（ファミリープラン限定）
	maxCloudExports: number; // クラウド保管の同時保管数上限
}

export type PlanTier = 'free' | 'standard' | 'family';

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
	free: {
		maxChildren: 2,
		maxActivities: 3,
		historyRetentionDays: 90,
		canExport: false,
		canCustomAvatar: false,
		canFreeTextMessage: false,
		maxCloudExports: 0,
	},
	standard: {
		maxChildren: null,
		maxActivities: null,
		historyRetentionDays: 365,
		canExport: true,
		canCustomAvatar: true,
		canFreeTextMessage: false,
		maxCloudExports: 3,
	},
	family: {
		maxChildren: null,
		maxActivities: null,
		historyRetentionDays: null,
		canExport: true,
		canCustomAvatar: true,
		canFreeTextMessage: true,
		maxCloudExports: 10,
	},
};

/** テナントのプランティアを判定 */
export function resolvePlanTier(
	licenseStatus: string,
	planId?: string,
	trialEndDate?: string | null,
): PlanTier {
	// ローカル版（セルフホスト）は常に全機能解放
	if (getAuthMode() === 'local') return 'family';
	// アクティブな有料プラン
	if (licenseStatus === 'active') {
		return planId?.startsWith('family') ? 'family' : 'standard';
	}
	// トライアル期間中 → ファミリー全機能解放
	if (trialEndDate && new Date(trialEndDate) > new Date()) {
		return 'family';
	}
	return 'free';
}

/** テナントのプランティアを非同期で判定（トライアル状態を自動チェック） */
export async function resolveFullPlanTier(
	tenantId: string,
	licenseStatus: string,
	planId?: string,
): Promise<PlanTier> {
	const trialEnd = await getTrialEndDate(tenantId);
	return resolvePlanTier(licenseStatus, planId, trialEnd);
}

/** 有料プランかどうか */
export function isPaidTier(tier: PlanTier): boolean {
	return tier === 'standard' || tier === 'family';
}

/** プラン別制限を取得 */
export function getPlanLimits(tier: PlanTier): PlanLimits {
	return PLAN_LIMITS[tier];
}

/** 保持期間カットオフ日を取得。null = 制限なし */
export function getHistoryCutoffDate(tier: PlanTier): string | null {
	const limits = PLAN_LIMITS[tier];
	if (limits.historyRetentionDays === null) return null;
	const d = new Date();
	d.setDate(d.getDate() - limits.historyRetentionDays);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * 日付範囲オプションに保持期間フィルタを適用する
 * from が cutoff より前の場合、cutoff に上書き
 */
export function applyRetentionFilter(
	tier: PlanTier,
	options: { from?: string; to?: string } = {},
): { from?: string; to?: string } {
	const cutoff = getHistoryCutoffDate(tier);
	if (cutoff === null) return options;
	const from = options.from && options.from > cutoff ? options.from : cutoff;
	return { ...options, from };
}

/**
 * 保持期間外のデータが存在するかチェック
 * (cutoff 日より前にデータがあれば true)
 */
export async function hasArchivedData(
	tenantId: string,
	childId: number,
	tier: PlanTier,
): Promise<boolean> {
	const cutoff = getHistoryCutoffDate(tier);
	if (cutoff === null) return false;

	const repos = getRepos();
	// cutoff日より前の活動ログが存在するか
	const logs = await repos.activity.findTodayLogsWithCategory(childId, cutoff, tenantId);
	if (logs.length > 0) return true;

	// 1日前のデータも確認
	const prevDay = new Date(cutoff);
	prevDay.setDate(prevDay.getDate() - 1);
	const prevStr = `${prevDay.getFullYear()}-${String(prevDay.getMonth() + 1).padStart(2, '0')}-${String(prevDay.getDate()).padStart(2, '0')}`;
	const oldLogs = await repos.activity.findTodayLogsWithCategory(childId, prevStr, tenantId);
	return oldLogs.length > 0;
}

/** 子供追加の制限チェック */
export async function checkChildLimit(
	tenantId: string,
	licenseStatus: string,
): Promise<{ allowed: boolean; current: number; max: number | null }> {
	const limits = getPlanLimits(await resolveFullPlanTier(tenantId, licenseStatus));
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
	const limits = getPlanLimits(await resolveFullPlanTier(tenantId, licenseStatus));
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
