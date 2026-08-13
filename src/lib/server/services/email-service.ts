// src/lib/server/services/email-service.ts
// SES ベースのメール送信サービス
// ローカルモード (AUTH_MODE=local) ではログ出力のみ

import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { env } from '$env/dynamic/private';
import {
	DELETION_COMPLETE_EMAIL_LABELS,
	DELETION_RESERVED_EMAIL_LABELS,
	DELETION_WARNING_EMAIL_LABELS,
	LIFECYCLE_EMAIL_LABELS,
	OWNERSHIP_TRANSFER_EMAIL_LABELS,
	PAYMENT_FAILED_EMAIL_LABELS,
	PIN_RESET_EMAIL_LABELS,
	PMF_SURVEY_LABELS,
} from '$lib/domain/labels';
// #2057: 「管理画面」 → 「ご家族の見守り画面」 rename atom 参照
import { ADMIN_VIEW_TERMS, CANCEL_TERMS, PLAN_FULL_TERMS } from '$lib/domain/terms';
import { logger } from '$lib/server/logger';
import { EMPTY_HTML, type HtmlSafe, html, joinHtml } from './email-html';
import { generateUnsubscribeToken, type UnsubscribeKind } from './unsubscribe-token';

// ============================================================
// 型定義
// ============================================================

export interface SendEmailParams {
	to: string;
	subject: string;
	htmlBody: string;
	textBody?: string;
	/**
	 * #1601: 特定電子メール法 + RFC 8058 (List-Unsubscribe One-Click) 対応。
	 * 指定すると List-Unsubscribe / List-Unsubscribe-Post ヘッダを付与した
	 * SendRawEmailCommand で送信する（SendEmailCommand はカスタムヘッダ非対応のため）。
	 */
	listUnsubscribeUrl?: string;
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
	const { to, subject, htmlBody, textBody, listUnsubscribeUrl } = params;

	if (isLocalMode()) {
		// #1601: ローカル開発時は tmp/emails/ に HTML を書き出して目視確認できるようにする。
		await writeLocalEmailPreview({ to, subject, htmlBody, listUnsubscribeUrl });
		logger.info('[email] ローカルモード: メール送信スキップ', {
			context: { to, subject, hasListUnsubscribe: Boolean(listUnsubscribeUrl) },
		});
		return true;
	}

	try {
		const client = getSesClient();

		if (listUnsubscribeUrl) {
			// SendEmailCommand は List-Unsubscribe 等のカスタムヘッダ非対応のため、
			// Raw MIME を組み立てて SendRawEmailCommand で送信する (RFC 8058)。
			const rawMessage = buildRawMimeMessage({
				from: `がんばりクエスト <${getSenderEmail()}>`,
				to,
				subject,
				htmlBody,
				textBody,
				listUnsubscribeUrl,
			});
			await client.send(
				new SendRawEmailCommand({
					RawMessage: { Data: rawMessage },
					ConfigurationSetName: getConfigSetName(),
				}),
			);
		} else {
			await client.send(
				new SendEmailCommand({
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
				}),
			);
		}

		logger.info('[email] メール送信成功', {
			context: { to, subject, hasListUnsubscribe: Boolean(listUnsubscribeUrl) },
		});
		return true;
	} catch (err) {
		logger.error('[email] メール送信失敗', { error: String(err), context: { to, subject } });
		return false;
	}
}

// ============================================================
// Raw MIME ビルダ (#1601 List-Unsubscribe ヘッダ対応)
// ============================================================

interface RawMimeParams {
	from: string;
	to: string;
	subject: string;
	htmlBody: string;
	textBody?: string;
	listUnsubscribeUrl: string;
}

/**
 * RFC 5322 + RFC 8058 準拠の最小 MIME メッセージを組み立てる。
 *
 * - Subject は RFC 2047 (=?UTF-8?B?...?=) で base64 エンコード
 * - List-Unsubscribe ヘッダは <https://...> 形式 (RFC 2369)
 * - List-Unsubscribe-Post: List-Unsubscribe=One-Click (RFC 8058)
 */
