// POST /api/v1/parent-gate/reset-request-code — #3070 (federated email-OTP)
//
// federated (Google) ユーザの PIN reset 本人確認用に、登録メール (locals.identity.email) へ
// 6 桁の確認コードを送る。コードは DB に保存せず、ハッシュ + 失効時刻 + tenantId + attempts を
// cookie-signature 署名 httpOnly cookie (pin_reset_otp) に格納する stateless 方式 (#3070)。
//
// 設計の核心 (Issue #3070):
//   - Cognito は prompt=login を IdP(Google) に転送しないため、共有端末で親の Google session が
//     生きていると silent SSO で auth_time が refresh され recent-login(5分) を子が無入力通過し
//     PIN reset を完遂できる (実在の穴)。email-OTP は子がメールを読めないため確実に塞ぐ。
//   - cognito + federated のみ対象。それ以外 (password ユーザ / local) は 400 NOT_SUPPORTED。
//   - enumeration 防止: email はセッション既知だが、送信成否に依らず常に { ok: true } を返す。

import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { logger } from '$lib/server/logger';
import { checkRateLimit } from '$lib/server/security/rate-limiter';
import { sendPinResetCodeEmail } from '$lib/server/services/email-service';
import {
	issuePinResetOtp,
	PIN_RESET_OTP_COOKIE_MAX_AGE_SEC,
	PIN_RESET_OTP_COOKIE_NAME,
} from '$lib/server/services/pin-reset-otp';
import type { RequestHandler } from './$types';

/** 確認コード送信の brute force / spam 防止 (in-memory limiter と二重) */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export const POST: RequestHandler = async ({ cookies, locals, getClientAddress }) => {
	const tenantId = requireTenantId(locals);

	const identity = locals.identity;
	if (!identity || identity.type !== 'cognito') {
		// local / anonymous は対象外 (local の救済は operator reset #2994)
		return json({ ok: false, error: 'NOT_SUPPORTED' }, { status: 400 });
	}
	if (!identity.isFederated) {
		// password ユーザは reset-verified の password 分岐 (現状維持) を使う。OTP は federated 専用
		return json({ ok: false, error: 'NOT_SUPPORTED' }, { status: 400 });
	}

	const limit = checkRateLimit(
		`parent-gate-reset-code:${getClientAddress()}`,
		RATE_LIMIT_MAX,
		RATE_LIMIT_WINDOW_MS,
	);
	if (!limit.allowed) {
		return json({ ok: false, error: 'RATE_LIMITED' }, { status: 429 });
	}

	const { code, cookieValue } = issuePinResetOtp(tenantId);

	// 署名 cookie を先に set し、送信成否に依らず enumeration 防止のため一定応答を返す
	cookies.set(PIN_RESET_OTP_COOKIE_NAME, cookieValue, {
		path: '/',
		httpOnly: true,
		secure: COOKIE_SECURE,
		sameSite: 'lax',
		maxAge: PIN_RESET_OTP_COOKIE_MAX_AGE_SEC,
	});

	try {
		// code はメール本文にのみ載せ、ログには残さない (#3070 セキュリティ要件)
		await sendPinResetCodeEmail(identity.email, code);
	} catch (err) {
		// 送信失敗もログには code を残さず、応答は常に ok (enumeration / 状態漏洩防止)
		logger.error('[PARENT_GATE] reset-request-code: send failed (#3070)', {
			error: err instanceof Error ? err.message : String(err),
			context: { tenantIdPrefix: tenantId.slice(0, 12) },
		});
	}

	logger.info('[PARENT_GATE] reset-request-code: OTP issued (federated, #3070)', {
		context: { tenantIdPrefix: tenantId.slice(0, 12) },
	});

	return json({ ok: true });
};
