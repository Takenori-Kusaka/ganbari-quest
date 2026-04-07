// src/lib/analytics/providers/sentry.ts
// Sentry error tracking provider.
// Enabled only when PUBLIC_SENTRY_DSN is set.

import { logger } from '$lib/server/logger';
import type { AnalyticsProvider, EventProperties } from '../types';

/**
 * Minimal Sentry-like interface for the methods we call.
 * This avoids a hard dependency on @sentry/sveltekit at the type level.
 */
interface SentryLike {
	addBreadcrumb(breadcrumb: {
		category?: string;
		message?: string;
		data?: Record<string, string>;
		level?: string;
	}): void;
	captureException(error: unknown, options?: { extra?: Record<string, unknown> }): void;
	setUser(user: { id?: string } | null): void;
	flush(timeout?: number): Promise<boolean>;
}

/**
 * Sentry provider for error tracking and performance monitoring.
 *
 * Requires:
 * - PUBLIC_SENTRY_DSN environment variable
 * - @sentry/sveltekit package (optional dependency)
 *
 * When the DSN is not set or the SDK is not installed, init() returns false
 * and all methods are safe no-ops.
 */
export class SentryProvider implements AnalyticsProvider {
	readonly name = 'sentry';
	private enabled = false;
	private sentry: SentryLike | null = null;

	init(): boolean {
		const dsn = process.env.PUBLIC_SENTRY_DSN;
		if (!dsn) {
			logger.debug('[analytics] Sentry: disabled (PUBLIC_SENTRY_DSN not set)');
			return false;
		}

		try {
			// Sentry SDK is an optional dependency — if not installed, disable gracefully.
			// The actual initialization (Sentry.init()) happens via SvelteKit hooks integration
			// (handleErrorWithSentry / sentryHandle) which must be set up separately.
			// This provider lazily imports the SDK for server-side event capture.
			this.enabled = true;
			this.loadSentry();
			logger.info('[analytics] Sentry: enabled');
			return true;
		} catch (err) {
			logger.warn('[analytics] Sentry: failed to initialize', {
				error: err instanceof Error ? err.message : String(err),
			});
			return false;
		}
	}

	trackEvent(name: string, properties?: EventProperties): void {
		if (!this.enabled) return;
		try {
			// Sentry breadcrumb for event correlation
			this.getSentry()?.addBreadcrumb({
				category: 'analytics',
				message: name,
				data: properties as Record<string, string>,
				level: 'info',
			});
		} catch {
			// Never break the app
		}
	}

	trackPageView(_url: string, _referrer?: string): void {
		// Sentry handles page views via its own instrumentation
	}

	trackError(error: Error, context?: EventProperties): void {
		if (!this.enabled) return;
		try {
			const sentry = this.getSentry();
			if (sentry) {
				sentry.captureException(error, {
					extra: context as Record<string, unknown>,
				});
			}
		} catch {
			// Never break the app
		}
	}

	identify(tenantId: string, _traits?: EventProperties): void {
		if (!this.enabled) return;
		try {
			const sentry = this.getSentry();
			if (sentry) {
				// Set tenant context — never set children's PII
				sentry.setUser({ id: tenantId });
			}
		} catch {
			// Never break the app
		}
	}

	async flush(): Promise<void> {
		if (!this.enabled) return;
		try {
			const sentry = this.getSentry();
			if (sentry) {
				await sentry.flush(2000);
			}
		} catch {
			// Never break the app
		}
	}

	/**
	 * Lazily import @sentry/sveltekit.
	 * The SDK must already be initialized via hooks (sentryHandle / handleErrorWithSentry).
	 * This import only obtains the module reference for calling captureException, etc.
	 */
	private loadSentry(): void {
		// Use a variable to prevent TS from statically resolving the optional dependency
		const moduleName = '@sentry/sveltekit';
		import(/* @vite-ignore */ moduleName)
			.then((mod) => {
				this.sentry = mod as unknown as SentryLike;
				logger.debug('[analytics] Sentry: SDK module loaded');
			})
			.catch((err) => {
				logger.warn('[analytics] Sentry: @sentry/sveltekit not installed', {
					error: err instanceof Error ? err.message : String(err),
				});
				this.enabled = false;
				this.sentry = null;
			});
	}

	/**
	 * Runtime active check used by AnalyticsManager.isProviderActive() and,
	 * transitively, by the CSP header builder in hooks.server.ts.
	 *
	 * `init()` optimistically sets `enabled = true` so the provider gets
	 * registered, then kicks off an async SDK import. If the import fails
	 * (e.g. `@sentry/sveltekit` not installed), the .catch branch above
	 * clears `enabled` back to false and nulls `sentry` — after that flip,
	 * this method returns false and the CSP builder stops allow-listing
	 * Sentry domains. The only window where CSP can over-permit is the few
	 * microticks between init() returning and the import promise settling,
	 * which is exhausted before any HTTP request is served.
	 */
	isActive(): boolean {
		return this.enabled;
	}

	private getSentry(): SentryLike | null {
		return this.sentry;
	}
}
