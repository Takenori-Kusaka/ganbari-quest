// src/lib/server/services/email-service.ts
// SES ベースのメール送信サービス
// ローカルモード (AUTH_MODE=local) ではログ出力のみ

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logger';

// ============================================================
// 型定義
// ============================================================

export interface SendEmailParams {
	to: string;
	subject: string;
	htmlBody: string;
	textBody?: string;
}

// ============================================================
// SES クライアント（遅延初期化）
// ============================================================

let sesClient: SESClient | null = null;

function getSesClient(): SESClient {
	if (sesClient) return sesClient;
	sesClient = new SESClient({ region: process.env.AWS_REGION ?? 'ap-northeast-1' });
	return sesClient;
}

function getSenderEmail(): string {
	return env.SES_SENDER_EMAIL ?? 'noreply@ganbari-quest.com';
}

function getConfigSetName(): string | undefined {
	return env.SES_CONFIG_SET_NAME ?? undefined;
}

function isLocalMode(): boolean {
	return (process.env.AUTH_MODE ?? 'local') === 'local';
}

// ============================================================
// メール送信（コア）
// ============================================================

export async function sendEmail(params: SendEmailParams): Promise<boolean> {
	const { to, subject, htmlBody, textBody } = params;

	if (isLocalMode()) {
		logger.info('[email] ローカルモード: メール送信スキップ', {
			context: { to, subject },
		});
		return true;
	}

	try {
		const client = getSesClient();
		const command = new SendEmailCommand({
			Source: `がんばりクエスト <${getSenderEmail()}>`,
			Destination: { ToAddresses: [to] },
			Message: {
				Subject: { Data: subject, Charset: 'UTF-8' },
				Body: {
					Html: { Data: htmlBody, Charset: 'UTF-8' },
					...(textBody ? { Text: { Data: textBody, Charset: 'UTF-8' } } : {}),
				},
			},
			ConfigurationSetName: getConfigSetName(),
		});

		await client.send(command);
		logger.info('[email] メール送信成功', { context: { to, subject } });
		return true;
	} catch (err) {
		logger.error('[email] メール送信失敗', { error: String(err), context: { to, subject } });
		return false;
	}
}

// ============================================================
// テンプレート: 共通レイアウト
// ============================================================

