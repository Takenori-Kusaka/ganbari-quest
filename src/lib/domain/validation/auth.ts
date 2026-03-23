import { z } from 'zod';

// Cookie名
export const IDENTITY_COOKIE_NAME = 'identity_token';
export const CONTEXT_COOKIE_NAME = 'context_token';

// --- 後方互換: PIN認証関連（#0134で段階的に削除予定） ---
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15分
export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1年
export const SESSION_REFRESH_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 残り30日未満でリフレッシュ
export const SESSION_COOKIE_NAME = 'sessionToken';

// Zodスキーマ（PIN認証用 — 後方互換）
export const pinSchema = z
	.string()
	.min(PIN_MIN_LENGTH, `PINは${PIN_MIN_LENGTH}桁以上です`)
	.max(PIN_MAX_LENGTH, `PINは${PIN_MAX_LENGTH}桁以下です`)
	.regex(/^\d+$/, 'PINは数字のみです');

export const loginSchema = z.object({
	pin: pinSchema,
});

// Cognito Email/Password認証用スキーマ
export const emailLoginSchema = z.object({
	email: z.string().email('有効なメールアドレスを入力してください'),
	password: z.string().min(8, 'パスワードは8文字以上です'),
});

export const signupSchema = z.object({
	email: z.string().email('有効なメールアドレスを入力してください'),
	password: z.string().min(8, 'パスワードは8文字以上です'),
	licenseKey: z
		.string()
		.regex(/^GQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'ライセンスキーの形式が不正です'),
});
