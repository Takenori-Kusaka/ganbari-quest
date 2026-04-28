// src/routes/inquiry/founder/+page.server.ts
// #1594 ADR-0023 I8: founder 1:1 ヒアリング動線
//
// SvelteKit form action で POST を受け取り、API endpoint と同じロジックで Discord 通知。
// JS 無効環境でも動作するように form action を主動線にする。

import { fail } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import {
	notifyFounderInquiry,
	validateFounderInquiry,
} from '$lib/server/services/founder-inquiry-service';
import type { Actions } from './$types';

const RATE_LIMIT_MS = 60 * 1000;
const MAX_MAP_SIZE = 1000;
const rateLimitMap = new Map<string, number>();

function cleanupRateLimitMap(): void {
	const now = Date.now();
	for (const [key, timestamp] of rateLimitMap) {
		if (now - timestamp >= RATE_LIMIT_MS) rateLimitMap.delete(key);
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

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress }) => {
		const tenantId = locals.context?.tenantId ?? null;
		const rateLimitKey = tenantId ?? `ip:${getClientAddress()}`;

		cleanupRateLimitMap();
		const lastSent = rateLimitMap.get(rateLimitKey);
		if (lastSent && Date.now() - lastSent < RATE_LIMIT_MS) {
			const remainSec = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastSent)) / 1000);
			return fail(429, {
				message: `送信間隔が短すぎます。${remainSec} 秒後に再送してください`,
			});
		}

		const data = await request.formData();
		const enrichedBody: Record<string, unknown> = {
			name: data.get('name'),
			email: data.get('email'),
			childAge: data.get('childAge'),
			message: data.get('message'),
			sourcePath: data.get('sourcePath'),
		};
		if (tenantId) enrichedBody.tenantId = tenantId;

		const validation = validateFounderInquiry(enrichedBody);
		if (!validation.ok) {
			return fail(400, {
				message: validation.errors.map((e) => e.message).join(' / '),
				values: {
					name: typeof enrichedBody.name === 'string' ? enrichedBody.name : '',
					email: typeof enrichedBody.email === 'string' ? enrichedBody.email : '',
					childAge: typeof enrichedBody.childAge === 'string' ? enrichedBody.childAge : '',
					message: typeof enrichedBody.message === 'string' ? enrichedBody.message : '',
				},
			});
		}

		try {
			await notifyFounderInquiry(validation.value);
		} catch (err) {
			logger.error('[founder-inquiry] form action notification failed', {
				error: err instanceof Error ? err.message : String(err),
			});
			return fail(500, { message: '送信に失敗しました。時間をおいて再度お試しください' });
		}

		rateLimitMap.set(rateLimitKey, Date.now());

		return { success: true };
	},
};