function wrapTemplate(content: string): string {
	return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
  .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; text-align: center; }
  .header h1 { color: #ffffff; font-size: 20px; margin: 0; }
  .content { padding: 32px 24px; color: #333333; line-height: 1.7; }
  .content h2 { color: #4f46e5; font-size: 18px; margin-top: 0; }
  .footer { padding: 16px 24px; background: #f9fafb; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
  .button { display: inline-block; padding: 12px 24px; background: #6366f1; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: bold; }
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

// ============================================================
// 各種メール送信関数
// ============================================================

/** ウェルカムメール（サインアップ完了後） */
export async function sendWelcomeEmail(email: string, familyName?: string): Promise<boolean> {
	const greeting = familyName ? `${familyName}さん、` : '';
	return sendEmail({
		to: email,
		subject: 'がんばりクエストへようこそ！',
		htmlBody: wrapTemplate(`
      <h2>${greeting}ようこそ！</h2>
      <p>がんばりクエストへのご登録ありがとうございます。</p>
      <p>お子さまの毎日のがんばりを記録して、成長を見守りましょう！</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="https://ganbari-quest.com/admin" class="button">管理画面を開く</a>
      </p>
      <p>ご不明な点がございましたら、管理画面の「せってい」からお気軽にお問い合わせください。</p>
    `),
		textBody: `${greeting}ようこそ！\n\nがんばりクエストへのご登録ありがとうございます。\nお子さまの毎日のがんばりを記録して、成長を見守りましょう！\n\n管理画面: https://ganbari-quest.com/admin`,
	});
}

/** 問い合わせ受付確認メール */
export async function sendInquiryConfirmationEmail(
	email: string,
	inquiryId: string,
): Promise<boolean> {
	return sendEmail({
		to: email,
		subject: `【がんばりクエスト】お問い合わせを受け付けました（${inquiryId}）`,
		htmlBody: wrapTemplate(`
      <h2>お問い合わせを受け付けました</h2>
      <p>お問い合わせ番号: <strong>${inquiryId}</strong></p>
      <p>いただいた内容を確認し、必要に応じてご返信いたします。</p>
      <p>※ 内容によっては返信にお時間をいただく場合がございます。</p>
    `),
		textBody: `お問い合わせを受け付けました\n\nお問い合わせ番号: ${inquiryId}\nいただいた内容を確認し、必要に応じてご返信いたします。`,
	});
}

/** 解約受付通知メール */
export async function sendCancellationEmail(email: string, graceEndDate: string): Promise<boolean> {
	return sendEmail({
		to: email,
		subject: '【がんばりクエスト】解約手続きを受け付けました',
		htmlBody: wrapTemplate(`
      <h2>解約手続きを受け付けました</h2>
      <p><strong>${graceEndDate}</strong> まではデータの閲覧・エクスポートが可能です。</p>
      <p>この期間中に解約をキャンセルすることもできます。</p>
      <p>期間終了後、すべてのデータが完全に削除されます。削除後の復旧はできません。</p>
      <p>データのバックアップが必要な場合は、管理画面の「せってい」からエクスポートしてください。</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="https://ganbari-quest.com/admin/settings" class="button">設定画面を開く</a>
      </p>
    `),
		textBody: `解約手続きを受け付けました\n\n${graceEndDate} まではデータの閲覧・エクスポートが可能です。\nこの期間中に解約をキャンセルすることもできます。\n\n期間終了後、すべてのデータが完全に削除されます。`,
	});
}

/** データ削除完了通知メール */
export async function sendDeletionCompleteEmail(email: string): Promise<boolean> {
	return sendEmail({
		to: email,
		subject: '【がんばりクエスト】データ削除が完了しました',
		htmlBody: wrapTemplate(`
      <h2>データ削除が完了しました</h2>
      <p>がんばりクエストのすべてのデータが削除されました。</p>
      <p>ご利用いただきありがとうございました。</p>
      <p>再度ご利用いただく場合は、新規アカウントとしてサインアップしてください。</p>
    `),
		textBody:
			'データ削除が完了しました\n\nがんばりクエストのすべてのデータが削除されました。\nご利用いただきありがとうございました。',
	});
}

/** メンバー除外通知メール */
export async function sendMemberRemovedEmail(email: string, tenantName: string): Promise<boolean> {
	return sendEmail({
		to: email,
		subject: '【がんばりクエスト】家族グループからの除外通知',
		htmlBody: wrapTemplate(`
      <h2>家族グループからの除外通知</h2>
      <p>家族グループ「${tenantName}」のオーナーにより、メンバーから除外されました。</p>
      <p>新しい招待リンクがあれば、別のグループに参加できます。</p>
    `),
		textBody: `家族グループ「${tenantName}」のオーナーにより、メンバーから除外されました。\n新しい招待リンクがあれば、別のグループに参加できます。`,
	});
}

/** メンバー参加通知メール（owner宛） */
export async function sendMemberJoinedEmail(
	ownerEmail: string,
	memberName: string,
	role: string,
): Promise<boolean> {
	return sendEmail({
		to: ownerEmail,
		subject: '【がんばりクエスト】新しいメンバーが参加しました',
		htmlBody: wrapTemplate(`
      <h2>新しいメンバーが参加しました</h2>
      <p><strong>${memberName}</strong> さんが「${role}」として家族グループに参加しました。</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="https://ganbari-quest.com/admin/members" class="button">メンバー管理を開く</a>
      </p>
    `),
		textBody: `${memberName} さんが「${role}」として家族グループに参加しました。`,
	});
}

/** ライセンスキー通知メール (#0247) */
export async function sendLicenseKeyEmail(
	email: string,
	licenseKey: string,
	plan: string,
): Promise<boolean> {
	const planLabels: Record<string, string> = {
		monthly: 'スタンダード月額プラン',
		yearly: 'スタンダード年額プラン',
		'family-monthly': 'ファミリー月額プラン',
		'family-yearly': 'ファミリー年額プラン',
		lifetime: '永久ライセンス',
	};
	const planLabel = planLabels[plan] ?? '月額プラン';
	return sendEmail({
		to: email,
		subject: '【がんばりクエスト】ライセンスキーのお知らせ',
		htmlBody: wrapTemplate(`
      <h2>ライセンスキーをお届けします</h2>
      <p>プレミアムプラン（${planLabel}）のご購入ありがとうございます。</p>
      <div style="background: #f5f3ff; border: 2px solid #6366f1; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
        <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">ライセンスキー</p>
        <p style="font-size: 28px; font-weight: bold; color: #4f46e5; letter-spacing: 4px; margin: 0; font-family: 'Courier New', monospace;">${licenseKey}</p>
      </div>
      <p>このキーは、新しいデバイスやブラウザからサインアップする際に使用できます。</p>
      <p>ライセンスキーは管理画面の「ライセンス」ページでもいつでも確認できます。</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="https://ganbari-quest.com/admin/license" class="button">ライセンス管理を開く</a>
      </p>
      <p style="font-size: 12px; color: #999;">※ このキーは大切に保管してください。第三者に共有しないでください。</p>
    `),
		textBody: `プレミアムプラン（${planLabel}）のご購入ありがとうございます。\n\nライセンスキー: ${licenseKey}\n\nこのキーは、新しいデバイスやブラウザからサインアップする際に使用できます。\nライセンス管理: https://ganbari-quest.com/admin/license`,
	});
}

/** 週次活動レポート */
export interface WeeklyReportData {
	childName: string;
	dateRange: string;
	categories: { name: string; count: number; diff: number }[];
	streak: number;
	pointsEarned: number;
	totalPoints: number;
	newAchievements: string[];
}

export async function sendWeeklyReportEmail(
	email: string,
	report: WeeklyReportData,
): Promise<boolean> {
	const catRows = report.categories
		.map((c) => {
			const diff = c.diff > 0 ? `+${c.diff}` : c.diff === 0 ? '±0' : String(c.diff);
			return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${c.name}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;font-weight:bold">${c.count}回</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:${c.diff >= 0 ? '#22c55e' : '#ef4444'}">${diff}</td></tr>`;
		})
		.join('');

	const achievementHtml =
		report.newAchievements.length > 0
			? `<p style="margin-top:16px">🏆 <strong>新しい実績:</strong> ${report.newAchievements.join('、')}</p>`
			: '';

	return sendEmail({
		to: email,
		subject: `🌟 ${report.childName}の今週のがんばり（${report.dateRange}）`,
		htmlBody: wrapTemplate(`
      <h2>${report.childName}の今週のがんばり</h2>
      <p style="color:#666">${report.dateRange}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="background:#f5f3ff"><th style="padding:8px 12px;text-align:left">カテゴリ</th><th style="padding:8px 12px;text-align:center">回数</th><th style="padding:8px 12px;text-align:center">前週比</th></tr>
        ${catRows}
      </table>
      <div style="display:flex;gap:16px;margin:16px 0;flex-wrap:wrap">
        <div style="flex:1;min-width:120px;background:#fef3c7;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:24px">🔥</div>
          <div style="font-size:20px;font-weight:bold">${report.streak}日</div>
          <div style="font-size:12px;color:#666">連続記録</div>
        </div>
        <div style="flex:1;min-width:120px;background:#dbeafe;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:24px">⭐</div>
          <div style="font-size:20px;font-weight:bold">+${report.pointsEarned}pt</div>
          <div style="font-size:12px;color:#666">累計: ${report.totalPoints}pt</div>
        </div>
      </div>
      ${achievementHtml}
      <p style="text-align:center;margin:24px 0">
        <a href="https://ganbari-quest.com/admin" class="button">アプリを開く</a>
      </p>
    `),
		textBody: `${report.childName}の今週のがんばり（${report.dateRange}）\n\n${report.categories.map((c) => `${c.name}: ${c.count}回`).join('\n')}\n\n🔥 連続記録: ${report.streak}日\n⭐ ポイント: +${report.pointsEarned}pt（累計: ${report.totalPoints}pt）`,
	});
}
