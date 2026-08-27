import { z } from 'zod';
import { PIN_LENGTH } from '$lib/domain/constants/oyakagi';
import { MS_PER_DAY, MS_PER_MINUTE, SECONDS_PER_DAY } from '$lib/domain/constants/time';
import { OYAKAGI_TERMS } from '$lib/domain/terms';
import { childIdSchema } from './id-schema';

// Cookie名
export const IDENTITY_COOKIE_NAME = 'identity_token';
export const CONTEXT_COOKIE_NAME = 'context_token';

// --- PIN認証関連（ADR-0050 で能動利用中。詳細: docs/operations/pin-auth-legacy-migration-plan.md） ---
// #4661: 桁数の SSOT は constants/oyakagi.ts の PIN_LENGTH。以前ここだけが 4〜6 桁を許容し、
// `/switch` の parent-gate (PinInput、ちょうど 4 桁) と食い違っていた。
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * MS_PER_MINUTE;
export const SESSION_MAX_AGE_SECONDS = 365 * SECONDS_PER_DAY;
export const SESSION_REFRESH_THRESHOLD_MS = 30 * MS_PER_DAY;
export const SESSION_COOKIE_NAME = 'sessionToken';

// Zodスキーマ（おやカギコード認証用）
export const pinSchema = z
	.string()
	.length(PIN_LENGTH, `${OYAKAGI_TERMS.name}は${OYAKAGI_TERMS.digitRange}です`)
	.regex(/^\d+$/, `${OYAKAGI_TERMS.name}は数字のみです`);

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
 * 招待コード cookie の寿命 = 招待そのものの有効期限 (#4636)。
 *
 * 旧実装は 10 分だった。リンクを踏んでからメール確認コードを入れてサインアップを終えるまでに
 * 10 分以上かかる (メール到着待ち / 子供の世話で中断) のは普通に起きるため、cookie だけが先に
 * 消えて「招待を踏んだのに招待なしの初回ログイン」に化け、新規家族グループが作られていた
 * (#4636 PO 追記で特定された主要な発生源)。招待自体の期限を超えて有効にはならないため、
 * 期限切れ招待が cookie 経由で復活することはない (`getInvite` が expired を弾く)。
 */
export const INVITE_COOKIE_MAX_AGE_SECONDS = INVITE_EXPIRY_DAYS * SECONDS_PER_DAY;

/**
 * 招待受諾が拒否された理由の SSOT (#3555 ① / #4633 AC-A / #4636)。
 * `acceptInvite` (invite-service.ts) が返す error 文字列と 1:1 で対応する。
 * 新しい拒否理由を追加したら、本配列と `INVITE_JOIN_BLOCKED_MESSAGES` (labels.ts) を同時に足す。
 *
 * #4636: 理由の伝達手段は 1 回限りの通知 cookie ではなく `/auth/join` 画面になった
 * (cookie の TTL が切れると理由が永久に失われる / 一度表示したら二度と出ない、という
 * 「理由が cookie の寿命に依存する」構造を廃止した)。画面は招待 cookie から理由を
 * その都度再導出するため、リロードでもブックマークからの再訪でも同じ理由が出る。
 */
export const INVITE_ACCEPT_ERROR_REASONS = [
	'INVITE_EMAIL_MISMATCH',
	'INVITE_EMAIL_UNVERIFIED',
	'INVALID_OR_EXPIRED',
	'TENANT_NOT_FOUND',
	'ALREADY_IN_TENANT',
	'SELF_INVITE_NOT_ALLOWED',
	'OWNER_CANNOT_BE_DOWNGRADED',
	// #4723 / #4704: 受諾するとプランのメンバー上限を超える。次アクション
	// (プラン変更 / 未使用の招待を取り消す) は理由固有なので専用文言を持たせる。
	'MEMBER_LIMIT_REACHED',
] as const;

export type InviteAcceptErrorReason = (typeof INVITE_ACCEPT_ERROR_REASONS)[number];

/**
 * 値が既知の拒否理由かを判定する。未知の値 (将来の理由 / 想定外) は
 * 呼び出し側で汎用文言にフォールバックさせる。
 */
export function isInviteAcceptErrorReason(
	value: string | undefined,
): value is InviteAcceptErrorReason {
	return value !== undefined && (INVITE_ACCEPT_ERROR_REASONS as readonly string[]).includes(value);
}

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
