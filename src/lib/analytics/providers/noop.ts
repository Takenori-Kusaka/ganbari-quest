// src/lib/analytics/providers/noop.ts
// No-op analytics provider — default when no external service is configured.
// All methods are safe no-ops that never throw.

import type { AnalyticsProvider, EventProperties } from '../types';

export class NoopProvider implements AnalyticsProvider {
	readonly name = 'noop';

	init(): boolean {
		return true;
	}

	trackEvent(_name: string, _properties?: EventProperties): void {
		// intentionally empty
	}

	trackPageView(_url: string, _referrer?: string): void {
		// intentionally empty
	}

	trackError(_error: Error, _context?: EventProperties): void {
		// intentionally empty
	}

	identify(_tenantId: string, _traits?: EventProperties): void {
		// intentionally empty
	}

	async flush(): Promise<void> {
		// intentionally empty
	}
}
