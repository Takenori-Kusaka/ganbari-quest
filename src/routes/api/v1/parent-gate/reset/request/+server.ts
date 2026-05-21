// POST /api/v1/parent-gate/reset/request — #2353 設計欠陥 4: PIN 忘れ救済導線
//
// email を受け取って、その email に紐付く owner user の全 tenant にそれぞれ
// 30 分有効の magic link を SES で送信する。enumeration 攻撃を防ぐため、
// email の登録有無に関わらず 200 を返し、外部から判別不能にする。
//
// 設計:
//   - IP-based rate limit (5 req/15 min per IP) で短時間連打を抑止
//   - 失敗 (SES 失敗 / DB 失敗) も logger.warn のみで 200 を返す (enumeration 防止)
//   - magic link は `/auth/reset-pin/<token>` (token は jose JWT、pin-reset-service)

import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/runtime/env';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { checkRateLimit } from '$lib/server/security/rate-limiter';
import { sendPinResetEmail } from '$lib/server/services/email-service';
import { issuePinResetToken } from '$lib/server/services/pin-reset-service';
import type { RequestHandler } from './$types';

/** 5 req per 15 min per IP (PO-friendly forgot-password 業界標準) */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getAppBaseUrl(): string {
	return getEnv().APP_BASE_URL ?? 'https://ganbari-quest.com';
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();

	const limit = checkRateLimit(`pin-reset-request:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
	if (!limit.allowed) {
		return json({ ok: false, error: 'RATE_LIMITED' }, { status: 429 });
	}

	let email: string;
	try {
		const body = await request.json();
		email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
	} catch {
		return json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
	}

	if (!email || !EMAIL_PATTERN.test(email)) {
		return json({ ok: false, error: 'INVALID_EMAIL' }, { status: 400 });
	}

	// 以下、enumeration 防止のため email 未登録 / SES 失敗等の理由でも 200 を返す。
	try {
		const repos = getRepos();
		const user = await repos.auth.findUserByEmail(email);
		if (!user) {
			logger.info('[PIN_RESET] reset request for unknown email', {
				context: { emailDomain: email.split('@')[1] ?? 'unknown' },
			});
			return json({ ok: true });
		}

		const memberships = await repos.auth.findUserTenants(user.id);
		if (memberships.length === 0) {
			logger.info('[PIN_RESET] user has no tenants', { context: { userId: user.id } });
			return json({ ok: true });
		}

		// すべての所属 tenant に対し token を発行 + SES 送信
		// 通常 1 件のみだが、複数家族グループ owner ケースに備えて多重発行
		const base = getAppBaseUrl();
		for (const m of memberships) {
			const token = await issuePinResetToken({ tenantId: m.tenantId, email: user.email });
			const magicLinkUrl = `${base}/auth/reset-pin/${encodeURIComponent(token)}`;
			await sendPinResetEmail(user.email, magicLinkUrl);
		}
	} catch (err) {
		logger.error('[PIN_RESET] reset request failed', {
			error: String(err),
		});
		// enumeration 防止のため 200 維持
	}

	return json({ ok: true });
};
