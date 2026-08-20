import { z } from 'zod';
import { MS_PER_DAY, MS_PER_MINUTE, SECONDS_PER_DAY } from '$lib/domain/constants/time';
import { childIdSchema } from './id-schema';

// Cookie名
export const IDENTITY_COOKIE_NAME = 'identity_token';
export const CONTEXT_COOKIE_NAME = 'context_token';

// --- PIN認証関連（ADR-0050 で能動利用中。詳細: docs/operations/pin-auth-legacy-migration-plan.md） ---
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * MS_PER_MINUTE;
export const SESSION_MAX_AGE_SECONDS = 365 * SECONDS_PER_DAY;
export const SESSION_REFRESH_THRESHOLD_MS = 30 * MS_PER_DAY;
export const SESSION_COOKIE_NAME = 'sessionToken';

// Zodスキーマ（おやカギコード認証用）
export const pinSchema = z
	.string()
	.min(PIN_MIN_LENGTH, `おやカギコードは${PIN_MIN_LENGTH}桁以上です`)
	.max(PIN_MAX_LENGTH, `おやカギコードは${PIN_MAX_LENGTH}桁以下です`)
	.regex(/^\d+$/, 'おやカギコードは数字のみです');

export const loginSchema = z.object({
	pin: pinSchema,
});

// Cognito Email/Password認証用スキーマ
export const emailLoginSchema = z.object({
	email: z.string().email('有効なメールアドレスを入力してください'),
	password: z.string().min(8, 'パスワードは8文字以上です'),
});

// Epic #2525 Phase 7 PR-L5 (#2860): license key 全廃 contract。signup の licenseKey 入力欄 +
// 形式 regex は PR-L1 (#2812) で入力経路撤去済、本 PR で schema からも撤去 (entitlement は
// Stripe Subscription = tenant.status が唯一 SSOT)。
export const signupSchema = z.object({
	email: z.string().email('有効なメールアドレスを入力してください'),
	password: z.string().min(8, 'パスワードは8文字以上です'),
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

// Cognito Refresh Token Cookie (#1365)
export const REFRESH_COOKIE_NAME = 'gq_refresh';

// 招待リンク関連
export const INVITE_COOKIE_NAME = 'invite_code';
export const INVITE_EXPIRY_DAYS = 7;
/**
 * 招待受諾が拒否された理由コード (#3555 ① / #4704)。
 *
 * 受諾に失敗すると **新規テナントが自動作成される** ため、理由を伝えないと顧客は
 * 「なぜか知らない空の家族グループの owner になっている」dead-end に着地する。
 * 本 union を SSOT にして「理由が増えたのに案内が無い」状態を型で塞ぐ:
 * `AUTH_INVITE_LABELS.acceptErrorBanners` が `Record<InviteAcceptErrorCode, string>` なので、
 * 新しい理由を足すと **案内文を書くまでコンパイルが通らない**。
 * (#4704 で `MEMBER_LIMIT_REACHED` を足したとき、旧実装の 2 件 allowlist は素通りさせていた)
 */
export const INVITE_ACCEPT_ERROR_CODES = [
	'INVALID_OR_EXPIRED',
	'ALREADY_IN_TENANT',
	'INVITE_EMAIL_MISMATCH',
	'INVITE_EMAIL_UNVERIFIED',
	'MEMBER_LIMIT_REACHED',
] as const;

export type InviteAcceptErrorCode = (typeof INVITE_ACCEPT_ERROR_CODES)[number];

export function isInviteAcceptErrorCode(value: unknown): value is InviteAcceptErrorCode {
	return (INVITE_ACCEPT_ERROR_CODES as readonly unknown[]).includes(value);
}

/**
 * #3555 ①: 招待受諾の拒否理由を受諾後の画面 (admin layout) に伝える 1 回限りの通知 cookie。
 * 値は {@link InviteAcceptErrorCode}。
 */
export const INVITE_ACCEPT_ERROR_COOKIE_NAME = 'invite_accept_error';
export const INVITE_ACCEPT_ERROR_MAX_AGE_SECONDS = 10 * 60;

export const createInviteSchema = z.object({
	role: z.enum(['parent', 'child']),
	childId: childIdSchema.optional(),
	// #3549 判断2: 宛先 email (任意)。設定時は受諾者 email 束縛 (§6.6)。空文字は未設定扱い
	email: z
		.string()
		.trim()
		.email('有効なメールアドレスを入力してください')
		.optional()
		.or(z.literal('').transform(() => undefined)),
});