function buildRawMimeMessage(params: RawMimeParams): Uint8Array {
	const { from, to, subject, htmlBody, textBody, listUnsubscribeUrl } = params;
	const boundary = `gq-bnd-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;

	const headers = [
		`From: ${from}`,
		`To: ${to}`,
		`Subject: ${subjectEncoded}`,
		'MIME-Version: 1.0',
		`List-Unsubscribe: <${listUnsubscribeUrl}>`,
		'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
		`Content-Type: multipart/alternative; boundary="${boundary}"`,
	];

	const parts: string[] = [];
	if (textBody) {
		parts.push(
			[
				`--${boundary}`,
				'Content-Type: text/plain; charset="UTF-8"',
				'Content-Transfer-Encoding: base64',
				'',
				Buffer.from(textBody, 'utf-8').toString('base64'),
			].join('\r\n'),
		);
	}
	parts.push(
		[
			`--${boundary}`,
			'Content-Type: text/html; charset="UTF-8"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from(htmlBody, 'utf-8').toString('base64'),
		].join('\r\n'),
	);
	parts.push(`--${boundary}--`);

	const body = parts.join('\r\n');
	const message = `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
	return Buffer.from(message, 'utf-8');
}

// ============================================================
// ローカル開発用プレビュー (#1601)
// ============================================================

/**
 * AUTH_MODE=local では実 SES を呼ばない代わりに `tmp/emails/<timestamp>.html`
 * へ HTML を書き出し、ブラウザで目視確認できるようにする。
 *
 * `tmp/` は `.gitignore` 配下なのでコミットされない。fs アクセスに失敗しても
 * 静かに無視する（テスト環境では tmp ディレクトリが無いケースもある）。
 */
async function writeLocalEmailPreview(params: {
	to: string;
	subject: string;
	htmlBody: string;
	listUnsubscribeUrl?: string;
}): Promise<void> {
	if (process.env.NODE_ENV === 'test') return;
	if (process.env.SKIP_LOCAL_EMAIL_PREVIEW === 'true') return;
	try {
		const fs = await import('node:fs/promises');
		const path = await import('node:path');
		const dir = path.join(process.cwd(), 'tmp', 'emails');
		await fs.mkdir(dir, { recursive: true });
		const safeSubject = params.subject
			.replace(/[\\/:*?"<>|]/g, '_')
			.replace(/\s+/g, '_')
			.slice(0, 60);
		const filename = `${Date.now()}-${safeSubject || 'email'}.html`;
		const headerNote = params.listUnsubscribeUrl
			? `<!-- List-Unsubscribe: ${params.listUnsubscribeUrl} -->\n<!-- To: ${params.to} -->\n`
			: `<!-- To: ${params.to} -->\n`;
		await fs.writeFile(path.join(dir, filename), headerNote + params.htmlBody, 'utf-8');
	} catch {
		// preview 失敗はサイレント (logger を通すと重複出力になるため)
	}
}

// ============================================================
// テンプレート: 共通レイアウト
// ============================================================

function wrapTemplate(content: HtmlSafe): string {
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
		htmlBody: wrapTemplate(html`
      <h2>${greeting}ようこそ！</h2>
      <p>がんばりクエストへのご登録ありがとうございます。</p>
      <p>お子さまの毎日のがんばりを記録して、成長を見守りましょう！</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="https://ganbari-quest.com/admin" class="button">${ADMIN_VIEW_TERMS.canonical}を開く</a>
      </p>
      <p>ご不明な点がございましたら、${ADMIN_VIEW_TERMS.canonical}の「せってい」からお気軽にお問い合わせください。</p>
    `),
		textBody: `${greeting}ようこそ！\n\nがんばりクエストへのご登録ありがとうございます。\nお子さまの毎日のがんばりを記録して、成長を見守りましょう！\n\n${ADMIN_VIEW_TERMS.canonical}: https://ganbari-quest.com/admin`,
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
		htmlBody: wrapTemplate(html`
      <h2>お問い合わせを受け付けました</h2>
      <p>お問い合わせ番号: <strong>${inquiryId}</strong></p>
      <p>いただいた内容を確認し、必要に応じてご返信いたします。</p>
      <p>※ 内容によっては返信にお時間をいただく場合がございます。</p>
    `),
		textBody: `お問い合わせを受け付けました\n\nお問い合わせ番号: ${inquiryId}\nいただいた内容を確認し、必要に応じてご返信いたします。`,
	});
}

