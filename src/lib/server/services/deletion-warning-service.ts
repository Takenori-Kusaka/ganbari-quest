// src/lib/server/services/deletion-warning-service.ts
// #2399: アカウント削除予告メールの送信判定。
//
// アカウント削除は「予約 (softDeleteTenant) → 猶予 → 物理削除 (grace-period-deletion cron)」の
// 3 段構成だが、顧客に届くイベントは両端 (予約直後の解約受付 / 削除完了) にしかなく、猶予期間中は
// 無音だった。猶予は standard 7 日 / family 30 日あり、その間「復元できる」ことを思い出す契機が
// システム側から一切与えられない。本サービスはその欠けた 1 通を日次 cron で送る。
//
// 設計 SSOT: docs/runbooks/account-deletion-email-automation.md
//
// 「削除 14 日前」は全プランでは成立しない (DELETION_GRACE_PERIOD_DAYS = free 0 / standard 7 /
// family 30)。free は猶予が無いため予告する時間が原理的に存在せず、standard は猶予 7 日に
// 14 日前が収まらない。しきい値はプランごとに持ち、猶予日数より必ず小さいことを test で固定する。

import { formatJSTDate, toJSTDateString } from '$lib/domain/date-utils';
import { createTimeBudget, type TimeBudget } from '$lib/server/cron/time-budget';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { sendDeletionWarningEmail } from './email-service';
import {
	DELETION_GRACE_PERIOD_DAYS,
	DELETION_WARNING_SENT_KEY,
	getGracePeriodStatus,
} from './grace-period-service';
import type { PlanTier } from './plan-limit-service';

// ============================================================
// Constants
// ============================================================

const MS_PER_DAY = 86_400_000;

/**
 * プラン別の予告送信しきい値 (物理削除予定日までの残り日数、JST 暦日換算)。
 *
 * `null` = 予告を送らない。free は猶予 0 日 (即時物理削除) のため、予告を送るタイミングが
 * 原理的に存在しない。free の削除確認は予約時の入力確認 UX (account-deletion-flow.md §5.1) が担う。
 *
 * 値は {@link DELETION_GRACE_PERIOD_DAYS} より必ず小さくなければならない
 * (`tests/unit/services/deletion-warning-service.test.ts` [W2] が機械強制)。
 */
export const DELETION_WARNING_DAYS_BEFORE: Record<PlanTier, number | null> = {
	free: null,
	standard: 1,
	family: 14,
} as const;

/**
 * 送信済フラグの settings KV キー (1 予約につき 1 通)。予約時にリセットされ復元時にクリアされる。
 * 定義元は grace-period-service (soft delete 状態の KV 群と同じライフサイクルのため)。
 */
export { DELETION_WARNING_SENT_KEY };

/** 1 回の実行で処理するテナント数の上限 (#3695 30 秒 self-limiting)。 */
export const DEFAULT_DELETION_WARNING_LIMIT = 50;

// ============================================================
// Types
// ============================================================

export interface DeletionWarningRunOptions {
	/** 現在時刻 (テスト用に注入可能)。既定: new Date() */
	now?: Date;
	/** true ならメール送信・状態更新をせず判定だけ返す */
	dryRun?: boolean;
	/** 1 回の実行で処理する最大テナント数 */
	limit?: number;
	/** 時間予算 (#3695)。省略時は既定予算を生成 */
	budget?: TimeBudget;
}

export interface DeletionWarningRunResult {
	scanned: number;
	sent: number;
	skippedNotSoftDeleted: number;
	/** free など、しきい値を持たないプラン */
	skippedNoThreshold: number;
	/** しきい値未到達 / 期限切れ */
	skippedNotDue: number;
	skippedAlreadySent: number;
	skippedNoOwner: number;
	errors: number;
	/** limit / 時間予算により今回処理せず次回実行へ持ち越した件数 */
	tenantsRemaining: number;
	dryRun: boolean;
}

// ============================================================
// Helpers
// ============================================================

/**
 * JST 暦日ベースの残日数を返す (負値 = 予定日を過ぎている)。
 *
 * 時刻差ではなく暦日差で数えるのは、予約した時刻 (深夜 / 昼) によって「あと N 日」の
 * 表示と送信判定がズレないようにするため。暦日文字列を UTC 深夜として解釈し UTC 算術で
 * 引くため、プロセス TZ に依存しない (#4015 / #4127 JST SSOT 整合)。
 */
export function daysUntilJST(targetIso: string, now: Date): number {
	const target = new Date(`${toJSTDateString(new Date(targetIso))}T00:00:00Z`).getTime();
	const today = new Date(`${toJSTDateString(now)}T00:00:00Z`).getTime();
	return Math.round((target - today) / MS_PER_DAY);
}

/**
 * 送信対象かどうかを判定する (純粋関数)。
 *
 * しきい値「以下」で送るのは、cron が 1 日欠測したときに予告が無いまま削除される
 * (= 本 Issue が塞ごうとしている無音の失敗そのもの) のを避けるため。二重送信は
 * `deletion_warning_sent_at` の idempotency で防ぐ。
 */
export function shouldWarn(planTier: PlanTier, daysRemaining: number): boolean {
	const threshold = DELETION_WARNING_DAYS_BEFORE[planTier];
	if (threshold === null) return false;
	// 残り 0 日以下は削除当日 / 期限切れ。この時点の予告は行動の余地が無く騒音にしかならない
	if (daysRemaining < 1) return false;
	return daysRemaining <= threshold;
}

// ============================================================
// テナント単位の処理
// ============================================================

