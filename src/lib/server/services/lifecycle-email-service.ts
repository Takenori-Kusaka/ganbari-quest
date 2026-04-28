// src/lib/server/services/lifecycle-email-service.ts
// #1601 (ADR-0023 §3.2 §3.3 §5 I11): ライフサイクルメール (期限切れ前リマインド + 休眠復帰)。
//
// 既存 trial-notification cron は枠外 (システム通知扱い、年 6 回上限に含めない)。
// 本サービスは「親宛のみ・年 6 回上限・List-Unsubscribe 必須」を構造的に保証する。
//
// 実行タイミング: lifecycle-emails cron (毎日 09:30 JST、cron-dispatcher 経由)。
// 詳細仕様: ADR-0023 §3.2 / §3.3 / §5 I11。

import { getLicensePlanLabel } from '$lib/domain/labels';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { sendDormantReactivationEmail, sendLicenseRenewalReminderEmail } from './email-service';
import { canSendMarketingEmail, incrementMarketingEmailCount } from './marketing-email-counter';

// ============================================================
// 定数
// ============================================================

const MS_PER_DAY = 86_400_000;

/**
 * 期限切れ前リマインドを送信する残日数 (ADR-0023 §5 I11)。
 * 30 日 / 7 日 / 1 日 の 3 タイミング。
 */
export const RENEWAL_REMINDER_DAYS = [30, 7, 1] as const;
export type RenewalReminderDay = (typeof RENEWAL_REMINDER_DAYS)[number];

/** 休眠とみなす最終ログイン経過日数 (ADR-0023 §5 I11)。 */
export const DORMANT_THRESHOLD_DAYS = 90;

/** 休眠復帰メール送信済みフラグの settings KV キー (1 ユーザーにつき 1 回限り)。 */
const DORMANT_SENT_KEY = 'dormant_reactivation_sent';

/** マーケティング配信を opt-out したテナントの settings KV キー。 */
const UNSUBSCRIBED_KEY = 'marketing_unsubscribed_at';

// ============================================================
// 型
// ============================================================

export interface LifecycleEmailRunOptions {
	/** 現在時刻 (テスト用に注入可能)。デフォルト: new Date() */
	now?: Date;
	/** dryRun: true ならメール送信せず判定だけ返す */
	dryRun?: boolean;
}

export interface LifecycleEmailRunResult {
	scanned: number;
	renewalSent: number;
	dormantSent: number;
	skippedUnsubscribed: number;
	skippedRateLimit: number;
	skippedNoOwner: number;
	skippedAlreadySent: number;
	errors: number;
	dryRun: boolean;
}

// ============================================================
// Helpers
// ============================================================

/**
 * 与えられた expiresAt と現在時刻から、残日数 (整数、切り上げ) を返す。
 * すでに過ぎている場合は負値。
 */
export function daysUntil(expiresAt: string, now: Date): number {
	const exp = new Date(expiresAt).getTime();
	const diffMs = exp - now.getTime();
	return Math.ceil(diffMs / MS_PER_DAY);
}

/**
 * 残日数が「期限切れ前リマインド」のターゲットに該当するかを判定する。
 * 30/7/1 日のいずれかと完全一致したときのみ true。
 */
export function isRenewalReminderDay(daysRemaining: number): daysRemaining is RenewalReminderDay {
	return RENEWAL_REMINDER_DAYS.includes(daysRemaining as RenewalReminderDay);
}

/** 最終アクティブ日からの経過日数を返す (createdAt フォールバック付き)。 */
export function daysSinceLastActive(
	lastActiveAt: string | undefined,
	createdAt: string,
	now: Date,
): number {
	const baseIso = lastActiveAt ?? createdAt;
	const base = new Date(baseIso).getTime();
	const diffMs = now.getTime() - base;
	return Math.floor(diffMs / MS_PER_DAY);
}

/** YYYY-MM-DD (JST) 形式の表示用日付。 */
function formatExpiresAt(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleDateString('ja-JP', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'Asia/Tokyo',
	});
}

// ============================================================
// テナント単位の処理
// ============================================================

interface TenantContext {
	tenantId: string;
	email: string;
	ownerName: string;
	plan: string | undefined;
	planExpiresAt: string | undefined;
	lastActiveAt: string | undefined;
	createdAt: string;
}

/**
 * 1 テナントを処理する。
 *
 * 戻り値の文字列は集計用のラベル。
 *   - 'renewal-sent' / 'dormant-sent': メール送信成功
 *   - 'skipped-*': 各種スキップ理由
 *   - 'error': 例外
 */
async function processTenant(
	ctx: TenantContext,
	now: Date,
	dryRun: boolean,
): Promise<
	| 'renewal-sent'
	| 'dormant-sent'
	| 'skipped-unsubscribed'
	| 'skipped-rate-limit'
	| 'skipped-already-sent'
	| 'skipped-no-target'
	| 'error'
