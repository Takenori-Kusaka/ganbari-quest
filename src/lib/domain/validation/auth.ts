import { z } from 'zod';

// ドメイン定数
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15分
export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1年
export const SESSION_REFRESH_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 残り30日未満でリフレッシュ
export const SESSION_COOKIE_NAME = 'sessionToken';
export const IDENTITY_COOKIE_NAME = 'identity_token';
export const CONTEXT_COOKIE_NAME = 'context_token';
export const DEVICE_COOKIE_NAME = 'device_token';

// Zodスキーマ
export const pinSchema = z
	.string()
	.min(PIN_MIN_LENGTH, `PINは${PIN_MIN_LENGTH}桁以上です`)
	.max(PIN_MAX_LENGTH, `PINは${PIN_MAX_LENGTH}桁以下です`)
	.regex(/^\d+$/, 'PINは数字のみです');

export const loginSchema = z.object({
	pin: pinSchema,
});