/** 1 テナントの処理結果ラベル (集計用)。lifecycle-email-service と同型。 */
type TenantOutcome =
	| 'sent'
	| 'skipped-not-soft-deleted'
	| 'skipped-no-threshold'
	| 'skipped-not-due'
	| 'skipped-already-sent'
	| 'skipped-no-owner'
	| 'error';

interface TenantInput {
	tenantId: string;
	tenantName: string;
}

/**
 * 1 テナントを処理する。送信成功時のみ `deletion_warning_sent_at` を書く。
 */
async function processTenant(
	tenant: TenantInput,
	now: Date,
	dryRun: boolean,
): Promise<TenantOutcome> {
	const repos = getRepos();

	const status = await getGracePeriodStatus(tenant.tenantId);
	if (!status.isSoftDeleted || !status.physicalDeletionDate) return 'skipped-not-soft-deleted';

	const planTier = status.planTier ?? 'free';
	if (DELETION_WARNING_DAYS_BEFORE[planTier] === null) return 'skipped-no-threshold';

	const daysRemaining = daysUntilJST(status.physicalDeletionDate, now);
	if (!shouldWarn(planTier, daysRemaining)) return 'skipped-not-due';

	const alreadySent = await repos.settings.getSetting(DELETION_WARNING_SENT_KEY, tenant.tenantId);
	if (alreadySent) return 'skipped-already-sent';

	const members = await repos.auth.findTenantMembers(tenant.tenantId);
	const owner = members.find((m) => m.role === 'owner');
	const user = owner ? await repos.auth.findUserById(owner.userId) : null;
	if (!user?.email) {
		logger.warn('[deletion-warning] owner email not found', {
			context: { tenantId: tenant.tenantId, daysRemaining },
		});
		return 'skipped-no-owner';
	}

	if (dryRun) {
		logger.info('[deletion-warning] dryRun would send', {
			context: { tenantId: tenant.tenantId, planTier, daysRemaining },
		});
		return 'sent';
	}

	const ok = await sendDeletionWarningEmail({
		email: user.email,
		ownerName: user.displayName || tenant.tenantName,
		deletionDate: formatJSTDate(toJSTDateString(new Date(status.physicalDeletionDate))),
		daysRemaining,
	});
	if (!ok) {
		// sent_at を書かずに終える。次回実行で再試行される
		logger.error('[deletion-warning] send failed', {
			context: { tenantId: tenant.tenantId, daysRemaining },
		});
		return 'error';
	}

	await repos.settings.setSetting(DELETION_WARNING_SENT_KEY, now.toISOString(), tenant.tenantId);
	logger.info('[deletion-warning] sent', {
		context: { tenantId: tenant.tenantId, planTier, daysRemaining },
	});
	return 'sent';
}

/** outcome を集計へ反映する。 */
function tally(result: DeletionWarningRunResult, outcome: TenantOutcome): void {
	switch (outcome) {
		case 'sent':
			result.sent++;
			break;
		case 'skipped-not-soft-deleted':
			result.skippedNotSoftDeleted++;
			break;
		case 'skipped-no-threshold':
			result.skippedNoThreshold++;
			break;
		case 'skipped-not-due':
			result.skippedNotDue++;
			break;
		case 'skipped-already-sent':
			result.skippedAlreadySent++;
			break;
		case 'skipped-no-owner':
			result.skippedNoOwner++;
			break;
		default:
			result.errors++;
			break;
	}
}

// ============================================================
// Public API
// ============================================================

/**
 * soft delete 済テナントを走査し、削除予定日が近いオーナーへ予告メールを送る。
 *
 * cron (deletion-warning-emails) から日次で呼ばれる。1 テナントの失敗が他に波及しないよう
 * try/catch で個別にハンドルする。
 */
export async function runDeletionWarningEmails(
	options: DeletionWarningRunOptions = {},
): Promise<DeletionWarningRunResult> {
	const now = options.now ?? new Date();
	const dryRun = options.dryRun ?? false;
	const limit = options.limit ?? DEFAULT_DELETION_WARNING_LIMIT;
	const budget = options.budget ?? createTimeBudget();

	const result: DeletionWarningRunResult = {
		scanned: 0,
		sent: 0,
		skippedNotSoftDeleted: 0,
		skippedNoThreshold: 0,
		skippedNotDue: 0,
		skippedAlreadySent: 0,
		skippedNoOwner: 0,
		errors: 0,
		tenantsRemaining: 0,
		dryRun,
	};

	const repos = getRepos();
	// N+1: Pre-PMF (<100 tenants) では許容。件数上限 + 時間予算で 30 秒制約に収める (#3695)
	const tenants = await repos.auth.listAllTenants();

	let attempted = 0;
	for (const tenant of tenants) {
		if (attempted >= limit || budget.exceeded()) break;
		attempted++;
		result.scanned++;

		try {
			tally(
				result,
				await processTenant({ tenantId: tenant.tenantId, tenantName: tenant.name }, now, dryRun),
			);
		} catch (err) {
			result.errors++;
			logger.error('[deletion-warning] tenant processing failed', {
				context: {
					tenantId: tenant.tenantId,
					error: err instanceof Error ? err.message : String(err),
				},
			});
		}
	}

	result.tenantsRemaining = tenants.length - attempted;
	if (result.tenantsRemaining > 0) {
		// silent 持ち越し禁止 (#3695 / ADR-0006 整合)
		logger.warn('[deletion-warning] carried over remaining tenants to next run', {
			context: {
				remaining: result.tenantsRemaining,
				attempted,
				limit,
				elapsedMs: budget.elapsedMs(),
			},
		});
	}

	return result;
}
