// src/lib/analytics/index.ts
// Unified analytics interface — delegates to all active providers.
// Providers are opt-in via environment variables. Missing config = disabled.
// All operations are fire-and-forget; failures never break the app.
//
// #1591 (ADR-0023 I2): umami / sentry providers were removed in favour of an
// AWS-internal DynamoDB-only pipeline. The 3rd-party providers had been
// silently disabled in production (env vars never distributed) and the legacy
// code was a confusion source ("we ship analytics code that does nothing").
// Single provider keeps the "external send = zero" guarantee structural:
// the only allow-listed analytics destination is our own DynamoDB table.

import { logger } from '$lib/server/logger';
import { DynamoAnalyticsProvider } from './providers/dynamo';
import { NoopProvider } from './providers/noop';
import type { AnalyticsProvider, EventProperties } from './types';

export type { AnalyticsProvider, BusinessEventName, EventProperties } from './types';

/**
 * Multi-provider analytics manager.
 * Dispatches events to all enabled providers in parallel.
 */
class AnalyticsManager {
	private providers: AnalyticsProvider[] = [];
	private initialized = false;

	/**
	 * Initialize all configured providers.
	 * Safe to call multiple times — subsequent calls are no-ops.
	 */
	init(): void {
		if (this.initialized) return;
		this.initialized = true;

		const candidates: AnalyticsProvider[] = [new DynamoAnalyticsProvider()];

		for (const provider of candidates) {
			try {
				if (provider.init()) {
					this.providers.push(provider);
				}
			} catch (err) {
				logger.warn(`[analytics] Failed to initialize provider: ${provider.name}`, {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		// If no providers were enabled, add noop for consistent interface
		if (this.providers.length === 0) {
			const noop = new NoopProvider();
			noop.init();
			this.providers.push(noop);
			logger.info('[analytics] No providers configured — using noop');
		} else {
			logger.info(
				`[analytics] Initialized ${this.providers.length} provider(s): ${this.providers.map((p) => p.name).join(', ')}`,
			);
		}
	}

	/**
	 * Track a named event across all providers.
	 */
	trackEvent(name: string, properties?: EventProperties): void {
		this.ensureInit();
		for (const provider of this.providers) {
			try {
				provider.trackEvent(name, properties);
			} catch {
				// swallow — analytics must never break the app
			}
		}
	}

	/**
	 * Track a page view across all providers.
	 */
	trackPageView(url: string, referrer?: string): void {
		this.ensureInit();
		for (const provider of this.providers) {
			try {
				provider.trackPageView(url, referrer);
			} catch {
				// swallow
			}
		}
	}

	/**
	 * Track an error across all providers.
	 */
	trackError(error: Error, context?: EventProperties): void {
		this.ensureInit();
		for (const provider of this.providers) {
			try {
				provider.trackError(error, context);
			} catch {
				// swallow
			}
		}
	}

	/**
	 * Associate a tenant with subsequent events.
	 */
	identify(tenantId: string, traits?: EventProperties): void {
		this.ensureInit();
		for (const provider of this.providers) {
			try {
				provider.identify(tenantId, traits);
			} catch {
				// swallow
			}
		}
	}

	/**
	 * Flush all providers (for graceful shutdown).
	 */
	async flush(): Promise<void> {
		const results = this.providers.map((p) => p.flush().catch(() => {}));
		await Promise.all(results);
	}

	/**
	 * Get the list of active provider names.
	 */
	getActiveProviders(): string[] {
		return this.providers.map((p) => p.name);
	}

	/**
	 * Check if a specific provider is active.
	 *
	 * If the provider exposes an `isActive()` method, its result is used
	 * (this lets providers with async init report accurately).
	 */
	isProviderActive(name: string): boolean {
		const provider = this.providers.find((p) => p.name === name);
		if (!provider) return false;
		return provider.isActive ? provider.isActive() : true;
	}

	/**
	 * Reset for testing purposes.
	 */
	reset(): void {
		this.providers = [];
		this.initialized = false;
	}

	private ensureInit(): void {
		if (!this.initialized) {
			this.init();
		}
	}
}

/** Singleton analytics instance */
export const analytics = new AnalyticsManager();