/**
 * 解約受付通知メール (#3991)。
 *
 * `periodEndDate` は **現在の請求期間の終了日** であり、退会 (アカウント削除) の猶予期限ではない。
 * 旧文面は「期間終了後、すべてのデータが完全に削除されます」と退会側の説明を載せていたが、
 * 解約の結果は「無料プランに移行 (データ保持)」であり (phase1-cancellation-requirements.md)、
 * 特商法表示「解約後は現在の請求期間終了まで引き続きご利用いただけます」とも食い違っていた。
 *
 * ここで伝える日付は `/admin/subscription` の解約申請中バナーにも表示されるため、
 * メールを消してしまった親も画面でいつでも再確認できる。
 */
export async function sendCancellationEmail(
	email: string,
	periodEndDate: string,
): Promise<boolean> {
	const untilPhrase = periodEndDate ? `${periodEndDate} まで` : '現在の請求期間の終了日まで';
	return sendEmail({
		to: email,
		subject: '【がんばりクエスト】解約手続きを受け付けました',
		htmlBody: wrapTemplate(html`
      <h2>解約手続きを受け付けました</h2>
      <p><strong>${untilPhrase}</strong>、現在の有料プランをそのままご利用いただけます。</p>
      <p>その後は${PLAN_FULL_TERMS.free}に切り替わります。お子さまの記録は残りますので、引き続き${PLAN_FULL_TERMS.free}の範囲でご利用いただけます。</p>
      <p>それまでの間は、${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」から${CANCEL_TERMS.anytime}のお手続きを取り消して継続できます。</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="https://ganbari-quest.com/admin/subscription" class="button">プラン・お支払いを開く</a>
      </p>
    `),
		textBody: `解約手続きを受け付けました\n\n${untilPhrase}、現在の有料プランをそのままご利用いただけます。\nその後は${PLAN_FULL_TERMS.free}に切り替わります（お子さまの記録は残ります）。\n\nそれまでの間は、${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」から${CANCEL_TERMS.anytime}のお手続きを取り消して継続できます。`,
	});
}

export interface DeletionWarningParams {
	email: string;
	/** 宛名 (オーナーの表示名。未設定時は呼び出し側がテナント名にフォールバックする) */
	ownerName: string;
	/** 表示用の物理削除予定日 (JST 暦日、例: 2026年4月15日) */
	deletionDate: string;
	/** 削除予定日までの残り日数 (JST 暦日換算、1 以上) */
	daysRemaining: number;
}

/**
 * データ削除予定日の予告メール (#2399)。
 *
 * 猶予期間中に「このまま何もしなければ消える」ことと復元導線を 1 度だけ伝える。
 *
 * 送信経路の設計 (AC / runbook §2 整合):
 *   - `listUnsubscribeUrl` を **付けない**。購読解除リンクは marketing 配信を止めるものであり、
 *     お手続きに関する連絡に添えると「解除すれば止まる」と誤解させる。本メールは配信設定に
 *     かかわらず届く必要があるため、marketing 系 (`wrapLifecycleTemplate` + List-Unsubscribe) では
 *     なく汎用トランザクション template を使う
 *   - `marketing-email-counter` (年 6 回上限) を経由しない。上限に達した月にデータ消失予告が
 *     握り潰される事態を構造的に作らない
 *   - 子供の名前・活動内容は差し込まない (引き止め目的の情報利用を避ける、ADR-0012)
 */
