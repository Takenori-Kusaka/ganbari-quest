// src/lib/server/services/pin-reset-otp.ts
// #3070: federated (Google) PIN reset の email-OTP 本人確認 (署名 cookie stateless 方式)
//
// 設計の核心 (Issue #3070):
//   - Cognito は prompt=login を IdP(Google) に転送しないため、共有端末で親の Google session が
//     生きていると silent SSO で auth_time が refresh され、recent-login(5分) チェックを子が
//     無入力で通過し PIN reset を完遂できる (実在の穴、ADR-0050 の speed bump 以下)。
//   - そこで federated は identity.email へ 6 桁 OTP を送り、メールを読める本人のみが reset 可能にする。
//     子はメールを読めないため確実に塞がる。
//   - OTP は DB に保存しない: code ハッシュ + 失効時刻 + tenantId + attempts を
//     cookie-signature 署名 httpOnly cookie に格納する stateless 方式 (Lambda 安全 + schema 変更なし)。
//   - cookie には code 平文を入れず、sha256(code + tenantId + secret) ハッシュのみ格納する。
//     検証は timing-safe 比較。署名検証失敗・改竄は即拒否 (expiry/attempts は署名ペイロード内)。

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import cookieSignature from 'cookie-signature';
import { getParentGateCookieSecret } from './parent-gate-session';

/** OTP cookie 名 (#3070 SSOT) */
export const PIN_RESET_OTP_COOKIE_NAME = 'pin_reset_otp';

/** OTP 桁数 */
export const PIN_RESET_OTP_LENGTH = 6;

/** OTP 失効 (10 分) */
export const PIN_RESET_OTP_TTL_MS = 10 * 60 * 1000;

/** cookie maxAge (秒)。TTL と一致 */
export const PIN_RESET_OTP_COOKIE_MAX_AGE_SEC = PIN_RESET_OTP_TTL_MS / 1000;

/** 試行上限 (超過で cookie 失効) */
export const PIN_RESET_OTP_MAX_ATTEMPTS = 5;

/** 署名 cookie ペイロード schema */
export interface PinResetOtpPayload {
	/** sha256(code + tenantId + secret) hex。code 平文は保持しない */
	codeHash: string;
	/** 失効時刻 (unix ms) */
	expiresAt: number;
	/** テナント整合性チェック用 (session 由来) */
	tenantId: string;
	/** 検証失敗回数 */
	attempts: number;
}

/** OTP 検証結果 */
export type PinResetOtpVerifyResult =
	| { ok: true }
	| {
			ok: false;
			/** UI / API が出し分けする失敗理由 */
			reason: 'CODE_REQUIRED' | 'INVALID_CODE' | 'CODE_EXPIRED' | 'TOO_MANY_ATTEMPTS';
			/** INVALID_CODE 時、attempts を +1 した再 sign 済 cookie 値 (上限未満時のみ)。
			 *  null = cookie を clear すべき (上限到達 / 失効 / 不正) */
			nextCookie: string | null;
	  };

/** 6 桁 OTP を crypto 安全乱数で生成 (ゼロ埋め) */
export function generatePinResetOtpCode(): string {
	// randomInt は [0, max) の一様分布。10^6 で 000000-999999 を均等生成
	const n = randomInt(0, 10 ** PIN_RESET_OTP_LENGTH);
	return String(n).padStart(PIN_RESET_OTP_LENGTH, '0');
}

/** code ハッシュ算出 (cookie に格納するのはこの hex のみ、平文は保持しない) */
function hashCode(code: string, tenantId: string): string {
	return createHash('sha256')
		.update(`${code}:${tenantId}:${getParentGateCookieSecret()}`)
		.digest('hex');
}

/** timing-safe な hex 文字列比較 (長さ不一致は false) */
function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	try {
		return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
	} catch {
		return false;
	}
}

/** payload を JSON → base64 → cookie-signature.sign */
function signPayload(payload: PinResetOtpPayload): string {
	const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
	return cookieSignature.sign(encoded, getParentGateCookieSecret());
}

