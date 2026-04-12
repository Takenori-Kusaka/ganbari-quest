// src/routes/api/v1/feedback/+server.ts
// #839: アプリ内フィードバック送信 API
// ログイン済みユーザーからのフィードバックを Discord webhook で運営に通知する。
// レート制限: 1テナント/5分1件

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { FEEDBACK_CATEGORY_LABELS, feedbackSchema } from '$lib/domain/validation/feedback';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { notifyInquiry } from '$lib/server/services/discord-notify-service';

// In-memory rate limit map: tenantId -> last submission timestamp
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

function checkRateLimit(tenantId: string): boolean {
	const lastSubmission = rateLimitMap.get(tenantId);
	if (lastSubmission && Date.now() - lastSubmission < RATE_LIMIT_MS) {
		return false;
	}
	return true;
}

function recordSubmission(tenantId: string): void {
	rateLimitMap.set(tenantId, Date.now());
	// Cleanup old entries (>30min) to prevent memory leak
	if (rateLimitMap.size > 1000) {
		const cutoff = Date.now() - 30 * 60 * 1000;
		for (const [key, time] of rateLimitMap) {
			if (time < cutoff) rateLimitMap.delete(key);
		}
	}
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const tenantId = requireTenantId(locals);
	const identity = locals.identity;
	const email = identity && identity.type === 'cognito' ? identity.email : 'unknown';

	// Rate limit check
	if (!checkRateLimit(tenantId)) {
		return json(
			{ error: 'フィードバックの送信は5分に1回までです。しばらくお待ちください。' },
			{ status: 429 },
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'リクエストの形式が正しくありません' }, { status: 400 });
	}

	const parsed = feedbackSchema.safeParse(body);
	if (!parsed.success) {
		const firstError = parsed.error.issues[0]?.message ?? 'Validation error';
		return json({ error: firstError }, { status: 400 });
	}

	const { category, text, currentUrl } = parsed.data;

	try {
		await notifyInquiry(
			tenantId,
			category,
			`${text}${currentUrl ? `\n\n📍 送信元: ${currentUrl}` : ''}`,
			email,
			undefined,
			undefined,
		);
		recordSubmission(tenantId);

		logger.info('[feedback] Feedback submitted', {
			context: {
				tenantId,
				category,
				textLength: text.length,
			},
		});

		return json({
			success: true,
			message: `${FEEDBACK_CATEGORY_LABELS[category]}を送信しました。ありがとうございます！`,
		});
	} catch (err) {
		logger.error('[feedback] Failed to send feedback', {
			error: err instanceof Error ? err.message : String(err),
		});
		return json(
			{ error: 'フィードバックの送信に失敗しました。時間をおいて再度お試しください。' },
			{ status: 500 },
		);
	}
};