export async function sendDeletionWarningEmail(params: DeletionWarningParams): Promise<boolean> {
	const labels = DELETION_WARNING_EMAIL_LABELS;
	const { email, ownerName, deletionDate, daysRemaining } = params;
	const ctaUrl = `${getAppBaseUrl()}/admin/settings/account`;

	return sendEmail({
		to: email,
		subject: `【がんばりクエスト】${labels.subject(daysRemaining)}`,
		htmlBody: wrapTemplate(html`
      <h2>${labels.heading}</h2>
      <p>${labels.greeting(ownerName)}</p>
      <p>${labels.intro}</p>
      <p><strong>${labels.deletionDateLine(deletionDate, daysRemaining)}</strong></p>
      <p>${labels.irreversibleNote}</p>
      <p>${labels.restoreNote(ADMIN_VIEW_TERMS.canonical)}</p>
      <p>${labels.noActionNote}</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${ctaUrl}" class="button">${labels.ctaLabel}</a>
      </p>
      <p>${labels.transactionalNote}</p>
    `),
		textBody: [
			labels.greeting(ownerName),
			'',
			labels.intro,
			labels.deletionDateLine(deletionDate, daysRemaining),
			labels.irreversibleNote,
			'',
			labels.restoreNote(ADMIN_VIEW_TERMS.canonical),
			labels.noActionNote,
			'',
			`${labels.ctaLabel}: ${ctaUrl}`,
			'',
			labels.transactionalNote,
		].join('\n'),
	});
}

export interface DeletionReservedParams {
	email: string;
	/** 宛名 (オーナーの表示名。未設定時は呼び出し側がテナント名にフォールバックする) */
	ownerName: string;
	/** 表示用の物理削除予定日 (JST 暦日、例: 2026年4月15日) */
	deletionDate: string;
	/** 猶予期間の日数 (プラン別、1 以上) */
	graceDays: number;
}

/**
 * 退会（アカウント削除）予約の受付通知メール (#4507)。
 *
 * 旧実装では退会予約 route がメールを 1 通も送っておらず、削除予告メール (#2399) が
 * 届くまで「予約できたのか」を確かめる手段がメールに無かった。
 *
 * 送信経路は削除予告メール (`sendDeletionWarningEmail`) と同区分のトランザクション便:
 *   - `listUnsubscribeUrl` を付けない (お手続きの連絡を配信設定で止めさせない)
 *   - `marketing-email-counter` (年 6 回上限) を経由しない
 */
export async function sendDeletionReservedEmail(params: DeletionReservedParams): Promise<boolean> {
	const labels = DELETION_RESERVED_EMAIL_LABELS;
	const { email, ownerName, deletionDate, graceDays } = params;
	const ctaUrl = `${getAppBaseUrl()}/admin/settings/account`;

	return sendEmail({
		to: email,
		subject: `【がんばりクエスト】${labels.subject}`,
		htmlBody: wrapTemplate(html`
      <h2>${labels.heading}</h2>
      <p>${labels.greeting(ownerName)}</p>
      <p>${labels.intro}</p>
      <p><strong>${labels.scheduleLine(deletionDate, graceDays)}</strong></p>
      <p>${labels.restoreLine(ADMIN_VIEW_TERMS.canonical)}</p>
      <p>${labels.exportLine}</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${ctaUrl}" class="button">${labels.ctaLabel}</a>
      </p>
      <p>${labels.transactionalNote}</p>
    `),
		textBody: [
			labels.greeting(ownerName),
			'',
			labels.intro,
			labels.scheduleLine(deletionDate, graceDays),
			labels.restoreLine(ADMIN_VIEW_TERMS.canonical),
			labels.exportLine,
			'',
			`${labels.ctaLabel}: ${ctaUrl}`,
			'',
			labels.transactionalNote,
		].join('\n'),
	});
}

/**
 * データ削除完了通知メール。
 *
 * #4507: 長らく production 呼び出しゼロの dead code だった (無料プランの退会は
 * 即時物理削除のため、通知 0 通でデータが消えていた)。現在は物理削除を行う
 * `deleteOwnerOnlyAccount` / `deleteOwnerFullDelete` が削除確定後に送る
 * (即時削除・猶予期間満了後の cron 削除の両経路をカバーする)。
 */
