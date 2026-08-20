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
import type { Role } from '$lib/server/auth/types';
import { createTimeBudget, type TimeBudget } from '$lib/server/cron/time-budget';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { sendDeletionWarningEmail } from './email-service';
import {
	DELETION_GRACE_PERIOD_DAYS,
	DELETION_WARNING_SENT_KEY,
	GRACE_PERIOD_DELETION_DISABLED_ENV,
	getGracePeriodStatus,
	isPhysicalDeletionDisabled,
} from './grace-period-service';
import type { PlanTier } from './plan-limit-service';

// ============================================================
// Constants
// ============================================================

const MS_PER_DAY = 86_400_000;

/**
 * 予告メールの宛先とする「保護者」ロール (#4325 の follow-up、オーナー決裁 2026-08-06)。
 *
 * 従来は `owner` 1 名固定だったため、owner が不在 / アドレス失効の世帯では猶予期間の
 * 目的 (気づいて復帰する機会) が単一障害点で失われ、取り消せない物理削除の期日を
 * 誰にも気づかれず迎える経路が存在した。`child` ロールはメールアドレスを持たない設計
 * (`src/lib/server/auth/types.ts` の `ROLES`) のため対象に含めない。
 */
const GUARDIAN_ROLES: readonly Role[] = ['owner', 'parent'];

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
	/** 保護者ロール (owner/parent) 全員にメールアドレスが引けなかったテナント数 (#4325 follow-up、旧 skippedNoOwner) */
	skippedNoRecipients: number;
	/**
	 * 送信自体は 'sent' 扱い (1 通以上成功) だが、一部の保護者への送信が失敗したテナント数 (#4359 follow-up)。
	 * 例: 共同運用世帯で片方のアドレスが恒久的に無効な場合、届いた側がいるため 'sent' にはなるが
	 * 届かなかった側は次回以降も再試行されない (idempotency key が立つため)。この場合を観測可能にする。
	 */
	tenantsWithPartialFailure: number;
	/** 個別の宛先送信失敗の総数 (テナント横断の合計。メールアドレス自体は記録しない) (#4359 follow-up) */
	failedRecipients: number;
	errors: number;
	/**
	 * 物理削除が停止中のため 1 通も送らずに終えたか (#4721)。
	 *
	 * 削除が走らない配備で「削除予定日: X（あと N 日）」を告げるのは顧客への嘘になるため、
	 * 予告メールは削除と同じ feature flag で止める。**止まったことを観測可能にする**
	 * (silent skip にすると「なぜ届かないのか」が誰にも分からない)。
	 */
	skippedPhysicalDeletionDisabled: boolean;
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
	| 'skipped-no-recipients'
	| 'error';

interface TenantInput {
	tenantId: string;
	tenantName: string;
}

interface GuardianRecipient {
	email: string;
	displayName: string | null;
}

/**
 * 保護者ロール (owner/parent) の宛先を解決する。
 *
 * - `child` ロールはメールアドレスを持たない設計のため対象外
 * - 同一メールアドレスが複数ロールに登録されていても 1 通にまとめる (重複送信防止)
 */
async function resolveGuardianRecipients(tenantId: string): Promise<GuardianRecipient[]> {
	const repos = getRepos();
	const members = await repos.auth.findTenantMembers(tenantId);
	const guardians = members.filter((m) => GUARDIAN_ROLES.includes(m.role));

	const seenEmails = new Set<string>();
	const recipients: GuardianRecipient[] = [];
	for (const guardian of guardians) {
		const user = await repos.auth.findUserById(guardian.userId);
		if (!user?.email || seenEmails.has(user.email)) continue;
		seenEmails.add(user.email);
		recipients.push({ email: user.email, displayName: user.displayName || null });
	}
	return recipients;
}

/** {@link processTenant} の戻り値。集計 (tally) は outcome に加え宛先単位の成否件数も反映する。 */
interface TenantProcessResult {
	outcome: TenantOutcome;
	/** 送信対象だった宛先数 (outcome === 'sent' | 'error' のときのみ意味を持つ) */
	recipientCount?: number;
	/** 送信に失敗した宛先数 (メールアドレス自体は含まない、件数のみ) */
	failedRecipientCount?: number;
}

/**
 * 1 テナントを処理する。1 通以上の送信に成功したときのみ `deletion_warning_sent_at` を書く。
 */
