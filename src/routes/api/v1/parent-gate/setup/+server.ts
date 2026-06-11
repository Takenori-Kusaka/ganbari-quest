// POST /api/v1/parent-gate/setup — #2992 (EPIC #2990)
//
// 初回の保護者ゲートで PIN を新規作成する (「初回は作る・既存は入る」、
// Apple Screen Time / Google Family Link 同型)。
//
// - **PIN 未設定 tenant のみ許可**。設定済み tenant への上書きは 403 ALREADY_CONFIGURED
//   (子供が作成フローで親の PIN を勝手に再作成する穴を防ぐ。変更は現 PIN 確認付きの
//   changePin (/admin/settings/account)、忘れた場合は reset 経路が担う)
// - 成功で verify と同じ `gq_parent_session` 署名 cookie を発行し、そのまま親画面へ進める
// - rate limit は verify 系と同等 (20 req / 15 min per IP)

import { error, json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { COOKIE_SECURE } from '$lib/server/cookie-config';
import { logger } from '$lib/server/logger';
import { checkRateLimit } from '$lib/server/security/rate-limiter';
import { isPinConfigured, setupPin } from '$lib/server/services/auth-service';
import {
	createParentSession,
	PARENT_SESSION_COOKIE_NAME,
} from '$lib/server/services/parent-gate-session';
import type { RequestHandler } from './$types';

const PIN_PATTERN = /^\d{4,6}$/;
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24; // verify と同じ 24 時間 hard max (sliding は 15 分)
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export const POST: RequestHandler = async ({ request, cookies, locals, getClientAddress }) => {
	const tenantId = requireTenantId(locals);

	const limit = checkRateLimit(
		`parent-gate-setup:${getClientAddress()}`,
		RATE_LIMIT_MAX,
		RATE_LIMIT_WINDOW_MS,
	);
	if (!limit.allowed) {
		return json({ ok: false, error: 'RATE_LIMITED' }, { status: 429 });
	}

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

	// 未設定 tenant のみ作成可 (設定済みへの上書きは changePin / reset 経路に限定)
	if (await isPinConfigured(tenantId)) {
		logger.warn('[PARENT_GATE] setup rejected: PIN already configured', {
			context: { tenantIdPrefix: tenantId.slice(0, 12) },
		});
		return json({ ok: false, error: 'ALREADY_CONFIGURED' }, { status: 403 });
	}

	await setupPin(pin, tenantId);
	logger.info('[PARENT_GATE] PIN created via first-run setup (#2992)', {
		context: { tenantIdPrefix: tenantId.slice(0, 12) },
	});

	// 作成した本人をそのまま親画面へ通す (verify 成功と同じ session 発行)
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
