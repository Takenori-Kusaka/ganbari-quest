/**
 * SES メール受信処理 Lambda
 * support@ganbari-quest.com 宛のメールを処理:
 * 1. スパム/ウイルス判定を確認
 * 2. Discord Webhook に通知
 * 3. 送信者に自動応答メール送信
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

interface SESEventRecord {
	ses: {
		mail: {
			messageId: string;
			source: string;
			commonHeaders: {
				from: string[];
				to: string[];
				subject: string;
				date: string;
			};
		};
		receipt: {
			spamVerdict: { status: string };
			virusVerdict: { status: string };
			action: { objectKey: string; bucketName: string };
		};
	};
}

interface SESEvent {
	Records: SESEventRecord[];
}

export async function handler(event: SESEvent): Promise<void> {
	for (const record of event.Records) {
		const { mail, receipt } = record.ses;

		// スパム・ウイルスチェック
		if (
			receipt.spamVerdict.status === 'FAIL' ||
			receipt.virusVerdict.status === 'FAIL'
		) {
			console.log('Spam/virus detected, skipping:', mail.messageId);
			continue;
		}

		const from = mail.commonHeaders.from?.[0] ?? mail.source;
		const subject = mail.commonHeaders.subject ?? '(件名なし)';
		const date = mail.commonHeaders.date ?? new Date().toISOString();
		const s3Key = receipt.action.objectKey;
		const bucketName = receipt.action.bucketName;

		// S3 からメール本文を取得
		let bodyText = '';
		try {
			const obj = await s3.send(
				new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
			);
			const raw = (await obj.Body?.transformToString()) ?? '';
			bodyText = extractPlainText(raw);
		} catch (e) {
			console.error('Failed to read email from S3:', e);
			bodyText = '(本文の取得に失敗しました)';
		}

		// Discord に通知
		await notifyDiscord({ from, subject, date, bodyText, messageId: mail.messageId, s3Key });

		// 自動応答
		await sendAutoReply({ from: mail.source, subject });
	}
}

/** RFC 2822 メール本文からプレーンテキストを抽出する簡易パーサー */
function extractPlainText(raw: string): string {
	// ヘッダーと本文の境界（空行）
	const headerEnd = raw.indexOf('\r\n\r\n');
	if (headerEnd === -1) {
		const altEnd = raw.indexOf('\n\n');
		if (altEnd === -1) return raw.slice(0, 2000);
		return raw.slice(altEnd + 2, altEnd + 2002);
	}
	const body = raw.slice(headerEnd + 4);

	// multipart の場合は text/plain パートを探す
	const contentType = raw.slice(0, headerEnd).match(/Content-Type:\s*([^\r\n]+)/i)?.[1] ?? '';
	if (contentType.includes('multipart')) {
		const boundaryMatch = contentType.match(/boundary="?([^"\r\n;]+)"?/);
		if (boundaryMatch) {
			const boundary = boundaryMatch[1];
			const parts = body.split(`--${boundary}`);
			for (const part of parts) {
				if (part.toLowerCase().includes('content-type: text/plain')) {
					const partBody = part.indexOf('\r\n\r\n');
					if (partBody !== -1) {
						return decodeBody(part.slice(partBody + 4)).slice(0, 2000);
					}
				}
			}
		}
	}

	return decodeBody(body).slice(0, 2000);
}

/** Base64 / quoted-printable デコード */
function decodeBody(text: string): string {
	// quoted-printable デコード（簡易）
	const decoded = text
		.replace(/=\r?\n/g, '')
		.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
			String.fromCharCode(Number.parseInt(hex, 16)),
		);
	// Base64 の場合（全行が Base64 文字のみなら）
	if (/^[A-Za-z0-9+/=\r\n]+$/.test(decoded.trim())) {
		try {
			return Buffer.from(decoded.replace(/[\r\n]/g, ''), 'base64').toString('utf-8');
		} catch {
			// Base64 デコード失敗 → そのまま返す
		}
	}
	return decoded;
}

