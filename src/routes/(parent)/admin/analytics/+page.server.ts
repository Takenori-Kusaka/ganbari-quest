// src/routes/(parent)/admin/analytics/+page.server.ts
// #988: Umami アナリティクス閲覧パネル — Option A (API 経由)
// Umami v2 API からデータを取得し、アプリ内で表示する。
// CSP を緩める必要がなく、表示カスタマイズも自由に行える。

import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import type { PageServerLoad } from './$types';

interface UmamiStats {
	pageviews: { value: number; prev: number };
	visitors: { value: number; prev: number };
	visits: { value: number; prev: number };
	bounces: { value: number; prev: number };
	totaltime: { value: number; prev: number };
}

interface UmamiMetricEntry {
	x: string;
	y: number;
}

export interface AnalyticsData {
	configured: boolean;
	stats: UmamiStats | null;
	pages: UmamiMetricEntry[];
	referrers: UmamiMetricEntry[];
	events: UmamiMetricEntry[];
	error: string | null;
	hostUrl: string | null;
}

/**
 * Umami API からデータ取得。未設定の場合は configured: false を返す。
 */
async function fetchUmamiData(): Promise<AnalyticsData> {
	const websiteId = process.env.PUBLIC_UMAMI_WEBSITE_ID;
	const hostUrl = process.env.PUBLIC_UMAMI_HOST;
	const apiKey = process.env.UMAMI_API_KEY;

	if (!websiteId || !hostUrl) {
		return {
			configured: false,
			stats: null,
			pages: [],
			referrers: [],
			events: [],
			error: null,
			hostUrl: null,
		};
	}

	const headers: Record<string, string> = {
		Accept: 'application/json',
	};
	if (apiKey) {
		headers['x-umami-api-key'] = apiKey;
	}

	// 過去 30 日間
	const now = Date.now();
	const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
	const params = `startAt=${thirtyDaysAgo}&endAt=${now}`;

	try {
		const [statsRes, pagesRes, referrersRes, eventsRes] = await Promise.all([
			fetch(`${hostUrl}/api/websites/${websiteId}/stats?${params}`, { headers }),
			fetch(`${hostUrl}/api/websites/${websiteId}/metrics?${params}&type=url&limit=10`, {
				headers,
			}),
			fetch(`${hostUrl}/api/websites/${websiteId}/metrics?${params}&type=referrer&limit=10`, {
				headers,
			}),
			fetch(`${hostUrl}/api/websites/${websiteId}/metrics?${params}&type=event&limit=20`, {
				headers,
			}),
		]);

		if (!statsRes.ok) {
			const errText = await statsRes.text().catch(() => 'unknown');
			throw new Error(`Umami API stats returned ${statsRes.status}: ${errText}`);
		}

		const stats: UmamiStats = await statsRes.json();
		const pages: UmamiMetricEntry[] = pagesRes.ok ? await pagesRes.json() : [];
		const referrers: UmamiMetricEntry[] = referrersRes.ok ? await referrersRes.json() : [];
		const events: UmamiMetricEntry[] = eventsRes.ok ? await eventsRes.json() : [];

		return { configured: true, stats, pages, referrers, events, error: null, hostUrl };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		logger.error('[admin/analytics] Failed to fetch Umami data', {
			context: { error: message },
		});
		return {
			configured: true,
			stats: null,
			pages: [],
			referrers: [],
			events: [],
			error: message,
			hostUrl,
		};
	}
}

export const load: PageServerLoad = async ({ locals }) => {
	requireTenantId(locals);
	const analytics = await fetchUmamiData();
	return { analytics };
};
