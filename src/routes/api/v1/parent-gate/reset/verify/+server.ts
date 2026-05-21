// POST /api/v1/parent-gate/reset/verify — #2353 設計欠陥 4: PIN 忘れ救済導線 (新 PIN 設定)
//
// /auth/reset-pin/[token] 画面から呼ばれる。token 検証 → 新 PIN 設定 → JTI 消費 (1 回限り)。
//
// 設計:
//   - IP-based rate limit (20 req/15 min per IP、enumeration よりは反復試行抑止が主目的)
//   - PIN format validation (4-6 桁 digit) は既存 verify endpoint と同 regex
//   - 成功時は別途 /auth/forgot-pin の Banner で「再設定完了」を伝達、auto-login しない
//     (NIST SP 800-63B / OWASP password reset: token 利用後は明示的に gate 通過させる)

import { json } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { checkRateLimit } from '$lib/server/security/rate-limiter';
import { setupPin } from '$lib/server/services/auth-service';
import { consumePinResetToken, verifyPinResetToken } from '$lib/server/services/pin-reset-service';
import type { RequestHandler } from './$types';

/** 20 req per 15 min per IP */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const PIN_PATTERN = /^\d{4,6}$/;

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	const limit = checkRateLimit(`pin-reset-verify:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
	if (!limit.allowed) {
		return json({ ok: false, error: 'RATE_LIMITED' }, { status: 429 });
	}

	let token: string;
	let newPin: string;
	try {
		const body = await request.json();
		token = typeof body?.token === 'string' ? body.token : '';
		newPin = typeof body?.newPin === 'string' ? body.newPin : '';
	} catch {
		return json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
	}

	if (!token) {
		return json({ ok: false, error: 'TOKEN_INVALID' }, { status: 400 });
	}
	if (!PIN_PATTERN.test(newPin)) {
		return json({ ok: false, error: 'PIN_FORMAT' }, { status: 400 });
	}

	const verify = await verifyPinResetToken(token);
	if (!verify.ok || !verify.payload || !verify.jti) {
		const status =
			verify.error === 'TOKEN_EXPIRED' || verify.error === 'TOKEN_ALREADY_USED' ? 400 : 401;
		return json({ ok: false, error: verify.error ?? 'TOKEN_INVALID' }, { status });
	}

	try {
		// 新 PIN を hash 保存 (既存 setupPin を流用、resetFailedAttempts も含まれる)
		await setupPin(newPin, verify.payload.tenantId);
		// 1 回限り消費 (JTI 記録)
		await consumePinResetToken(verify.jti, verify.payload.tenantId);
		logger.info('[PIN_RESET] PIN reset completed', {
			context: { tenantIdPrefix: verify.payload.tenantId.slice(0, 12) },
		});
		return json({ ok: true });
	} catch (err) {
		logger.error('[PIN_RESET] PIN reset failed', { error: String(err) });
		return json({ ok: false, error: 'GENERIC' }, { status: 500 });
	}
};
