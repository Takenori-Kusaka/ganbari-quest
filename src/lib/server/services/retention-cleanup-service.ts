// src/lib/server/services/retention-cleanup-service.ts
// #717, #729: 保存期間超過データの自動削除サービス
//
// プランごとの保持期間（free: 90 日 / standard: 365 日 / family: 無制限）を元に、
// 各テナントの全ての子について `recorded_date < cutoffDate` の活動ログ・ポイント台帳・
// ステータス履歴を削除する。pricing 画面の約束を実データ削除で履行するためのバッチ。
// (#3330: login_bonuses は counter 縮約 = 履歴自体が生まれない構造になり retention 対象から消滅、
//  ADR-0049 改訂)
//
// - トライアル期間中はその時点のトライアルティアが適用される（`resolveFullPlanTier`）
// - `family` (無制限) の場合は何も削除しない
// - `dryRun=true` の場合は実削除せず件数だけを返す
// - 各テナントは独立して try/catch。1 テナントの失敗が他に波及しないようにする
//
// 呼び出し元:
// - `/api/cron/retention-cleanup/+server.ts` (EventBridge スケジュール経由)
// - 手動実行（CRON_SECRET Bearer 認証 / ADR-0033）

import {
	AUTH_LICENSE_STATUS,
	type AuthLicenseStatus,
} from '$lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { MS_PER_DAY } from '$lib/domain/constants/time';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import {
	getHistoryCutoffDate,
	type PlanTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';

export interface RetentionCleanupResult {
	tenantsProcessed: number;
	tenantsSkipped: number; // family tier または errors
	childrenProcessed: number;
	activityLogsDeleted: number;
	pointLedgerDeleted: number;
	statusHistoryDeleted: number; // #3518-2
	/**
	 * #3985: `stripe_webhook_events` の 30 日超過 row 削除数 (tenant 非依存のグローバル表)。
	 * Stripe Events API 自体が 30 日で replay 不能になるため、それ以上保持しても dedup 効果がない。
	 */
	webhookEventsDeleted: number;
	errors: Array<{ tenantId: string; error: string }>;
}

/**
 * Stripe webhook dedup 台帳の保持期間 (日)。
 * Stripe Events API の保持期間 (30 日) と同期する (ADR-0049 / phase5 §5.3)。
 */
const WEBHOOK_EVENT_RETENTION_DAYS = 30;

export interface RetentionCleanupOptions {
	/** true の場合、削除を実行せず件数カウントのみ返す */
	dryRun?: boolean;
}

/**
 * 指定 tenant の licenseStatus を Tenant エンティティから導出する。
 *
 * `cognito.ts` の認証ハンドラと同じロジックを踏襲:
 * - stripeSubscriptionId あり + status = active/grace_period → 'active'
 * - stripeSubscriptionId あり + その他 status → 'suspended'
 * - stripeSubscriptionId なし → 'none' (トライアル/無料)
 */
function deriveLicenseStatus(tenant: {
	stripeSubscriptionId?: string;
	status: string;
}): AuthLicenseStatus {
	if (!tenant.stripeSubscriptionId) return AUTH_LICENSE_STATUS.NONE;
	if (
		tenant.status === SUBSCRIPTION_STATUS.ACTIVE ||
		tenant.status === SUBSCRIPTION_STATUS.GRACE_PERIOD
	) {
		return AUTH_LICENSE_STATUS.ACTIVE;
	}
	return AUTH_LICENSE_STATUS.SUSPENDED;
}

