// src/routes/api/v1/analytics/+server.ts
// Client-side analytics event ingestion endpoint.
// Accepts events from the browser and forwards them to server-side analytics providers.

import { json } from '@sveltejs/kit';
import { trackBusinessEvent } from '$lib/server/services/analytics-service';
import type { RequestHandler } from './$types';

/** Maximum properties object size (prevent abuse) */
const MAX_PROPERTIES_KEYS = 20;
const MAX_EVENT_NAME_LENGTH = 100;

/**
 * POST /api/v1/analytics
 *
 * Body: { event: string, properties?: Record<string, string|number|boolean|null> }
 *
 * Returns 204 on success (no content — fire-and-forget from client perspective).
 * Returns 400 on validation error.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const body = await request.json();

		// Validate event name
		if (typeof body.event !== 'string' || body.event.length === 0) {
			return json({ error: 'event is required' }, { status: 400 });
		}
		if (body.event.length > MAX_EVENT_NAME_LENGTH) {
			return json({ error: 'event name too long' }, { status: 400 });
		}

		// Validate properties
		const properties = body.properties ?? {};
		if (typeof properties !== 'object' || Array.isArray(properties)) {
			return json({ error: 'properties must be an object' }, { status: 400 });
		}
		if (Object.keys(properties).length > MAX_PROPERTIES_KEYS) {
			return json({ error: 'too many properties' }, { status: 400 });
		}

		// Sanitize property values — only primitives allowed
		const sanitized: Record<string, string | number | boolean | null> = {};
		for (const [key, value] of Object.entries(properties)) {
			if (
				typeof value === 'string' ||
				typeof value === 'number' ||
				typeof value === 'boolean' ||
				value === null
			) {
				sanitized[key] = value;
			}
			// Skip non-primitive values silently
		}

		const tenantId = locals.context?.tenantId;
		trackBusinessEvent(body.event, sanitized, tenantId);

		return new Response(null, { status: 204 });
	} catch {
		// Malformed JSON or other errors — return 400 but don't crash
		return json({ error: 'invalid request body' }, { status: 400 });
	}
};