async function processTenant(
	tenant: TenantInput,
	now: Date,
	dryRun: boolean,
): Promise<TenantProcessResult> {
	const repos = getRepos();

	const status = await getGracePeriodStatus(tenant.tenantId);
	if (!status.isSoftDeleted || !status.physicalDeletionDate)
		return { outcome: 'skipped-not-soft-deleted' };

	const planTier = status.planTier ?? 'free';
	if (DELETION_WARNING_DAYS_BEFORE[planTier] === null) return { outcome: 'skipped-no-threshold' };

	const daysRemaining = daysUntilJST(status.physicalDeletionDate, now);
	if (!shouldWarn(planTier, daysRemaining)) return { outcome: 'skipped-not-due' };

	const alreadySent = await repos.settings.getSetting(DELETION_WARNING_SENT_KEY, tenant.tenantId);
	if (alreadySent) return { outcome: 'skipped-already-sent' };

	const recipients = await resolveGuardianRecipients(tenant.tenantId);
	if (recipients.length === 0) {
		// 0 件でも削除は進む (猶予期限は止めない)。ログで観測できるようにする
		logger.warn('[deletion-warning] no guardian email found; deletion proceeds unwarned', {
			context: { tenantId: tenant.tenantId, daysRemaining },
		});
		return { outcome: 'skipped-no-recipients' };
	}

	if (dryRun) {
		logger.info('[deletion-warning] dryRun would send', {
			context: {
				tenantId: tenant.tenantId,
				planTier,
				daysRemaining,
				recipientCount: recipients.length,
			},
		});
		return { outcome: 'sent', recipientCount: recipients.length, failedRecipientCount: 0 };
	}

	const deletionDate = formatJSTDate(toJSTDateString(new Date(status.physicalDeletionDate)));
	let successCount = 0;
	for (const recipient of recipients) {
		// 宛先ごとに本人の displayName を使う (他の保護者の名前を差し込まない)
		const ok = await sendDeletionWarningEmail({
			email: recipient.email,
			ownerName: recipient.displayName || tenant.tenantName,
			deletionDate,
			daysRemaining,
		});
		if (ok) {
			successCount++;
		} else {
			logger.error('[deletion-warning] send failed', {
				context: { tenantId: tenant.tenantId, daysRemaining },
			});
		}
	}

	const failedRecipientCount = recipients.length - successCount;

	if (successCount === 0) {
		// 全宛先で失敗。sent_at を書かずに終える。次回実行で再試行される
		return { outcome: 'error', recipientCount: recipients.length, failedRecipientCount };
	}

	// 1 通でも届けば idempotency key を立てる (一部宛先が恒久的に失敗し続けて
	// 無限リトライになるのを避ける。成功した宛先には翌日以降二重に届かない)
	await repos.settings.setSetting(DELETION_WARNING_SENT_KEY, now.toISOString(), tenant.tenantId);
	logger.info('[deletion-warning] sent', {
		context: {
			tenantId: tenant.tenantId,
			planTier,
			daysRemaining,
			recipientCount: recipients.length,
			successCount,
		},
	});

	if (failedRecipientCount > 0) {
		// 一部の宛先にだけ届かなかった場合 (共同運用世帯で片方のアドレスが恒久的に無効等)。
		// idempotency key が立つため次回以降も再試行されない。メールアドレスは記録せず件数のみ残す
		logger.warn('[deletion-warning] partial send failure; some recipients never warned', {
			context: {
				tenantId: tenant.tenantId,
				recipientCount: recipients.length,
				failedRecipientCount,
			},
		});
	}

	return { outcome: 'sent', recipientCount: recipients.length, failedRecipientCount };
}

/** 処理結果 (outcome + 宛先単位の成否件数) を集計へ反映する。 */
function tally(result: DeletionWarningRunResult, processed: TenantProcessResult): void {
	switch (processed.outcome) {
		case 'sent':
			result.sent++;
			if ((processed.failedRecipientCount ?? 0) > 0) {
				result.tenantsWithPartialFailure++;
			}
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
		case 'skipped-no-recipients':
			result.skippedNoRecipients++;
			break;
		default:
			result.errors++;
			break;
	}
	result.failedRecipients += processed.failedRecipientCount ?? 0;
}

// ============================================================
// Public API
// ============================================================

/**
 * soft delete 済テナントを走査し、削除予定日が近い保護者 (owner/parent 全員) へ予告メールを送る。
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
		skippedNoRecipients: 0,
		tenantsWithPartialFailure: 0,
		failedRecipients: 0,
		errors: 0,
		skippedPhysicalDeletionDisabled: false,
		tenantsRemaining: 0,
		dryRun,
	};

	// #4721: **削除が走らない配備では予告も出さない。**
	//
	// AWS 本番は grace-period-deletion の EventBridge Rule を作っていない (#4304 / #4327) ため
	// 物理削除は起きないが、deletion-warning-emails の Rule だけは毎日動いていた。結果として
	// 猶予中の顧客に「データの削除予定日: X（あと N 日）」が届き、その日が来ても削除されない
	// = 通知内容と実態、および privacy 第 6 条「猶予期間後に完全削除」との乖離が生じていた。
	//
	// 削除の有効状態は CDK が `GRACE_PERIOD_DELETION_DISABLED` に反映する
	// (Rule を作らない構成なら 'true')。予告メールが同じ flag を見ることで、Rule を復活させれば
	// 予告も自動的に再開し、止めれば両方止まる — 2 つの設定を人が同期させる必要がなくなる。
	if (isPhysicalDeletionDisabled()) {
		result.skippedPhysicalDeletionDisabled = true;
		logger.info(
			'[deletion-warning] 物理削除が停止中のため予告メールを送らない (削除されない日付を告げない)',
			{ context: { env: GRACE_PERIOD_DELETION_DISABLED_ENV } },
		);
		return result;
	}

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
