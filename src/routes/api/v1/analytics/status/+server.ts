// src/routes/api/v1/analytics/status/+server.ts
// Analytics status endpoint — returns active providers and configuration.
// Useful for admin/OPS dashboard to verify analytics setup.

import { json } from '@sveltejs/kit';
import { getAnalyticsStatus } from '$lib/server/services/analytics-service';
import type { RequestHandler } from './$types';

/**
 * GET /api/v1/analytics/status
 *
 * Returns the current analytics configuration:
 * - Active providers
 * - Umami config (for client-side verification)
 * - Whether Sentry is enabled
 */
export const GET: RequestHandler = async ({ locals }) => {
	// Only authenticated users can check analytics status
	if (!locals.authenticated) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const status = getAnalyticsStatus();
	return json({
		providers: status.providers,
		sentryEnabled: status.providers.includes('sentry'),
		umamiEnabled: status.providers.includes('umami'),
		dynamoEnabled: status.providers.includes('dynamo'),
		umamiConfig: status.umamiConfig
			? { websiteId: status.umamiConfig.websiteId, hostUrl: status.umamiConfig.hostUrl }
			: null,
	});
};
