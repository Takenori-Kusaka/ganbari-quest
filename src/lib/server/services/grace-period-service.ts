// src/lib/server/services/grace-period-service.ts
// #742: プラン別の削除後グレースピリオド管理
//
// アカウント削除を「ソフトデリート」として扱い、プラン別に定められた
// 猶予期間内であれば復元を可能にする。
//
// プラン別グレースピリオド:
//   free:     0日（即時削除）
//   standard: 7日間
//   family:   30日間

import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import type { PlanTier } from './plan-limit-service';
import { resolveFullPlanTier } from './plan-limit-service';

// ============================================================
// Constants
// ============================================================

/** プラン別グレースピリオド（日数）。0 = 即時物理削除 */
export const DELETION_GRACE_PERIOD_DAYS: Record<PlanTier, number> = {
	free: 0,
	standard: 7,
	family: 30,
} as const;

// ============================================================
// Types
// ============================================================

export interface SoftDeleteResult {
	success: boolean;
	softDeletedAt: string;
	gracePeriodDays: number;
	physicalDeletionDate: string;
	requiresImmediateDeletion: boolean;
}

export interface GracePeriodStatus {
	isSoftDeleted: boolean;
	softDeletedAt: string | null;
	gracePeriodDays: number;
	physicalDeletionDate: string | null;
	daysRemaining: number;
	isExpired: boolean;
	planTier: PlanTier | null;
}

export interface RestoreResult {
	success: boolean;
	tenantId: string;
}

// ============================================================
// Soft delete
// ============================================================

/**
 * テナントをソフトデリートする。
 *
 * プランに応じたグレースピリオドを計算し、テナントに soft_deleted_at を記録する。
 * free プランは即時物理削除が必要なため requiresImmediateDeletion=true を返す。
 */
export async function softDeleteTenant(
	tenantId: string,
	licenseStatus: string,
	planId?: string,
): Promise<SoftDeleteResult> {
	const planTier = await resolveFullPlanTier(tenantId, licenseStatus, planId);
	const graceDays = DELETION_GRACE_PERIOD_DAYS[planTier];
	const now = new Date();
	const softDeletedAt = now.toISOString();

	const physicalDate = new Date(now);
	physicalDate.setDate(physicalDate.getDate() + graceDays);
	const physicalDeletionDate = physicalDate.toISOString();

	if (graceDays === 0) {
		logger.info('[grace-period] Free plan: immediate deletion required', {
			context: { tenantId, planTier },
		});
		return {
			success: true,
			softDeletedAt,
			gracePeriodDays: 0,
			physicalDeletionDate: softDeletedAt,
			requiresImmediateDeletion: true,
		};
	}

	// ソフトデリート情報を Tenant に保存
	const repos = getRepos();
	await repos.auth.updateTenantStripe(tenantId, {
		// soft delete fields は updateTenantStripe の拡張で対応
		// 既存の updateTenantStripe に softDeletedAt / deletionGracePlanTier を追加する必要がある
	});

	// settings テーブルにグレースピリオド情報を保存（DynamoDB auth-repo の拡張を避ける）
	await repos.settings.setSetting('soft_deleted_at', softDeletedAt, tenantId);
	await repos.settings.setSetting('deletion_grace_plan_tier', planTier, tenantId);
	await repos.settings.setSetting('physical_deletion_date', physicalDeletionDate, tenantId);

	logger.info('[grace-period] Tenant soft deleted', {
		context: { tenantId, planTier, graceDays, physicalDeletionDate },
	});

	return {
		success: true,
		softDeletedAt,
		gracePeriodDays: graceDays,
		physicalDeletionDate,
		requiresImmediateDeletion: false,
	};
}

// ============================================================
// Grace period status
// ============================================================

/**
 * テナントのグレースピリオド状態を取得する。
 */
