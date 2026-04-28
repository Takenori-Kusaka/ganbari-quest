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

	// Soft delete state is stored in settings table (not Tenant entity)
	// to avoid schema migration on DynamoDB.
	const repos = getRepos();
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
	// Empty string = unset (deleteSetting が存在しないため)
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
	// N+1: Pre-PMF (<100 tenants) では許容。スケール時は GSI or バッチ取得に移行 (ADR-0034)
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

// ============================================================
// Physical deletion (cron)
// ============================================================

/**
 * #1648 R43: グレースピリオド期限切れテナントを物理削除する cron 処理。
 *
 * 呼び出し元: /api/cron/grace-period-deletion (#1376 EventBridge スケジュール経由)
 *
 * 処理フロー:
 *   1. findExpiredSoftDeletedTenants() で期限切れテナント一覧を取得
 *   2. 各テナントの owner を特定
 *   3. account-deletion-service.deleteOwnerOnlyAccount を呼び出して物理削除
 *      （他メンバーがいる場合は deleteOwnerFullDelete に切替）
 *
 * 注: Stripe サブスクリプションは soft-delete に至る経路（admin/account/delete）で
 * すでにキャンセル済みの想定。account-deletion-service.fullTenantDeletion は
 * 念のため再度 cancelSubscription を呼ぶが、idempotent な実装のため二重呼び出しは安全。
 *
 * dryRun=true の場合は対象一覧のみ返し、削除は実行しない。
 *
 * 個人情報保護法 22 条「不要となった個人データの遅滞なく消去する努力義務」遵守 +
 * DB 肥大化リスク解消が目的（ADR-0010 過剰防衛禁止に該当しない最小実装）。
 */
export async function purgeExpiredSoftDeletedTenants(opts?: {
	dryRun?: boolean;
}): Promise<{
	tenantsProcessed: number;
	tenantsDeleted: number;
	tenantsFailed: number;
	dryRun: boolean;
	expired: Array<{ tenantId: string; planTier: PlanTier; physicalDeletionDate: string }>;
	errors: Array<{ tenantId: string; error: string }>;
}> {
	const dryRun = opts?.dryRun ?? false;
	const expired = await findExpiredSoftDeletedTenants();

	if (dryRun || expired.length === 0) {
		logger.info('[grace-period] purge dry-run or no expired tenants', {
			context: { dryRun, count: expired.length },
		});
		return {
			tenantsProcessed: expired.length,
			tenantsDeleted: 0,
			tenantsFailed: 0,
			dryRun,
			expired,
			errors: [],
		};
	}

	// dynamic import を使用してサイクル依存を避ける（grace-period → account-deletion → 互いに参照しない）
	const { deleteOwnerOnlyAccount, deleteOwnerFullDelete } = await import(
		'./account-deletion-service'
	);
	const repos = getRepos();
	const errors: Array<{ tenantId: string; error: string }> = [];
	let deleted = 0;

	for (const item of expired) {
		try {
			const members = await repos.auth.findTenantMembers(item.tenantId);
			const owner = members.find((m) => m.role === 'owner');
			if (!owner) {
				logger.warn('[grace-period] no owner found for tenant', {
					context: { tenantId: item.tenantId },
				});
				errors.push({ tenantId: item.tenantId, error: 'no owner found' });
				continue;
			}
			const otherMembers = members.filter((m) => m.userId !== owner.userId);
			if (otherMembers.length === 0) {
				await deleteOwnerOnlyAccount(item.tenantId, owner.userId);
			} else {
				await deleteOwnerFullDelete(item.tenantId, owner.userId);
			}
			deleted++;
			logger.info('[grace-period] tenant physically deleted', {
				context: {
					tenantId: item.tenantId,
					planTier: item.planTier,
					physicalDeletionDate: item.physicalDeletionDate,
				},
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push({ tenantId: item.tenantId, error: msg });
			logger.error('[grace-period] tenant deletion failed', {
				context: { tenantId: item.tenantId, error: msg },
			});
		}
	}

	return {
		tenantsProcessed: expired.length,
		tenantsDeleted: deleted,
		tenantsFailed: errors.length,
		dryRun: false,
		expired,
		errors,
	};
}
