// POST /api/v1/parent-gate/reset-verified — #2993 (EPIC #2990) / #3070 (federated email-OTP)
//
// cognito モードの「おやカギコードを忘れた」救済。本人確認は認証種別で分岐する:
//   - password ユーザ: **アカウントパスワードの再入力**で本人確認 (Apple Screen Time 同型、#2993、現状維持)
//   - federated (Google) ユーザ: **登録メールに送った 6 桁の確認コード (email-OTP)** で本人確認 (#3070)
// いずれも本人確認成功後その場で PIN を再作成する。
//
// 設計の核心 (Issue #2993 / #3070):
//   - cognito 認証済みセッション ≠ 親 (家庭内共有端末で親のセッションのまま子供が触る前提が
//     parent-gate の存在意義)。セッションだけで reset を許すと子供が gate を突破できる穴になる
//     ため、子供が知らない材料 (アカウントパスワード / メール確認コード) を本人確認に使う
//   - email は `locals.identity.email` (cognito identity) を使い手入力させない
//   - #3070: federated は Cognito が prompt=login を IdP に転送しないため recent-login が共有端末で
//     silent SSO 無入力通過し得る。email-OTP は子がメールを読めないため確実に塞ぐ
//   - MFA_REQUIRED は success 扱い: InitiateAuth でパスワード正解後に返る第 2 要素要求であり、
//     パスワードが正しいことは確定している (token は使わないため MFA を完遂する必要がない)
//   - local モードは対象外 (gate 無効 + 救済は operator reset #2994 が担当)

import { error, json } from '@sveltejs/kit';
import { isCognitoDevMode, requireTenantId } from '$lib/server/auth/factory';
import { authenticateDevUser } from '$lib/server/auth/providers/cognito-dev';
import { authenticateWithCognito } from '$lib/server/auth/providers/cognito-direct-auth';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { logger } from '$lib/server/logger';
import { checkRateLimit } from '$lib/server/security/rate-limiter';
import { setupPin } from '$lib/server/services/auth-service';
import {
	createParentSession,
	PARENT_SESSION_COOKIE_NAME,
} from '$lib/server/services/parent-gate-session';
import { PIN_RESET_OTP_COOKIE_NAME, verifyPinResetOtp } from '$lib/server/services/pin-reset-otp';
import type { RequestHandler } from './$types';

const PIN_PATTERN = /^\d{4,6}$/;
const OTP_PATTERN = /^\d{6}$/;
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24; // verify と同じ 24 時間 hard max (sliding は 15 分)
/** パスワード / コード brute force 防止 (Cognito 側 throttle / OTP attempts と多重) */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export const POST: RequestHandler = async ({ request, cookies, locals, getClientAddress }) => {
	const tenantId = requireTenantId(locals);

	const identity = locals.identity;
	if (!identity || identity.type !== 'cognito') {
		// local / anonymous は対象外 (local の救済は operator reset #2994)
		return json({ ok: false, error: 'NOT_SUPPORTED' }, { status: 400 });
	}

	const limit = checkRateLimit(
		`parent-gate-reset-verified:${getClientAddress()}`,
		RATE_LIMIT_MAX,
		RATE_LIMIT_WINDOW_MS,
	);
	if (!limit.allowed) {
		return json({ ok: false, error: 'RATE_LIMITED' }, { status: 429 });
	}

	let password: string;
	let newPin: string;
	let code: string;
	try {
		const body = await request.json();
		password = typeof body?.password === 'string' ? body.password : '';
		newPin = typeof body?.newPin === 'string' ? body.newPin : '';
		code = typeof body?.code === 'string' ? body.code : '';
	} catch {
		error(400, 'INVALID_BODY');
	}

	if (!newPin || !PIN_PATTERN.test(newPin)) {
		return json({ ok: false, error: 'PIN_FORMAT' }, { status: 400 });
	}

	const verifyError = identity.isFederated
		? verifyFederatedOtp(code, cookies, tenantId)
		: await verifyAccountPassword(identity.email, password, tenantId);
	if (verifyError) {
		return verifyError;
	}

	await setupPin(newPin, tenantId);
	logger.info('[PARENT_GATE] PIN reset via re-auth', {
		context: {
			tenantIdPrefix: tenantId.slice(0, 12),
			method: identity.isFederated ? 'email-otp' : 'password',
		},
	});

	// 再作成した本人をそのまま親画面へ通す (verify / setup と同じ session 発行)
	const sessionValue = createParentSession(tenantId);
	cookies.set(PARENT_SESSION_COOKIE_NAME, sessionValue, {
		path: '/',
		httpOnly: true,
		secure: COOKIE_SECURE,
		sameSite: 'lax',
		maxAge: COOKIE_MAX_AGE_SEC,
	});

	return json({ ok: true });
};

