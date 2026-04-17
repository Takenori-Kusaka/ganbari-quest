// src/lib/server/services/trial-notification-service.ts
// #737: トライアル終了時の通知フロー
// - 終了3日前 / 1日前 / 当日のメール通知
// - トライアル終了後の初回ログイン時モーダルフラグ管理

import { getPlanShortLabel } from '$lib/domain/labels';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { getPlanLimits } from '$lib/server/services/plan-limit-service';
import { sendEmail } from './email-service';
import type { TrialTier } from './trial-service';
import { getTrialStatus } from './trial-service';

// ============================================================
// Types
// ============================================================

export interface TrialNotificationSchedule {
	tenantId: string;
	daysRemaining: number;
	trialEndDate: string;
	trialTier: TrialTier;
	notifications: TrialNotificationType[];
}

export type TrialNotificationType =
	| 'trial_ending_3days'
	| 'trial_ending_1day'
	| 'trial_ended_today'
	| 'trial_expired_login';

export interface TrialExpirationInfo {
	isExpired: boolean;
	wasTrialUsed: boolean;
	showExpirationModal: boolean;
	trialTier: TrialTier | null;
	archivedResourceCount: number;
}

// ============================================================
// Constants
// ============================================================

const _NOTIFICATION_THRESHOLDS = [3, 1, 0] as const;

// ============================================================
// Notification schedule
// ============================================================

/**
 * テナントのトライアル状態に応じて送信すべき通知の種類を判定する。
 *
 * cron ジョブ / scheduled task から日次で呼び出される想定。
 */
export async function getNotificationSchedule(
	tenantId: string,
): Promise<TrialNotificationSchedule | null> {
	const status = await getTrialStatus(tenantId);

	if (!status.isTrialActive || !status.trialEndDate || !status.trialTier) {
		return null;
	}

	const notifications: TrialNotificationType[] = [];

	if (status.daysRemaining === 3) {
		notifications.push('trial_ending_3days');
	}
	if (status.daysRemaining === 1) {
		notifications.push('trial_ending_1day');
	}
	if (status.daysRemaining === 0) {
		notifications.push('trial_ended_today');
	}

	if (notifications.length === 0) return null;

	return {
		tenantId,
		daysRemaining: status.daysRemaining,
		trialEndDate: status.trialEndDate,
		trialTier: status.trialTier,
		notifications,
	};
}

// ============================================================
// Email notifications
// ============================================================

/**
 * トライアル終了3日前のメール通知を送信する。
 */
export async function sendTrialEnding3DaysEmail(
	email: string,
	trialEndDate: string,
	trialTier: TrialTier,
): Promise<boolean> {
	const tierLabel = getPlanShortLabel(trialTier);
	const freeLimits = getPlanLimits('free');
	return sendEmail({
		to: email,
		subject: '【がんばりクエスト】トライアル期間が残り3日です',
		htmlBody: wrapTrialEmailTemplate(`
      <h2>トライアル期間が残り3日です</h2>
      <p>現在ご利用中の<strong>${tierLabel}プラン</strong>のトライアル期間は <strong>${trialEndDate}</strong> に終了します。</p>
      <p>トライアル終了後は、フリープランに切り替わります。フリープランでは以下の制限があります:</p>
      <ul>
        <li>登録できる子供の数: ${freeLimits.maxChildren}人まで</li>
        <li>カスタム活動数: ${freeLimits.maxActivities}個まで</li>
        <li>データ保持期間: ${freeLimits.historyRetentionDays}日</li>
      </ul>
      <p>引き続きすべての機能をご利用いただくには、本契約へのお申し込みをお願いいたします。</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="https://ganbari-quest.com/admin/license" class="button">プランを確認する</a>
      </p>
    `),
		textBody: `トライアル期間が残り3日です\n\n${tierLabel}プランのトライアル期間は ${trialEndDate} に終了します。\n引き続きご利用いただくには、本契約へのお申し込みをお願いいたします。\n\nプラン確認: https://ganbari-quest.com/admin/license`,
	});
}

/**
 * トライアル終了1日前のメール通知を送信する。
 */
export async function sendTrialEnding1DayEmail(
	email: string,
	trialEndDate: string,
	trialTier: TrialTier,
): Promise<boolean> {
	const tierLabel = getPlanShortLabel(trialTier);
	return sendEmail({
		to: email,
		subject: '【がんばりクエスト】トライアルが明日終了します',
		htmlBody: wrapTrialEmailTemplate(`
      <h2>トライアルが明日終了します</h2>
      <p><strong>${tierLabel}プラン</strong>のトライアル期間は <strong>明日（${trialEndDate}）</strong> に終了します。</p>
      <p>トライアル終了後、フリープランの上限を超えるリソース（子供・活動など）は自動的にアーカイブされます。</p>
      <p><strong>データは削除されません。</strong>アップグレードすればいつでも復元できます。</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="https://ganbari-quest.com/admin/license" class="button">今すぐアップグレード</a>
      </p>
    `),
		textBody: `トライアルが明日終了します\n\n${tierLabel}プランのトライアル期間は明日（${trialEndDate}）に終了します。\nアップグレード: https://ganbari-quest.com/admin/license`,
	});
}

/**
 * トライアル終了当日のメール通知を送信する。
 */
