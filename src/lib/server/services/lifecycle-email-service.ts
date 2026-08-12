// src/lib/server/services/lifecycle-email-service.ts
// #1601 (ADR-0023 §3.2 §3.3 §5 I11): ライフサイクルメール (期限切れ前リマインド + 休眠復帰)。
//
// 既存 trial-notification cron は枠外 (システム通知扱い、年 6 回上限に含めない)。
// 本サービスは「親宛のみ・年 6 回上限・List-Unsubscribe 必須」を構造的に保証する。
//
// 実行タイミング: lifecycle-emails cron (毎日 09:30 JST、cron-dispatcher 経由)。
// 詳細仕様: ADR-0023 §3.2 / §3.3 / §5 I11。

import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { getSubscriptionPlanLabel } from '$lib/domain/labels';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import {
	sendDormantReactivationEmail,
	sendLicenseRenewalReminderEmail,
	sendPaymentFailedNoticeEmail,
} from './email-service';
import { canSendMarketingEmail, incrementMarketingEmailCount } from './marketing-email-counter';
import {
	DORMANT_REACTIVATION_SENT_KEY,
	MARKETING_UNSUBSCRIBED_KEY,
} from './marketing-suppression-keys';

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

// #4338: 配信抑止キーの定義は marketing-suppression-keys.ts が SSOT。
// 退会処理 (tenant-cleanup-service) が「消してはならないキー」として同じ 1 本を見るため、
// ここで文字列を持たない (キー名を変えたときに削除側だけ古いままになる経路を作らない)。
const DORMANT_SENT_KEY = DORMANT_REACTIVATION_SENT_KEY;
const UNSUBSCRIBED_KEY = MARKETING_UNSUBSCRIBED_KEY;

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
	/** #4507: 支払い失敗 (dunning) 通知の送信数。トランザクション便のため年 6 回上限を消費しない。 */
	paymentFailedSent: number;
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
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
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
	/**
	 * #4507: 契約状態。`grace_period` = 支払い失敗 (dunning) 中。
	 * 同じ「残り 30/7/1 日」の判定から、marketing 便の期限前リマインドではなく
	 * トランザクション便の支払い失敗通知へ分岐するために読む。
	 */
	status: string;
	planExpiresAt: string | undefined;
	lastActiveAt: string | undefined;
	createdAt: string;
}

/**
 * 支払い失敗 (dunning) 中で、かつ通知日に当たるか (#4507)。
 *
 * `grace_period` は支払い失敗でしか書かれない (stripe-service の書き手一意化 #3986)。
 * この状態の `planExpiresAt` は「猶予の終わり」であり、更新予定日ではない。
 */
function isDunningNotice(ctx: TenantContext, isReminderDay: boolean): boolean {
	return ctx.status === SUBSCRIPTION_STATUS.GRACE_PERIOD && isReminderDay && !!ctx.plan;
}

/**
 * 支払い失敗のお知らせを送る (#4507)。
 *
 * 旧実装はこれを期限前リマインド (marketing 便) として送っていたため、配信停止済み /
 * 年 6 回上限に達した顧客は支払い失敗を**一度も知らされずに**猶予明けで suspended に
 * なった。契約継続の可否に直結する連絡なので、削除予告メールと同じくトランザクション便
 * として **opt-out / 年 6 回上限のどちらも経由せず** 送る。
 */
async function sendDunningNotice(
	ctx: TenantContext,
	daysRemaining: number,
	dryRun: boolean,
): Promise<'payment-failed-sent' | 'error'> {
	if (dryRun) {
		logger.info('[lifecycle-email] dryRun would send', {
			context: { tenantId: ctx.tenantId, target: 'payment-failed', daysRemaining },
		});
		return 'payment-failed-sent';
	}
	const ok = await sendPaymentFailedNoticeEmail({
		email: ctx.email,
		ownerName: ctx.ownerName,
		planLabel: getSubscriptionPlanLabel(ctx.plan ?? ''),
		graceDeadline: formatExpiresAt(ctx.planExpiresAt as string),
		daysRemaining,
	});
	return ok ? 'payment-failed-sent' : 'error';
}

/**
 * 休眠復帰メールの対象判定。
 *
 * 送信済フラグの読み取りは日数条件を満たしたときだけ行う (全テナント分の
 * settings 読みを増やさない、ADR-0065 DSQL DPU 規約)。
 */
async function resolveDormantState(
	ctx: TenantContext,
	now: Date,
): Promise<{ days: number; eligible: boolean; alreadySent: boolean }> {
	const days = daysSinceLastActive(ctx.lastActiveAt, ctx.createdAt, now);
	if (days < DORMANT_THRESHOLD_DAYS) return { days, eligible: false, alreadySent: false };

	const sentAt = await getRepos().settings.getSetting(DORMANT_SENT_KEY, ctx.tenantId);
	const alreadySent = !!sentAt;
	return { days, eligible: !alreadySent, alreadySent };
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
	| 'payment-failed-sent'
	| 'dormant-sent'
	| 'skipped-unsubscribed'
	| 'skipped-rate-limit'
	| 'skipped-already-sent'
	| 'skipped-no-target'
	| 'error'
> {
	const repos = getRepos();

	const daysRemaining = ctx.planExpiresAt ? daysUntil(ctx.planExpiresAt, now) : null;
	const isReminderDay = daysRemaining !== null && isRenewalReminderDay(daysRemaining);

	// 0) 支払い失敗 (dunning) 通知 — **opt-out / 年 6 回上限より前** (#4507)
	if (isDunningNotice(ctx, isReminderDay)) {
		return sendDunningNotice(ctx, daysRemaining as number, dryRun);
	}

	// 1) opt-out チェック (年 6 回枠とは独立した拒絶)
	const optOut = await repos.settings.getSetting(UNSUBSCRIBED_KEY, ctx.tenantId);
	if (optOut) return 'skipped-unsubscribed';

	// 2) 期限切れ前リマインド判定
	//    #4507: dunning 中 (grace_period) はここに来ない (上の分岐で処理済み)。
	//    それでも条件に status を含めるのは、将来 reminder 日以外の送信日を足したときに
	//    「支払い失敗中の顧客へ marketing 便の更新案内」が復活しないようにするため。
	const renewalEligible =
		isReminderDay && !!ctx.plan && ctx.status !== SUBSCRIPTION_STATUS.GRACE_PERIOD; // 一般プランのみ (trial 等を除外)

	// 3) 休眠復帰判定
	const {
		days: dormantDays,
		eligible: dormantEligible,
		alreadySent: dormantAlreadySent,
	} = await resolveDormantState(ctx, now);

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
			planLabel: getSubscriptionPlanLabel(ctx.plan ?? ''),
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
		paymentFailedSent: 0,
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
					status: tenant.status,
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
				case 'payment-failed-sent':
					result.paymentFailedSent++;
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