/** cookie を unsign + parse (署名不正 / JSON 不正 / schema 不正は null) */
function parseSignedPayload(cookie: string | undefined): PinResetOtpPayload | null {
	if (!cookie) return null;
	const unsigned = cookieSignature.unsign(cookie, getParentGateCookieSecret());
	if (unsigned === false) return null;
	try {
		const decoded = Buffer.from(unsigned, 'base64').toString('utf8');
		const obj = JSON.parse(decoded);
		if (
			typeof obj !== 'object' ||
			obj === null ||
			typeof obj.codeHash !== 'string' ||
			typeof obj.expiresAt !== 'number' ||
			typeof obj.tenantId !== 'string' ||
			typeof obj.attempts !== 'number'
		) {
			return null;
		}
		return obj as PinResetOtpPayload;
	} catch {
		return null;
	}
}

/**
 * 新規 OTP を発行: code を生成し、ハッシュ + 失効時刻 + tenantId + attempts=0 を署名 cookie 値にする。
 *
 * @returns 平文 code (メール送信用) と署名済 cookie 値。code はメールにのみ載せ、cookie には載らない
 */
export function issuePinResetOtp(tenantId: string): { code: string; cookieValue: string } {
	const code = generatePinResetOtpCode();
	const payload: PinResetOtpPayload = {
		codeHash: hashCode(code, tenantId),
		expiresAt: Date.now() + PIN_RESET_OTP_TTL_MS,
		tenantId,
		attempts: 0,
	};
	return { code, cookieValue: signPayload(payload) };
}

/**
 * OTP 検証: 署名 / 失効 / tenant 整合 / 試行上限 / ハッシュ一致 (timing-safe) を確認。
 *
 * 検証順 (Issue #3070):
 *   ① cookie 不在 → CODE_REQUIRED (先に request-code を呼ぶ誘導)
 *   ② 署名不正 / parse 不正 → INVALID_CODE + cookie clear (改竄拒否)
 *   ③ tenant 不一致 → INVALID_CODE + cookie clear (テナント跨ぎ拒否、IDOR 防止)
 *   ④ 失効 → CODE_EXPIRED + cookie clear
 *   ⑤ 試行上限到達 → TOO_MANY_ATTEMPTS + cookie clear
 *   ⑥ ハッシュ不一致 → INVALID_CODE。attempts+1 で再 sign (上限未満) / 上限到達なら clear
 *   ⑦ 一致 → ok (呼び出し側が consume-once で cookie clear)
 *
 * @param cookie OTP cookie 値
 * @param code   ユーザー入力 code (6 桁)
 * @param tenantId 現在のテナント ID (session 由来、cookie の tenantId と一致必須)
 */
export function verifyPinResetOtp(
	cookie: string | undefined,
	code: string,
	tenantId: string,
): PinResetOtpVerifyResult {
	if (!cookie) {
		return { ok: false, reason: 'CODE_REQUIRED', nextCookie: null };
	}

	const payload = parseSignedPayload(cookie);
	if (!payload) {
		// 署名不正 / 改竄 → 即拒否 + clear
		return { ok: false, reason: 'INVALID_CODE', nextCookie: null };
	}

	// テナント跨ぎ拒否 (cookie の tenantId と session の tenantId 不一致)
	if (payload.tenantId !== tenantId) {
		return { ok: false, reason: 'INVALID_CODE', nextCookie: null };
	}

	if (Date.now() > payload.expiresAt) {
		return { ok: false, reason: 'CODE_EXPIRED', nextCookie: null };
	}

	if (payload.attempts >= PIN_RESET_OTP_MAX_ATTEMPTS) {
		return { ok: false, reason: 'TOO_MANY_ATTEMPTS', nextCookie: null };
	}

	const inputHash = hashCode(code, tenantId);
	if (timingSafeEqualHex(inputHash, payload.codeHash)) {
		return { ok: true };
	}

	// 不一致: attempts を +1。上限到達なら cookie clear、未満なら再 sign して残試行を継続
	const nextAttempts = payload.attempts + 1;
	if (nextAttempts >= PIN_RESET_OTP_MAX_ATTEMPTS) {
		return { ok: false, reason: 'TOO_MANY_ATTEMPTS', nextCookie: null };
	}
	const nextCookie = signPayload({ ...payload, attempts: nextAttempts });
	return { ok: false, reason: 'INVALID_CODE', nextCookie };
}