export async function sendTrialEndedTodayEmail(
	email: string,
	trialTier: TrialTier,
): Promise<boolean> {
	const tierLabel = getPlanShortLabel(trialTier);
	return sendEmail({
		to: email,
		subject: '【がんばりクエスト】トライアル期間が終了しました',
		htmlBody: wrapTrialEmailTemplate(`
      <h2>トライアル期間が終了しました</h2>
      <p><strong>${tierLabel}プラン</strong>のトライアル期間が終了しました。現在はフリープランでご利用いただいています。</p>
      <p>フリープランの上限を超えるリソースはアーカイブされています。データは安全に保管されており、アップグレードすれば復元できます。</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="https://ganbari-quest.com/admin/license" class="button">プランをアップグレード</a>
      </p>
      <p style="font-size: 12px; color: #999;">アーカイブされたデータは、アップグレード後にすべて復元されます。</p>
    `),
		textBody: `トライアル期間が終了しました\n\n${tierLabel}プランのトライアル期間が終了しました。\nフリープランでのご利用となります。\n\nアップグレード: https://ganbari-quest.com/admin/license`,
	});
}

// ============================================================
// Trial expiration check (for login-time modal)
// ============================================================

/**
 * トライアル終了後の初回ログイン時に表示すべきモーダル情報を返す。
 *
 * 条件:
 * - トライアルを使用済み (trialUsed=true)
 * - 現在アクティブでない (isTrialActive=false)
 * - 有料プランでない (licenseStatus != 'active')
 * - まだモーダルを表示していない (settings の trial_expiration_modal_shown が false)
 */
export async function getTrialExpirationInfo(
	tenantId: string,
	licenseStatus: string,
): Promise<TrialExpirationInfo> {
	const status = await getTrialStatus(tenantId);

	const isExpired = status.trialUsed && !status.isTrialActive;
	const isNotPaid = licenseStatus !== 'active';

	if (!isExpired || !isNotPaid) {
		return {
			isExpired: false,
			wasTrialUsed: status.trialUsed,
			showExpirationModal: false,
			trialTier: null,
			archivedResourceCount: 0,
		};
	}

	// モーダル表示済みフラグをチェック
	const repos = getRepos();
	const settings = await repos.settings.getSettings(['trial_expiration_modal_shown'], tenantId);
	const alreadyShown = settings.trial_expiration_modal_shown === 'true';

	// アーカイブ済みリソース数を取得
	const archivedChildren = await repos.child.findArchivedChildren(tenantId);

	return {
		isExpired: true,
		wasTrialUsed: true,
		showExpirationModal: !alreadyShown,
		trialTier: status.trialTier,
		archivedResourceCount: archivedChildren.length,
	};
}

/**
 * トライアル終了モーダルを表示済みとしてマークする。
 */
export async function markTrialExpirationModalShown(tenantId: string): Promise<void> {
	const repos = getRepos();
	await repos.settings.setSetting('trial_expiration_modal_shown', 'true', tenantId);
	logger.info('[trial-notification] Trial expiration modal marked as shown', {
		context: { tenantId },
	});
}

/**
 * トライアル通知を一括処理する（cron ジョブ用）。
 *
 * 各テナントのオーナーメールアドレスを取得し、
 * 通知スケジュールに応じてメールを送信する。
 */
export async function processTrialNotifications(
	tenantIds: string[],
): Promise<{ sent: number; skipped: number; errors: number }> {
	let sent = 0;
	let skipped = 0;
	let errors = 0;

	for (const tenantId of tenantIds) {
		try {
			const schedule = await getNotificationSchedule(tenantId);
			if (!schedule) {
				skipped++;
				continue;
			}

			// テナントオーナーのメールアドレスを取得
			const repos = getRepos();
			const tenant = await repos.auth.findTenantById(tenantId);
			if (!tenant) {
				skipped++;
				continue;
			}

			const members = await repos.auth.findTenantMembers(tenantId);
			const owner = members.find((m) => m.role === 'owner');
			if (!owner) {
				skipped++;
				continue;
			}

			const user = await repos.auth.findUserById(owner.userId);
			if (!user?.email) {
				skipped++;
				continue;
			}

			for (const notifType of schedule.notifications) {
				let success = false;
				switch (notifType) {
					case 'trial_ending_3days':
						success = await sendTrialEnding3DaysEmail(
							user.email,
							schedule.trialEndDate,
							schedule.trialTier,
						);
						break;
					case 'trial_ending_1day':
						success = await sendTrialEnding1DayEmail(
							user.email,
							schedule.trialEndDate,
							schedule.trialTier,
						);
						break;
					case 'trial_ended_today':
						success = await sendTrialEndedTodayEmail(user.email, schedule.trialTier);
						break;
					default:
						break;
				}
				if (success) {
					sent++;
				} else {
					errors++;
				}
			}
		} catch (err) {
			logger.error('[trial-notification] Failed to process tenant', {
				error: String(err),
				context: { tenantId },
			});
			errors++;
		}
	}

	return { sent, skipped, errors };
}

// ============================================================
// Email template helper
// ============================================================

function wrapTrialEmailTemplate(content: string): string {
	return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
  .header { background: linear-gradient(135deg, #f59e0b, #d97706); padding: 24px; text-align: center; }
  .header h1 { color: #ffffff; font-size: 20px; margin: 0; }
  .content { padding: 32px 24px; color: #333333; line-height: 1.7; }
  .content h2 { color: #d97706; font-size: 18px; margin-top: 0; }
  .footer { padding: 16px 24px; background: #f9fafb; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
  .button { display: inline-block; padding: 12px 24px; background: #f59e0b; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: bold; }
  ul { padding-left: 20px; }
  li { margin-bottom: 4px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>がんばりクエスト</h1>
  </div>
  <div class="content">
    ${content}
  </div>
  <div class="footer">
    <p>このメールは「がんばりクエスト」から自動送信されています。</p>
    <p>&copy; 2026 がんばりクエスト</p>
  </div>
</div>
</body>
</html>`;
}
