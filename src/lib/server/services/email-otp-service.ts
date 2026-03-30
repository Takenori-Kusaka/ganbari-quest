// src/lib/server/services/email-otp-service.ts
// アプリ層でのEmail OTP（ワンタイムパスワード）サービス
// Cognito認証成功後、追加の二段階認証としてメールOTPを検証する

import { randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logger';
import { sendEmail } from '$lib/server/services/email-service';

// メモリ内OTPストア（Lambda/サーバーレス環境ではDynamoDBに移行すべきだが、
// セッション cookie のライフタイムが短く、Lambda warm instance で十分）
const otpStore = new Map<string, { code: string; expiresAt: number; email: string }>();

const OTP_TTL_MS = 3 * 60 * 1000; // 3分

// E2Eテスト・開発用のOTP除外メールリスト
function getExemptEmails(): string[] {
	return (env.MFA_EXEMPT_EMAILS ?? '').split(',').filter(Boolean);
}

/** Email OTPが必要かどうか判定 */
export function isEmailOtpRequired(email: string): boolean {
	// ローカルモード（PIN認証）ではEmail OTP不要
	if (env.AUTH_MODE === 'local') return false;

	// テスト用アカウントはOTP不要
	if (getExemptEmails().includes(email)) return false;

	return true;
}

/** OTPを生成してメール送信。セッションキーを返す */
export async function sendEmailOtp(email: string): Promise<string> {
	// 6桁の数値OTPを生成（暗号学的乱数）
	const code = String((Number.parseInt(randomBytes(4).toString('hex'), 16) % 900000) + 100000);

	// セッションキー（OTP検証時に使用）
	const sessionKey = randomBytes(32).toString('hex');

	// ストアに保存
	otpStore.set(sessionKey, {
		code,
		expiresAt: Date.now() + OTP_TTL_MS,
		email,
	});

	// 古いエントリを定期的にクリーンアップ
	cleanupExpiredOtps();

	// メール送信
	const maskedEmail = email.replace(/(.{2}).*(@.*)/, '$1***$2');
	logger.info('[EMAIL_OTP] Sending OTP', { context: { to: maskedEmail } });

	const htmlBody = buildOtpEmailHtml(code);

	await sendEmail({
		to: email,
		subject: 'がんばりクエスト — ログイン確認コード',
		htmlBody,
		textBody: `がんばりクエスト ログイン確認コード: ${code}\n\nこのコードは3分間有効です。`,
	});

	return sessionKey;
}

/** OTPを検証する */
export function verifyEmailOtp(
	sessionKey: string,
	inputCode: string,
): { valid: boolean; email?: string } {
	const entry = otpStore.get(sessionKey);

	if (!entry) {
		logger.warn('[EMAIL_OTP] Session not found');
		return { valid: false };
	}

	if (Date.now() > entry.expiresAt) {
		otpStore.delete(sessionKey);
		logger.warn('[EMAIL_OTP] OTP expired');
		return { valid: false };
	}

	if (entry.code !== inputCode) {
		logger.warn('[EMAIL_OTP] Invalid code');
		return { valid: false };
	}

	// 検証成功 — 使い捨て
	otpStore.delete(sessionKey);
	logger.info('[EMAIL_OTP] OTP verified successfully');
	return { valid: true, email: entry.email };
}

/** マスクされたメールアドレスを取得 */
export function getMaskedEmail(email: string): string {
	return email.replace(/(.{2}).*(@.*)/, '$1***$2');
}

function cleanupExpiredOtps() {
	const now = Date.now();
	for (const [key, entry] of otpStore) {
		if (now > entry.expiresAt) {
			otpStore.delete(key);
		}
	}
}

function buildOtpEmailHtml(code: string): string {
	const header =
		'<div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;text-align:center"><h1 style="color:#fff;font-size:20px;margin:0">がんばりクエスト</h1></div>';
	const footer =
		'<div style="padding:16px 24px;background:#f9fafb;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb"><p>このメールは「がんばりクエスト」から自動送信されています。</p></div>';

	return [
		'<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>',
		'<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5">',
		'<div style="max-width:600px;margin:0 auto;background:#fff">',
		header,
		'<div style="padding:32px 24px;color:#333;line-height:1.7">',
		'<h2 style="color:#4f46e5;font-size:18px;margin-top:0">ログイン確認コード</h2>',
		'<p>以下の確認コードを入力してログインを完了してください:</p>',
		'<div style="text-align:center;margin:24px 0">',
		`<span style="display:inline-block;padding:16px 32px;background:#f0f0ff;border:2px solid #6366f1;border-radius:8px;font-size:28px;font-weight:bold;letter-spacing:8px;color:#4f46e5">${code}</span>`,
		'</div>',
		'<p style="font-size:14px;color:#666">このコードは3分間有効です。身に覚えのない場合は、このメールを無視してください。</p>',
		'</div>',
		footer,
		'</div></body></html>',
	].join('');
}