/** Discord Webhook 通知 */
async function notifyDiscord(params: {
	from: string;
	subject: string;
	date: string;
	bodyText: string;
	messageId: string;
	s3Key: string;
}): Promise<void> {
	const webhookUrl = process.env.DISCORD_WEBHOOK_SUPPORT;
	if (!webhookUrl) {
		console.log('DISCORD_WEBHOOK_SUPPORT not set, skipping notification');
		return;
	}

	const embed = {
		title: 'サポートメール受信',
		description:
			params.bodyText.length > 1900
				? `${params.bodyText.slice(0, 1900)}...`
				: params.bodyText || '(本文なし)',
		color: 0x3878b8, // Brand Blue
		fields: [
			{ name: '送信者', value: params.from, inline: true },
			{
				name: '件名',
				value: params.subject || '(件名なし)',
				inline: true,
			},
			{ name: '受信日時', value: params.date, inline: true },
			{
				name: 'S3 Key',
				value: `\`${params.s3Key}\``,
				inline: false,
			},
		],
		timestamp: new Date().toISOString(),
	};

	try {
		const resp = await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ embeds: [embed] }),
		});
		if (!resp.ok) {
			console.error('Discord webhook failed:', resp.status, await resp.text());
		}
	} catch (e) {
		console.error('Discord webhook error:', e);
	}
}

/** 自動応答メール送信 */
async function sendAutoReply(params: {
	from: string;
	subject: string;
}): Promise<void> {
	const supportEmail =
		process.env.SUPPORT_EMAIL ?? 'support@ganbari-quest.com';

	// 自動応答ループ防止
	if (isAutoReply(params.subject) || isNoReplyAddress(params.from)) {
		console.log('Auto-reply/no-reply detected, skipping:', params.from);
		return;
	}

	const textBody = `お問い合わせありがとうございます。

以下の内容でお問い合わせを受け付けました:
  件名: ${params.subject}

内容を確認のうえ、${supportEmail} よりご返信いたします。

※ 通常1〜3営業日以内にご返信いたします。
※ このメールは自動送信されています。

─────────────────────────────
がんばりクエスト サポート
https://www.ganbari-quest.com
─────────────────────────────`;

	const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;color:#334155;line-height:1.6">
<h2 style="color:#3878B8">お問い合わせを受け付けました</h2>
<p>お問い合わせありがとうございます。</p>
<p>以下の内容でお問い合わせを受け付けました:</p>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0">
<strong>件名:</strong> ${escapeHtml(params.subject)}
</div>
<p>内容を確認のうえ、<strong>${supportEmail}</strong> よりご返信いたします。</p>
<p style="color:#64748b;font-size:0.9em">※ 通常1〜3営業日以内にご返信いたします。<br>※ このメールは自動送信されています。</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
<p style="color:#94a3b8;font-size:0.85em">がんばりクエスト サポート<br><a href="https://www.ganbari-quest.com" style="color:#3878B8">https://www.ganbari-quest.com</a></p>
</body></html>`;

	try {
		await ses.send(
			new SendEmailCommand({
				Source: `がんばりクエスト サポート <${supportEmail}>`,
				Destination: { ToAddresses: [params.from] },
				Message: {
					Subject: {
						Data: '【がんばりクエスト】お問い合わせを受け付けました',
						Charset: 'UTF-8',
					},
					Body: {
						Html: { Data: htmlBody, Charset: 'UTF-8' },
						Text: { Data: textBody, Charset: 'UTF-8' },
					},
				},
			}),
		);
		console.log('Auto-reply sent to:', params.from);
	} catch (e) {
		console.error('Failed to send auto-reply:', e);
	}
}

function isAutoReply(subject: string): boolean {
	const lower = subject.toLowerCase();
	return [
		'auto-reply',
		'autoreply',
		'auto-response',
		'out of office',
		'automatic reply',
		'不在',
		'自動応答',
		'お問い合わせを受け付けました', // 自身の自動応答への返信防止
	].some((ind) => lower.includes(ind));
}

function isNoReplyAddress(from: string): boolean {
	const lower = from.toLowerCase();
	return (
		lower.includes('noreply') ||
		lower.includes('no-reply') ||
		lower.includes('mailer-daemon') ||
		lower.includes('postmaster')
	);
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
