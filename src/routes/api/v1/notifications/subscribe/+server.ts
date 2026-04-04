import { json } from '@sveltejs/kit';
import { findByEndpoint, insert } from '$lib/server/db/push-subscription-repo';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context?.tenantId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
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
		});

		return json({ success: true });
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};
