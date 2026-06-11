// POST /api/v1/parent-gate/reset-verified — #2993 (EPIC #2990)
//
// cognito モードの「おやカギコードを忘れた」救済: **アカウントパスワードの再入力**で本人確認し、
// その場で PIN を再作成する (Apple Screen Time 同型 = 忘れた → アカウント資格情報で reset)。
//
// 設計の核心 (Issue #2993 設計コメント):
//   - cognito 認証済みセッション ≠ 親 (家庭内共有端末で親のセッションのまま子供が触る前提が
//     parent-gate の存在意義)。セッションだけで reset を許すと子供が gate を突破できる穴になる
//     ため、子供が知らない「アカウントパスワード」を本人確認に使う
//   - email は `locals.identity.email` (cognito identity) を使い手入力させない
//   - メール往復 (旧 SES magic link) なし。旧 email reset 経路は本 PR で削除 (置換)
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
import type { RequestHandler } from './$types';

const PIN_PATTERN = /^\d{4,6}$/;
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24; // verify と同じ 24 時間 hard max (sliding は 15 分)
/** #3025: federated user の requires-recent-login 閾値 (Firebase 同型の 5 分) */
const RECENT_AUTH_MAX_AGE_SEC = 5 * 60;
/** パスワード brute force 防止 (Cognito 側 throttle と二重) */
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
	try {
		const body = await request.json();
		password = typeof body?.password === 'string' ? body.password : '';
		newPin = typeof body?.newPin === 'string' ? body.newPin : '';
	} catch {
		error(400, 'INVALID_BODY');
	}

	if (!newPin || !PIN_PATTERN.test(newPin)) {
		return json({ ok: false, error: 'PIN_FORMAT' }, { status: 400 });
	}

	const verifyError = identity.isFederated
		? verifyFederatedRecentAuth(identity.authTime, tenantId)
		: await verifyAccountPassword(identity.email, password, tenantId);
	if (verifyError) {
		return verifyError;
	}

	await setupPin(newPin, tenantId);
	logger.info('[PARENT_GATE] PIN reset via password re-auth (#2993)', {
		context: { tenantIdPrefix: tenantId.slice(0, 12) },
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
 * #3025: federated (Google 等) ユーザの本人確認 — requires-recent-login (Firebase 同型)。
 * federated は Cognito パスワードを持たないため、auth_time (実認証時刻、refresh token 経由の
 * 再発行では更新されない) が閾値以内 = 「Google でログインし直した直後」のみ再設定を許可する。
 * Cognito は prompt=login を IdP に転送しないため (既知制限)、これが第三者アプリとして到達可能な
 * 最大強度 (research: tmp/research/pin-reset-federated-user-2026-06-11.md)。
 * @returns 検証 NG なら error Response、OK なら null
 */
function verifyFederatedRecentAuth(authTime: number | undefined, tenantId: string): Response | null {
	const ageSec = authTime ? Math.floor(Date.now() / 1000) - authTime : Number.POSITIVE_INFINITY;
	if (ageSec > RECENT_AUTH_MAX_AGE_SEC) {
		logger.info('[PARENT_GATE] reset-verified: federated recent-auth stale (再ログイン誘導)', {
			context: { tenantIdPrefix: tenantId.slice(0, 12), ageSec },
		});
		return json({ ok: false, error: 'FRESH_LOGIN_REQUIRED' }, { status: 401 });
	}
	return null;
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