export async function sendDeletionCompleteEmail(email: string): Promise<boolean> {
	const labels = DELETION_COMPLETE_EMAIL_LABELS;
	return sendEmail({
		to: email,
		subject: `【がんばりクエスト】${labels.subject}`,
		htmlBody: wrapTemplate(html`
      <h2>${labels.heading}</h2>
      <p>${labels.intro}</p>
      <p>${labels.irreversibleNote}</p>
      <p>${labels.thanks}</p>
      <p>${labels.signupAgainNote}</p>
    `),
		textBody: [
			labels.heading,
			'',
			labels.intro,
			labels.irreversibleNote,
			labels.thanks,
			labels.signupAgainNote,
		].join('\n'),
	});
}

/** メンバー除外通知メール */
export async function sendMemberRemovedEmail(email: string, tenantName: string): Promise<boolean> {
	return sendEmail({
		to: email,
		subject: '【がんばりクエスト】家族グループからの除外通知',
		htmlBody: wrapTemplate(html`
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
		htmlBody: wrapTemplate(html`
      <h2>新しいメンバーが参加しました</h2>
      <p><strong>${memberName}</strong> さんが「${role}」として家族グループに参加しました。</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="https://ganbari-quest.com/admin/members" class="button">メンバー管理を開く</a>
      </p>
    `),
		textBody: `${memberName} さんが「${role}」として家族グループに参加しました。`,
	});
}

/**
 * オーナー権限の移譲通知メール (#4507)。
 *
 * 旧実装は `sendMemberJoinedEmail` を流用しており、新オーナーには
 * 「新しいメンバーが参加しました」という別事象の文面が届き、role には内部コード
 * `'owner'` が生のまま差し込まれていた (内部コード露出禁止、DESIGN.md §6)。
 *
 * @param roleLabel 表示用の role 名。呼び出し側が `getMemberRoleLabel()` で解決して渡す
 *                  (内部コードを本関数に渡さないことを型ではなく引数名で明示する)
 */
export async function sendOwnershipTransferredEmail(
	newOwnerEmail: string,
	memberName: string,
	roleLabel: string,
): Promise<boolean> {
	const labels = OWNERSHIP_TRANSFER_EMAIL_LABELS;
	const ctaUrl = `${getAppBaseUrl()}/admin/members`;
	return sendEmail({
		to: newOwnerEmail,
		subject: `【がんばりクエスト】${labels.subject}`,
		htmlBody: wrapTemplate(html`
      <h2>${labels.heading}</h2>
      <p>${labels.greeting(memberName)}</p>
      <p>${labels.body(roleLabel)}</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${ctaUrl}" class="button">${labels.ctaLabel}</a>
      </p>
    `),
		textBody: `${labels.greeting(memberName)}\n\n${labels.body(roleLabel)}\n\n${labels.ctaLabel}: ${ctaUrl}`,
	});
}

export interface PaymentFailedNoticeParams {
	email: string;
	/** 宛名 (オーナーの表示名。未設定時は呼び出し側がテナント名にフォールバックする) */
	ownerName: string;
	/** 表示用のご契約プラン名 */
	planLabel: string;
	/** 表示用の猶予期限 (JST 暦日) */
	graceDeadline: string;
	/** 猶予期限までの残り日数 */
	daysRemaining: number;
}

/**
 * 支払い失敗 (dunning) のお知らせメール (#4507)。
 *
 * この 7 日間の猶予中に顧客へ届く**唯一の**連絡。旧実装は期限前リマインド
 * (`sendLicenseRenewalReminderEmail`) が兼ねていたが、それは marketing 便であり
 * 配信停止済み・年 6 回上限に達した顧客には**届かない**ため、支払い失敗を一度も
 * 知らされないまま 7 日後に suspended になり得た。
 *
 * よって本メールは削除予告メールと同区分のトランザクション便として送る:
 *   - `listUnsubscribeUrl` を付けない (配信設定で止めさせない)
 *   - `marketing-email-counter` (年 6 回上限) を経由しない
 * 件名は「次回更新予定日のお知らせ」ではなく**支払い失敗の事実**を述べる。
 */
export async function sendPaymentFailedNoticeEmail(
	params: PaymentFailedNoticeParams,
): Promise<boolean> {
	const labels = PAYMENT_FAILED_EMAIL_LABELS;
	const { email, ownerName, planLabel, graceDeadline, daysRemaining } = params;
	const ctaUrl = `${getAppBaseUrl()}/admin/subscription`;

	return sendEmail({
		to: email,
		subject: `【がんばりクエスト】${labels.subject(daysRemaining)}`,
		htmlBody: wrapTemplate(html`
      <h2>${labels.heading}</h2>
      <p>${labels.greeting(ownerName)}</p>
      <p>${labels.intro}</p>
      <p>${labels.planLine(planLabel)}</p>
      <p><strong>${labels.graceLine(graceDeadline, daysRemaining)}</strong></p>
      <p>${labels.consequenceLine(PLAN_FULL_TERMS.free)}</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${ctaUrl}" class="button">${labels.ctaLabel}</a>
      </p>
      <p>${labels.transactionalNote}</p>
    `),
		textBody: [
			labels.greeting(ownerName),
			'',
			labels.intro,
			labels.planLine(planLabel),
			labels.graceLine(graceDeadline, daysRemaining),
			labels.consequenceLine(PLAN_FULL_TERMS.free),
			'',
			`${labels.ctaLabel}: ${ctaUrl}`,
			'',
			labels.transactionalNote,
		].join('\n'),
	});
}

// ============================================================
// PIN reset 確認コードメール (#3070、federated email-OTP)
// ============================================================

/**
 * #3070: federated (Google) PIN reset の email-OTP 確認コードメール。
 *
 * 共有端末で親の Google session が生きていると silent SSO で recent-login が無入力通過するため、
 * 登録メールへ 6 桁コードを送り、メールを読める本人のみが reset できるようにする。
 * 文言は `PIN_RESET_EMAIL_LABELS` (labels.ts SSOT)。Anti-engagement (ADR-0012) 整合の中立トーン。
 * code 平文はメール本文にのみ載せ、ログには残さない (呼び出し側 endpoint も同様)。
 */
export async function sendPinResetCodeEmail(email: string, code: string): Promise<boolean> {
	const labels = PIN_RESET_EMAIL_LABELS;
	return sendEmail({
		to: email,
		subject: labels.subject,
		htmlBody: wrapTemplate(html`
      <h2>${labels.heading}</h2>
      <p>${labels.intro}</p>
      <p style="text-align:center;margin:24px 0">
        <span style="display:inline-block;font-size:32px;font-weight:bold;letter-spacing:8px;color:#4f46e5">${code}</span>
      </p>
      <p>${labels.codeNote}</p>
      <p style="font-size:13px;color:#9ca3af">${labels.ignoreNote}</p>
    `),
		textBody: `${labels.heading}\n\n${labels.intro}\n\n${code}\n\n${labels.codeNote}\n${labels.ignoreNote}`,
	});
}

// ============================================================
// 週次活動レポート
// ============================================================

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
	const catRows = joinHtml(
		report.categories.map((c) => {
			const diff = c.diff > 0 ? `+${c.diff}` : c.diff === 0 ? '±0' : String(c.diff);
			const diffColor = c.diff >= 0 ? '#22c55e' : '#ef4444';
			return html`<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${c.name}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;font-weight:bold">${c.count}回</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:${diffColor}">${diff}</td></tr>`;
		}),
	);

	const achievementHtml =
		report.newAchievements.length > 0
			? html`<p style="margin-top:16px">🏆 <strong>新しい実績:</strong> ${report.newAchievements.join('、')}</p>`
			: EMPTY_HTML;

	return sendEmail({
		to: email,
		subject: `🌟 ${report.childName}の今週のがんばり（${report.dateRange}）`,
		htmlBody: wrapTemplate(html`
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

// ============================================================
// ライフサイクルメール (#1601 / ADR-0023 §3.2 §3.3 §5 I11)
// ============================================================

/**
 * 期限切れ前リマインドメール / 休眠復帰メール用の Public URL ビルダ。
 * 環境変数 `APP_BASE_URL` 優先、未設定時は本番 URL にフォールバック。
 */
function getAppBaseUrl(): string {
	return env.APP_BASE_URL ?? 'https://ganbari-quest.com';
}

function buildUnsubscribeUrl(tenantId: string, kind: UnsubscribeKind): string {
	const token = generateUnsubscribeToken({ tenantId, kind });
	return `${getAppBaseUrl()}/unsubscribe/${token}`;
}

/**
 * lifecycle 系メールの共通レイアウト。
 *
 * `wrapTemplate` (purple ヘッダ) や `wrapTrialEmailTemplate` (orange ヘッダ) と
 * 区別するため、Anti-engagement 整合の落ち着いたグレー基調にする。
 */
function wrapLifecycleTemplate(content: HtmlSafe, unsubscribeUrl: string): string {
	const labels = LIFECYCLE_EMAIL_LABELS;
	return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; color: #2d2d2d; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
  .header { background: #4a5568; padding: 20px 24px; }
  .header h1 { color: #ffffff; font-size: 18px; margin: 0; font-weight: 600; }
  .content { padding: 32px 24px; line-height: 1.7; }
  .content h2 { color: #2d3748; font-size: 18px; margin-top: 0; }
  .content p { margin: 12px 0; }
  .meta { background: #f7fafc; border-left: 4px solid #cbd5e0; padding: 12px 16px; margin: 16px 0; font-size: 14px; }
  .meta div { margin: 4px 0; }
  .button { display: inline-block; padding: 10px 20px; background: #4a5568; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; }
  .footer { padding: 16px 24px; background: #f9fafb; text-align: center; font-size: 12px; color: #718096; border-top: 1px solid #e5e7eb; }
  .footer a { color: #718096; text-decoration: underline; }
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
    <p>${labels.footerNote}</p>
    <p><a href="${unsubscribeUrl}">${labels.unsubscribeFooter}</a></p>
    <p>${labels.footerCopyright}</p>
  </div>
</div>
</body>
</html>`;
}

export interface RenewalReminderParams {
	email: string;
	tenantId: string;
	ownerName: string;
	planLabel: string;
	expiresAt: string;
	daysRemaining: number;
}

/**
 * 期限切れ前リマインドメール (一般プラン残り 30/7/1 日)。
 *
 * Anti-engagement 整合: 「今すぐ」「失効します」「お得な」等の煽り表現を含めない。
 * 「ご確認ください」「ご希望の場合は」の中立トーン。
 */
export async function sendLicenseRenewalReminderEmail(
	params: RenewalReminderParams,
): Promise<boolean> {
	const labels = LIFECYCLE_EMAIL_LABELS;
	const { email, tenantId, ownerName, planLabel, expiresAt, daysRemaining } = params;
	const unsubscribeUrl = buildUnsubscribeUrl(tenantId, 'marketing');
	const subject = labels.renewalSubject(daysRemaining);
	const ctaUrl = `${getAppBaseUrl()}/admin/subscription`;

	const htmlContent = html`
      <h2>${labels.renewalHeading}</h2>
      <p>${labels.renewalGreeting(ownerName)}</p>
      <p>${labels.renewalIntro}</p>
      <div class="meta">
        <div>${labels.renewalPlanLine(planLabel)}</div>
        <div>${labels.renewalDateLine(expiresAt, daysRemaining)}</div>
      </div>
      <p>${labels.renewalContinue}</p>
      <p>${labels.renewalGraduate}</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${ctaUrl}" class="button">${labels.renewalCtaLabel}</a>
      </p>
    `;

	const textBody = [
		labels.renewalGreeting(ownerName),
		'',
		labels.renewalIntro,
		'',
		labels.renewalPlanLine(planLabel),
		labels.renewalDateLine(expiresAt, daysRemaining),
		'',
		labels.renewalContinue,
		labels.renewalGraduate,
		'',
		`${labels.renewalCtaLabel}: ${ctaUrl}`,
		'',
		`${labels.unsubscribeFooter}: ${unsubscribeUrl}`,
	].join('\n');

	return sendEmail({
		to: email,
		subject,
		htmlBody: wrapLifecycleTemplate(htmlContent, unsubscribeUrl),
		textBody,
		listUnsubscribeUrl: unsubscribeUrl,
	});
}

export interface DormantReactivationParams {
	email: string;
	tenantId: string;
	ownerName: string;
	daysSinceLastActive: number;
}

/**
 * 休眠復帰メール (90 日以上ログインなし、1 ユーザーにつき 1 回限り)。
 *
 * Anti-engagement 整合: 卒業 = ポジティブとしてフレーミング、戻ることを強要しない。
 */
export async function sendDormantReactivationEmail(
	params: DormantReactivationParams,
): Promise<boolean> {
	const labels = LIFECYCLE_EMAIL_LABELS;
	const { email, tenantId, ownerName, daysSinceLastActive } = params;
	const unsubscribeUrl = buildUnsubscribeUrl(tenantId, 'marketing');
	const ctaUrl = `${getAppBaseUrl()}/auth/login`;

	const htmlContent = html`
      <h2>${labels.dormantHeading}</h2>
      <p>${labels.dormantGreeting(ownerName)}</p>
      <p>${labels.dormantIntro}</p>
      <p>${labels.dormantSinceLastActive(daysSinceLastActive)}</p>
      <p>${labels.dormantGraduationNote}</p>
      <p>${labels.dormantReturnNote}</p>
      <p>${labels.dormantPasswordNote}</p>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${ctaUrl}" class="button">${labels.dormantCtaLabel}</a>
      </p>
    `;

	const textBody = [
		labels.dormantGreeting(ownerName),
		'',
		labels.dormantIntro,
		labels.dormantSinceLastActive(daysSinceLastActive),
		labels.dormantGraduationNote,
		labels.dormantReturnNote,
		labels.dormantPasswordNote,
		'',
		`${labels.dormantCtaLabel}: ${ctaUrl}`,
		'',
		`${labels.unsubscribeFooter}: ${unsubscribeUrl}`,
	].join('\n');

	return sendEmail({
		to: email,
		subject: labels.dormantSubject,
		htmlBody: wrapLifecycleTemplate(htmlContent, unsubscribeUrl),
		textBody,
		listUnsubscribeUrl: unsubscribeUrl,
	});
}

// ============================================================
// PMF 判定アンケート (#1598 / ADR-0023 §3.6 §5 I7)
// ============================================================

export interface PmfSurveyEmailParams {
	email: string;
	tenantId: string;
	ownerName: string;
	round: string;
	surveyUrl: string;
}

/**
 * PMF 判定アンケート (Sean Ellis Test) メール (年 2 回・親宛)。
 *
 * Anti-engagement 整合: 「ぜひ」「お得な」等の煽り表現を含めない。
 * 「ご回答ください」の中立トーン。年 6 回上限と List-Unsubscribe を共有。
 */
export async function sendPmfSurveyEmail(params: PmfSurveyEmailParams): Promise<boolean> {
	const labels = PMF_SURVEY_LABELS;
	const lifecycleLabels = LIFECYCLE_EMAIL_LABELS;
	const { email, tenantId, ownerName, round, surveyUrl } = params;
	const unsubscribeUrl = buildUnsubscribeUrl(tenantId, 'marketing');

	const htmlContent = html`
      <h2>${labels.emailHeading}</h2>
      <p>${labels.emailGreeting(ownerName)}</p>
      <p>${labels.emailIntro}</p>
      <p>${labels.emailBody}</p>
      <div class="meta">
        <div>${labels.emailRoundLabel(round)}</div>
      </div>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${surveyUrl}" class="button">${labels.emailCtaLabel}</a>
      </p>
      <p style="font-size: 13px; color: #718096;">${labels.emailNote}</p>
    `;

	const textBody = [
		labels.emailGreeting(ownerName),
		'',
		labels.emailIntro,
		'',
		labels.emailBody,
		'',
		labels.emailRoundLabel(round),
		'',
		`${labels.emailCtaLabel}: ${surveyUrl}`,
		'',
		labels.emailNote,
		'',
		`${lifecycleLabels.unsubscribeFooter}: ${unsubscribeUrl}`,
	].join('\n');

	return sendEmail({
		to: email,
		subject: labels.emailSubject,
		htmlBody: wrapLifecycleTemplate(htmlContent, unsubscribeUrl),
		textBody,
		listUnsubscribeUrl: unsubscribeUrl,
	});
}