/**
 * #3070: federated (Google 等) ユーザの本人確認 — 登録メールに送った 6 桁 OTP を検証。
 * `reset-request-code` が署名 cookie (pin_reset_otp) に格納した codeHash / expiresAt / attempts /
 * tenantId と照合する (DB 非保存の stateless 方式)。検証成功時は consume-once で cookie を clear する。
 * federated は Cognito パスワードを持たないため、共有端末で silent SSO 無入力通過し得る
 * recent-login の代わりに、子がアクセスできない email を確認材料に使う。
 * @returns 検証 NG なら error Response、OK なら null (呼び出し側が setupPin する)
 */
function verifyFederatedOtp(
	code: string,
	cookies: Parameters<RequestHandler>[0]['cookies'],
	tenantId: string,
): Response | null {
	if (!code || !OTP_PATTERN.test(code)) {
		return json({ ok: false, error: 'CODE_REQUIRED' }, { status: 401 });
	}

	const cookie = cookies.get(PIN_RESET_OTP_COOKIE_NAME);
	const result = verifyPinResetOtp(cookie, code, tenantId);

	if (result.ok) {
		// consume-once: 検証成功した OTP cookie は即 clear (同 code の二度目を不可にする)
		cookies.delete(PIN_RESET_OTP_COOKIE_NAME, { path: '/' });
		return null;
	}

	// 失敗: 残試行を継続する場合 (nextCookie) は再 set、それ以外 (上限 / 失効 / 改竄) は clear
	if (result.nextCookie) {
		cookies.set(PIN_RESET_OTP_COOKIE_NAME, result.nextCookie, {
			path: '/',
			httpOnly: true,
			secure: COOKIE_SECURE,
			sameSite: 'lax',
			maxAge: COOKIE_MAX_AGE_SEC,
		});
	} else {
		cookies.delete(PIN_RESET_OTP_COOKIE_NAME, { path: '/' });
	}

	logger.info('[PARENT_GATE] reset-verified: federated OTP verify failed (#3070)', {
		context: { tenantIdPrefix: tenantId.slice(0, 12), reason: result.reason },
	});
	return json({ ok: false, error: result.reason }, { status: 401 });
}

/**
 * password ユーザの本人確認 — アカウントパスワード re-auth (email はセッション既知、手入力なし)。
 * @returns 検証 NG なら error Response、OK なら null
 */
async function verifyAccountPassword(
	email: string,
	password: string,
	tenantId: string,
): Promise<Response | null> {
	if (!password) {
		return json({ ok: false, error: 'PASSWORD_REQUIRED' }, { status: 400 });
	}

	let passwordValid = false;
	if (isCognitoDevMode()) {
		passwordValid = authenticateDevUser(email, password) !== null;
	} else {
		const result = await authenticateWithCognito(email, password);
		// success | MFA_REQUIRED = パスワード正解 (MFA は第 2 要素であり password 検証は通過済)
		passwordValid = result.success || result.error === 'MFA_REQUIRED';
	}

	if (!passwordValid) {
		logger.warn('[PARENT_GATE] reset-verified: password re-auth failed', {
			context: { tenantIdPrefix: tenantId.slice(0, 12) },
		});
		return json({ ok: false, error: 'INVALID_PASSWORD' }, { status: 401 });
	}
	return null;
}
