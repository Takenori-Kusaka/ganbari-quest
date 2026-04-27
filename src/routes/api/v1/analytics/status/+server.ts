// src/routes/api/v1/analytics/status/+server.ts
// Analytics status endpoint — returns active providers.
// Useful for admin/OPS dashboard to verify analytics setup.
//
// #1591 (ADR-0023 I2): umami / Sentry プロバイダ削除に伴い、レスポンスは
// `providers` + `dynamoEnabled` のみ。AWS 内完結 (DynamoDB) フィールドの真偽値で
// 「外部送信ゼロ」が構造的に保証されていることを ops が確認できる。

import { json } from '@sveltejs/kit';
import { getAnalyticsStatus } from '$lib/server/services/analytics-service';
import type { RequestHandler } from './$types';

/**
 * GET /api/v1/analytics/status
 *
 * Returns the current analytics configuration:
 * - Active provider names
 * - dynamoEnabled: AWS-internal DynamoDB provider が有効か
 */
export const GET: RequestHandler = async ({ locals }) => {
	// Only authenticated users can check analytics status
	if (!locals.authenticated) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const status = getAnalyticsStatus();
	return json({
		providers: status.providers,
		dynamoEnabled: status.providers.includes('dynamo'),
	});
};
