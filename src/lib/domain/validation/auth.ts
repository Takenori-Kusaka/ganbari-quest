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

// --- 確認コード有効期限（UI 表示用 — #591: 2026-04-09 セキュリティ改善） ---
//
// ⚠️ 重要な制約: Cognito User Pool の SignUp verification code は AWS 側で
// 24 時間の有効期限がハードコードされており、CloudFormation / CDK から短縮できない。
// (https://docs.aws.amazon.com/cognito/latest/developerguide/signing-up-users-in-your-app.html)
//
// 本定数はあくまで「ユーザーに提示する推奨期限」であり、実際に Cognito が受理する
// 期間とは異なる。OWASP / NIST / 競合 SaaS (Google 1h, Amazon 10min, Slack 15min,
// Notion 10min) のベストプラクティスに合わせ、短期間での完了を促す目的で 15 分表示。
//
// 仮にユーザーが 15 分以上経ってからコードを入力しても、Cognito 側では 24 時間
// 有効なので依然受理される。ただしそれ以上経っていれば再送すればよく、セキュリティ
// 上の問題はない（新コードが発行されれば旧コードは実質無効）。
//
// 将来 Cognito の制約を超えて短縮したい場合は、Custom Auth Flow で独自の OTP 発行
// Lambda に差し替える必要がある（別チケットで検討）。
/** サインアップ確認コードの UI 表示用有効期限（分） */
export const SIGNUP_CODE_EXPIRY_MINUTES = 15;
/** パスワードリセット確認コードの有効期限（分） */
export const PASSWORD_RESET_CODE_EXPIRY_MINUTES = 30;

// 招待リンク関連
export const INVITE_COOKIE_NAME = 'invite_code';
export const INVITE_EXPIRY_DAYS = 7;

export const createInviteSchema = z.object({
	role: z.enum(['parent', 'child']),
	childId: z.number().optional(),
});