export async function getGracePeriodStatus(tenantId: string): Promise<GracePeriodStatus> {
	const repos = getRepos();
	const values = await repos.settings.getSettings(
		['soft_deleted_at', 'deletion_grace_plan_tier', 'physical_deletion_date'],
		tenantId,
	);

	const softDeletedAt = values.soft_deleted_at ?? null;
	if (!softDeletedAt) {
		return {
			isSoftDeleted: false,
			softDeletedAt: null,
			gracePeriodDays: 0,
			physicalDeletionDate: null,
			daysRemaining: 0,
			isExpired: false,
			planTier: null,
		};
	}

	const planTier = (values.deletion_grace_plan_tier as PlanTier) ?? 'free';
	const graceDays = DELETION_GRACE_PERIOD_DAYS[planTier];
	const physicalDeletionDate = values.physical_deletion_date ?? null;

	const now = new Date();
	const deleteDate = physicalDeletionDate ? new Date(physicalDeletionDate) : now;
	const daysRemaining = Math.max(
		0,
		Math.ceil((deleteDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
	);
	const isExpired = now >= deleteDate;

	return {
		isSoftDeleted: true,
		softDeletedAt,
		gracePeriodDays: graceDays,
		physicalDeletionDate,
		daysRemaining,
		isExpired,
		planTier,
	};
}

// ============================================================
// Restore
// ============================================================

/**
 * ソフトデリートされたテナントを復元する。
 *
 * グレースピリオド内であれば、ソフトデリート情報をクリアして
 * テナントを通常状態に戻す。
 */
export async function restoreSoftDeletedTenant(tenantId: string): Promise<RestoreResult> {
	const status = await getGracePeriodStatus(tenantId);

	if (!status.isSoftDeleted) {
		logger.warn('[grace-period] Tenant is not soft deleted', {
			context: { tenantId },
		});
		return { success: false, tenantId };
	}

	if (status.isExpired) {
		logger.warn('[grace-period] Grace period expired, cannot restore', {
			context: { tenantId, physicalDeletionDate: status.physicalDeletionDate },
		});
		return { success: false, tenantId };
	}

	// ソフトデリート情報をクリア
	const repos = getRepos();
	await repos.settings.setSetting('soft_deleted_at', '', tenantId);
	await repos.settings.setSetting('deletion_grace_plan_tier', '', tenantId);
	await repos.settings.setSetting('physical_deletion_date', '', tenantId);

	logger.info('[grace-period] Tenant restored from soft delete', {
		context: { tenantId },
	});

	return { success: true, tenantId };
}

// ============================================================
// Physical deletion check (cron)
// ============================================================

/**
 * グレースピリオド期限切れのテナントを検出する。
 *
 * cron ジョブから呼び出され、期限切れのテナントの物理削除を実行する。
 * 実際の物理削除は account-deletion-service を呼び出す。
 */
export async function findExpiredSoftDeletedTenants(): Promise<
	Array<{ tenantId: string; planTier: PlanTier; physicalDeletionDate: string }>
> {
	// NOTE: 本来は全テナントの settings をスキャンする必要があるが、
	// 効率的な実装は DynamoDB GSI / SQLite index 追加で対応する。
	// 暫定的に listAllTenants して settings を個別取得する。
	const repos = getRepos();
	const allTenants = await repos.auth.listAllTenants();
	const expired: Array<{
		tenantId: string;
		planTier: PlanTier;
		physicalDeletionDate: string;
	}> = [];

	for (const tenant of allTenants) {
		const status = await getGracePeriodStatus(tenant.tenantId);
		if (status.isSoftDeleted && status.isExpired && status.physicalDeletionDate) {
			expired.push({
				tenantId: tenant.tenantId,
				planTier: status.planTier ?? 'free',
				physicalDeletionDate: status.physicalDeletionDate,
			});
		}
	}

	return expired;
}

/**
 * テナントのグレースピリオド情報のサマリを返す（UI 表示用）。
 */
export function getGracePeriodDays(planTier: PlanTier): number {
	return DELETION_GRACE_PERIOD_DAYS[planTier];
}
