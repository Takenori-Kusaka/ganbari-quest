// POST /api/v1/parent-gate/verify — EPIC #2310 子#2313
//
// PIN 認証 → 成功で `gq_parent_session` 署名 cookie 発行
// 既存 verifyPin (auth-service) の lockout / NIST throttling を流用

import { error, json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { verifyPin } from '$lib/server/services/auth-service';
import {
	createParentSession,
	PARENT_SESSION_COOKIE_NAME,
} from '$lib/server/services/parent-gate-session';
import type { RequestHandler } from './$types';

const PIN_PATTERN = /^\d{4,6}$/;
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24; // 24 時間 hard max (sliding は 15 分)

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	const tenantId = requireTenantId(locals);

	let pin: string;
	try {
		const body = await request.json();
		pin = typeof body?.pin === 'string' ? body.pin : '';
	} catch {
		error(400, 'INVALID_BODY');
	}

	if (!pin || !PIN_PATTERN.test(pin)) {
		return json({ ok: false, error: 'PIN_FORMAT' }, { status: 400 });
	}

	const result = await verifyPin(pin, tenantId);
	if (!result.ok) {
		if (result.error === 'LOCKED_OUT') {
			return json(
				{ ok: false, error: 'LOCKED_OUT', lockedUntil: result.lockedUntil },
				{ status: 429 },
			);
		}
		return json({ ok: false, error: result.error }, { status: 401 });
	}

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
