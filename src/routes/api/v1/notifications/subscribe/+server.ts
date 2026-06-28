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
import {
	isValidPushKey,
	validatePushEndpoint,
} from '$lib/server/services/push-endpoint-validation';
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

		// #3188 SSRF hardening: endpoint は https + 既知 push service host のみ許可。
		// cron の server push が internal host へ POST する CWE-918 を防ぐ。
		const endpointCheck = validatePushEndpoint(body.endpoint);
		if (!endpointCheck.ok) {
			logger.warn('[notifications/subscribe] 不正な push endpoint を拒否', {
				context: { tenantId: context.tenantId, reason: endpointCheck.reason },
			});
			return json({ error: 'Invalid push endpoint', code: 'INVALID_ENDPOINT' }, { status: 400 });
		}
		// #3188: key は base64url 形式 + 長さ上限のみ検証 (raw 保存前の最小サニタイズ)。
		if (!isValidPushKey(body.keys.p256dh) || !isValidPushKey(body.keys.auth, 64)) {
			logger.warn('[notifications/subscribe] 不正な push key 形式を拒否', {
				context: { tenantId: context.tenantId },
			});
			return json({ error: 'Invalid push key', code: 'INVALID_KEY' }, { status: 400 });
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
		// #3404 (ADR-0062): 内部例外を client へ露出しない。詳細は server log のみに残し、
		// client には汎用 message を返す (info-disclosure 防止)。
		logger.error('[notifications/subscribe] subscribe 失敗', {
			context: { tenantId: context.tenantId },
			error: err instanceof Error ? err.message : String(err),
		});
		return json({ error: 'Subscription failed' }, { status: 500 });
	}
};
