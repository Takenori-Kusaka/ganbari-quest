// src/lib/analytics/providers/umami.ts
// Umami analytics provider for page views and user behavior tracking.
// Enabled only when PUBLIC_UMAMI_WEBSITE_ID and PUBLIC_UMAMI_HOST are set.
// Cookie-free, COPPA/GDPR compliant.

import { logger } from '$lib/server/logger';
import type { AnalyticsProvider, EventProperties } from '../types';

/**
 * Configuration for Umami provider.
 */
export interface UmamiConfig {
	/** Umami website ID (from Umami dashboard) */
	websiteId: string;
	/** Umami host URL (e.g., https://cloud.umami.is) */
	hostUrl: string;
}

/**
 * Umami provider for server-side event tracking via the Umami API.
 *
 * Client-side tracking is handled via the Umami script tag in app.html.
 * This provider handles server-side event forwarding.
 *
 * Requires:
 * - PUBLIC_UMAMI_WEBSITE_ID environment variable
 * - PUBLIC_UMAMI_HOST environment variable
 */
export class UmamiProvider implements AnalyticsProvider {
	readonly name = 'umami';
	private config: UmamiConfig | null = null;

	init(): boolean {
		const websiteId = process.env.PUBLIC_UMAMI_WEBSITE_ID;
		const hostUrl = process.env.PUBLIC_UMAMI_HOST;

		if (!websiteId || !hostUrl) {
			logger.debug(
				'[analytics] Umami: disabled (PUBLIC_UMAMI_WEBSITE_ID or PUBLIC_UMAMI_HOST not set)',
			);
			return false;
		}

		this.config = { websiteId, hostUrl };
		logger.info('[analytics] Umami: enabled', {
			context: { hostUrl },
		});
		return true;
	}

	trackEvent(name: string, properties?: EventProperties): void {
		if (!this.config) return;
		this.sendToUmami('event', {
			name,
			data: properties,
		}).catch(() => {});
	}

	trackPageView(url: string, referrer?: string): void {
		if (!this.config) return;
		this.sendToUmami('event', {
			url,
			referrer,
		}).catch(() => {});
	}

	trackError(_error: Error, _context?: EventProperties): void {
		// Umami is not designed for error tracking — delegate to Sentry
	}

	identify(_tenantId: string, _traits?: EventProperties): void {
		// Umami is cookie-free and does not track individual users by design
	}

	async flush(): Promise<void> {
		// Umami sends events immediately — no buffering
	}

	/**
	 * Get the Umami configuration (for client-side script injection).
	 */
	getConfig(): UmamiConfig | null {
		return this.config;
	}

	/**
	 * Send an event to the Umami collect endpoint.
	 * Uses the Umami API v2 format.
	 */
	private async sendToUmami(type: string, payload: Record<string, unknown>): Promise<void> {
		if (!this.config) return;

		try {
			const response = await fetch(`${this.config.hostUrl}/api/send`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': 'ganbari-quest-server/1.0',
				},
				body: JSON.stringify({
					type,
					payload: {
						website: this.config.websiteId,
						...payload,
					},
				}),
			});

			if (!response.ok) {
				logger.debug(`[analytics] Umami: send failed with status ${response.status}`);
			}
		} catch (err) {
			logger.debug('[analytics] Umami: send failed', {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}