/**
 * 全テナントを走査し、プラン保持期間を超過したデータを削除する。
 *
 * @param options.dryRun - true なら削除実行せず件数のみ返す
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
export async function cleanupExpiredData(
	options: RetentionCleanupOptions = {},
): Promise<RetentionCleanupResult> {
	const dryRun = options.dryRun ?? false;
	const repos = getRepos();
	const result: RetentionCleanupResult = {
		tenantsProcessed: 0,
		tenantsSkipped: 0,
		childrenProcessed: 0,
		activityLogsDeleted: 0,
		pointLedgerDeleted: 0,
		statusHistoryDeleted: 0, // #3518-2
		webhookEventsDeleted: 0, // #3985
		errors: [],
	};

	logger.info('[retention-cleanup] started', {
		service: 'retention-cleanup',
		context: { dryRun },
	});

	let tenants: Awaited<ReturnType<typeof repos.auth.listAllTenants>> = [];
	try {
		tenants = await repos.auth.listAllTenants();
	} catch (e) {
		logger.error('[retention-cleanup] failed to list tenants', {
			service: 'retention-cleanup',
			error: e instanceof Error ? e.message : String(e),
			stack: e instanceof Error ? e.stack : undefined,
		});
		throw e;
	}

	for (const tenant of tenants) {
		try {
			const licenseStatus = deriveLicenseStatus(tenant);
			const tier: PlanTier = await resolveFullPlanTier(tenant.tenantId, licenseStatus, tenant.plan);

			const cutoffDate = getHistoryCutoffDate(tier);
			if (cutoffDate === null) {
				// family / local (無制限): 削除しない
				result.tenantsSkipped++;
				continue;
			}

			const children = await repos.child.findAllChildren(tenant.tenantId);

			let tenantActivityLogsDeleted = 0;
			let tenantPointLedgerDeleted = 0;
			let tenantStatusHistoryDeleted = 0; // #3518-2

			for (const child of children) {
				if (dryRun) {
					// dryRun: 削除せず件数だけ得るため、削除関数は呼ばない。
					// 件数推定が必要なら今後カウントクエリを追加する。
					result.childrenProcessed++;
					continue;
				}

				const activityLogs = await repos.activity.deleteActivityLogsBeforeDate(
					child.id,
					cutoffDate,
					tenant.tenantId,
				);
				const pointLedger = await repos.point.deletePointLedgerBeforeDate(
					child.id,
					cutoffDate,
					tenant.tenantId,
				);
				// #3518-2: daily decay が child×category×日で機械生成する status_history を retention 対象化。
				// backup 生成メモリ / DSQL read コストの主因になる最大母数を保持期間超過分だけ物理削除する。
				const statusHistory = await repos.status.deleteStatusHistoryBeforeDate(
					child.id,
					cutoffDate,
					tenant.tenantId,
				);

				tenantActivityLogsDeleted += activityLogs;
				tenantPointLedgerDeleted += pointLedger;
				tenantStatusHistoryDeleted += statusHistory;
				result.childrenProcessed++;
			}

			result.activityLogsDeleted += tenantActivityLogsDeleted;
			result.pointLedgerDeleted += tenantPointLedgerDeleted;
			result.statusHistoryDeleted += tenantStatusHistoryDeleted;
			result.tenantsProcessed++;

			logger.info('[retention-cleanup] tenant processed', {
				service: 'retention-cleanup',
				tenantId: tenant.tenantId,
				context: {
					tier,
					cutoffDate,
					childCount: children.length,
					activityLogsDeleted: tenantActivityLogsDeleted,
					pointLedgerDeleted: tenantPointLedgerDeleted,
					statusHistoryDeleted: tenantStatusHistoryDeleted,
					dryRun,
				},
			});
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			result.errors.push({ tenantId: tenant.tenantId, error: errMsg });
			result.tenantsSkipped++;
			logger.error('[retention-cleanup] tenant failed', {
				service: 'retention-cleanup',
				tenantId: tenant.tenantId,
				error: errMsg,
				stack: e instanceof Error ? e.stack : undefined,
			});
		}
	}

	// #3985: Stripe webhook dedup 台帳の 30 日 retention。tenant ループの外で 1 回だけ実行する
	// (`stripe_webhook_events` は tenant 非依存のグローバル表)。
	// 1 テナントの失敗が他に波及しないのと同じ理由で、ここの失敗も cleanup 全体を落とさない。
	if (!dryRun) {
		try {
			const cutoffIso = new Date(
				Date.now() - WEBHOOK_EVENT_RETENTION_DAYS * MS_PER_DAY,
			).toISOString();
			result.webhookEventsDeleted = await repos.webhookEvent.deleteOlderThan(cutoffIso);
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			result.errors.push({ tenantId: '(global)', error: errMsg });
			logger.error('[retention-cleanup] webhook events purge failed', {
				service: 'retention-cleanup',
				error: errMsg,
				stack: e instanceof Error ? e.stack : undefined,
			});
		}
	}

	logger.info('[retention-cleanup] completed', {
		service: 'retention-cleanup',
		context: { ...result, dryRun },
	});

	return result;
}
