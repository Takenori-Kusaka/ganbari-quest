// src/routes/api/v1/inquiry/founder/+server.ts
// #1594 ADR-0023 I8: founder 1:1 ヒアリング動線
//
// LP / admin の「直接相談」フォームから POST されたデータを Discord webhook
// ('inquiry' チャネル) に転送する。SES 等の二重保管は YAGNI で導入しない。

import { error, json } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import {
	notifyFounderInquiry,
	validateFounderInquiry,
} from '$lib/server/services/founder-inquiry-service';
import type { RequestHandler } from './$types';

// ============================================================
// 簡易レート制限（インメモリ Map）
// ============================================================
//
// NOTE: Lambda 環境ではインスタンス間で Map が共有されないため、
// 厳密なレート制限にはならない（feedback API と同じ割り切り）。
// founder 直接相談は volume が極小 (~10/月想定) のため、現段階の Pre-PMF で
// DynamoDB ベース化する必要なし (ADR-0010)。

const RATE_LIMIT_MS = 60 * 1000; // 1 分（feedback よりは緩く、フォーム失敗時の再送を許容）
const MAX_MAP_SIZE = 1000;

const rateLimitMap = new Map<string, number>();

function cleanupRateLimitMap(): void {
	const now = Date.now();
	for (const [key, timestamp] of rateLimitMap) {
		if (now - timestamp >= RATE_LIMIT_MS) {
			rateLimitMap.delete(key);
		}
	}
	if (rateLimitMap.size > MAX_MAP_SIZE) {
		const entries = [...rateLimitMap.entries()].sort((a, b) => a[1] - b[1]);
		const deleteCount = rateLimitMap.size - MAX_MAP_SIZE;
		for (let i = 0; i < deleteCount; i++) {
			const entry = entries[i];
			if (entry) rateLimitMap.delete(entry[0]);
		}
	}
}

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	// 認証済みユーザーは tenantId、未認証は IP アドレスをレート制限キーにする
	const tenantId = locals.context?.tenantId ?? null;
	const rateLimitKey = tenantId ?? `ip:${getClientAddress()}`;

	cleanupRateLimitMap();
	const lastSent = rateLimitMap.get(rateLimitKey);
	if (lastSent && Date.now() - lastSent < RATE_LIMIT_MS) {
		const remainSec = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastSent)) / 1000);
		throw error(429, {
			message: `送信間隔が短すぎます。${remainSec} 秒後に再送してください`,
		});
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'リクエスト形式が不正です' });
	}

	// 認証済みなら tenantId を補完して通知に含める
	const enrichedBody =
		typeof body === 'object' && body !== null && tenantId
			? { ...(body as Record<string, unknown>), tenantId }
			: body;

	const validation = validateFounderInquiry(enrichedBody);
	if (!validation.ok) {
		throw error(400, {
			message: validation.errors.map((e) => e.message).join(' / '),
		});
	}

	try {
		await notifyFounderInquiry(validation.value);
	} catch (err) {
		// notifyDiscord 内で吸収済みのはずだが、念のため
		logger.error('[founder-inquiry] Notification failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw error(500, { message: '送信に失敗しました。時間をおいて再度お試しください' });
	}

	rateLimitMap.set(rateLimitKey, Date.now());

	return json({ success: true });
};