> {
	const repos = getRepos();

	// 1) opt-out チェック (年 6 回枠とは独立した拒絶)
	const optOut = await repos.settings.getSetting(UNSUBSCRIBED_KEY, ctx.tenantId);
	if (optOut) return 'skipped-unsubscribed';

	// 2) 期限切れ前リマインド判定
	const daysRemaining = ctx.planExpiresAt ? daysUntil(ctx.planExpiresAt, now) : null;
	const renewalEligible =
		daysRemaining !== null && isRenewalReminderDay(daysRemaining) && !!ctx.plan; // 一般プランのみ (trial 等を除外)

	// 3) 休眠復帰判定
	const dormantDays = daysSinceLastActive(ctx.lastActiveAt, ctx.createdAt, now);
	const dormantEligibleByDays = dormantDays >= DORMANT_THRESHOLD_DAYS;
	let dormantAlreadySent = false;
	if (dormantEligibleByDays) {
		const sentAt = await repos.settings.getSetting(DORMANT_SENT_KEY, ctx.tenantId);
		dormantAlreadySent = !!sentAt;
	}
	const dormantEligible = dormantEligibleByDays && !dormantAlreadySent;

	if (!renewalEligible && !dormantEligible) {
		return dormantAlreadySent ? 'skipped-already-sent' : 'skipped-no-target';
	}

	// 4) 年 6 回上限チェック
	const canSend = await canSendMarketingEmail(ctx.tenantId);
	if (!canSend) return 'skipped-rate-limit';

	if (dryRun) {
		// dryRun: 状態は変更せず、どちらが送られる予定だったかをログに残す。
		const target = renewalEligible ? 'renewal' : 'dormant';
		logger.info('[lifecycle-email] dryRun would send', {
			context: { tenantId: ctx.tenantId, target, daysRemaining, dormantDays },
		});
		return renewalEligible ? 'renewal-sent' : 'dormant-sent';
	}

	// 5) 送信実行 (renewal を優先。両方該当しても 1 通だけ。年 6 回枠の節約)
	if (renewalEligible) {
		const ok = await sendLicenseRenewalReminderEmail({
			email: ctx.email,
			tenantId: ctx.tenantId,
			ownerName: ctx.ownerName,
			planLabel: getLicensePlanLabel(ctx.plan ?? ''),
			expiresAt: formatExpiresAt(ctx.planExpiresAt as string),
			daysRemaining: daysRemaining as number,
		});
		if (!ok) return 'error';
		await incrementMarketingEmailCount(ctx.tenantId);
		return 'renewal-sent';
	}

	// dormant
	const ok = await sendDormantReactivationEmail({
		email: ctx.email,
		tenantId: ctx.tenantId,
		ownerName: ctx.ownerName,
		daysSinceLastActive: dormantDays,
	});
	if (!ok) return 'error';
	await incrementMarketingEmailCount(ctx.tenantId);
	await repos.settings.setSetting(DORMANT_SENT_KEY, now.toISOString(), ctx.tenantId);
	return 'dormant-sent';
}

// ============================================================
// Public API
// ============================================================

/**
 * 全テナントを走査して期限切れ前リマインド + 休眠復帰メールを処理する。
 *
 * cron (lifecycle-emails) から日次で呼ばれる。1 テナントの失敗が他に波及しないよう
 * try/catch で個別にハンドルする。
 */
export async function runLifecycleEmails(
	options: LifecycleEmailRunOptions = {},
): Promise<LifecycleEmailRunResult> {
	const now = options.now ?? new Date();
	const dryRun = options.dryRun ?? false;

	const result: LifecycleEmailRunResult = {
		scanned: 0,
		renewalSent: 0,
		dormantSent: 0,
		skippedUnsubscribed: 0,
		skippedRateLimit: 0,
		skippedNoOwner: 0,
		skippedAlreadySent: 0,
		errors: 0,
		dryRun,
	};

	const repos = getRepos();
	const tenants = await repos.auth.listAllTenants();

	for (const tenant of tenants) {
		result.scanned++;
		try {
			// オーナーのメールアドレスを取得
			const members = await repos.auth.findTenantMembers(tenant.tenantId);
			const owner = members.find((m) => m.role === 'owner');
			if (!owner) {
				result.skippedNoOwner++;
				continue;
			}
			const user = await repos.auth.findUserById(owner.userId);
			if (!user?.email) {
				result.skippedNoOwner++;
				continue;
			}

			const outcome = await processTenant(
				{
					tenantId: tenant.tenantId,
					email: user.email,
					ownerName: user.displayName || tenant.name,
					plan: tenant.plan,
					planExpiresAt: tenant.planExpiresAt,
					lastActiveAt: tenant.lastActiveAt,
					createdAt: tenant.createdAt,
				},
				now,
				dryRun,
			);

			switch (outcome) {
				case 'renewal-sent':
					result.renewalSent++;
					break;
				case 'dormant-sent':
					result.dormantSent++;
					break;
				case 'skipped-unsubscribed':
					result.skippedUnsubscribed++;
					break;
				case 'skipped-rate-limit':
					result.skippedRateLimit++;
					break;
				case 'skipped-already-sent':
					result.skippedAlreadySent++;
					break;
				case 'error':
					result.errors++;
					break;
				default:
					break;
			}
		} catch (err) {
			logger.error('[lifecycle-email] tenant processing failed', {
				context: {
					tenantId: tenant.tenantId,
					error: err instanceof Error ? err.message : String(err),
				},
			});
			result.errors++;
		}
	}

	return result;
}

/**
 * 配信停止 (opt-out) を記録する。unsubscribe ルートから呼ばれる。
 * 冪等。既に解除済みでも 2 重書き込みするだけで害はない。
 */
export async function markTenantUnsubscribed(
	tenantId: string,
	now: Date = new Date(),
): Promise<void> {
	const repos = getRepos();
	await repos.settings.setSetting(UNSUBSCRIBED_KEY, now.toISOString(), tenantId);
	logger.info('[lifecycle-email] tenant unsubscribed', { context: { tenantId } });
}

/** opt-out 状態を確認する (UI / テスト用)。 */
export async function isTenantUnsubscribed(tenantId: string): Promise<boolean> {
	const repos = getRepos();
	const value = await repos.settings.getSetting(UNSUBSCRIBED_KEY, tenantId);
	return !!value;
}
