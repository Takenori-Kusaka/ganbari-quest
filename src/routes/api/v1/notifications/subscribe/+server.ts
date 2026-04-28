// src/routes/api/v1/notifications/subscribe/+server.ts
// Web Push 通知購読 API
//
// #1593 (ADR-0023 I6): child role の subscribe を構造的に拒否する。
// COPPA 改正 (2025/01 最終化、2026/04 対応期限) + ADR-0012 Anti-engagement の
// 二重リスク対策として、子端末への push 通知は禁止する。
//
// 許容: parent / owner ロール
// 拒否: child ロール → 403 Forbidden
import { json } from '@sveltejs/kit';
import { PUSH_NOTIFICATION_LABELS } from '$lib/domain/labels';
import { findByEndpoint, insert } from '$lib/server/db/push-subscription-repo';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context?.tenantId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// #1593 (ADR-0023 I6): child role からの subscribe を構造的に拒否
	if (context.role === 'child') {
		logger.warn('[notifications/subscribe] child role からの subscribe を拒否', {
			context: { tenantId: context.tenantId, childId: context.childId },
		});
		return json(
			{ error: PUSH_NOTIFICATION_LABELS.childSubscribeForbidden, code: 'CHILD_FORBIDDEN' },
			{ status: 403 },
		);
	}

	// owner / parent のみ subscribe 可能 (将来の role 追加時の防御)
	if (context.role !== 'parent' && context.role !== 'owner') {
		return json({ error: 'Forbidden', code: 'ROLE_NOT_ALLOWED' }, { status: 403 });
	}

	try {
		const body = (await request.json()) as {
			endpoint: string;
			keys: { p256dh: string; auth: string };
		};

		if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
			return json({ error: 'Missing required fields' }, { status: 400 });
		}

		// 既存チェック（同じ endpoint が登録済みならスキップ）
		const existing = await findByEndpoint(body.endpoint, context.tenantId);
		if (existing) {
			return json({ success: true, message: 'Already subscribed' });
		}

		await insert({
			tenantId: context.tenantId,
			endpoint: body.endpoint,
			keysP256dh: body.keys.p256dh,
			keysAuth: body.keys.auth,
			userAgent: request.headers.get('user-agent'),
			subscriberRole: context.role, // 'parent' | 'owner'
		});

		return json({ success: true });
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};
