import { logger } from '$lib/server/logger.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Lightweight demo analytics endpoint.
 * Records demo page views and events for conversion funnel analysis.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { event, path, step, metadata } = body as {
			event: string;
			path?: string;
			step?: number;
			metadata?: Record<string, unknown>;
		};

		if (!event || typeof event !== 'string') {
			return json({ ok: false }, { status: 400 });
		}

		logger.info('[DEMO_ANALYTICS]', {
			context: {
				event,
				path: path ?? '',
				step: step ?? null,
				...metadata,
			},
		});

		return json({ ok: true });
	} catch {
		return json({ ok: true }); // fail silently for analytics
	}
};
