// src/lib/analytics/types.ts
// Analytics provider interface definitions

/**
 * Known business event names for type-safe tracking.
 * Additional string event names are allowed for extensibility.
 */
export type BusinessEventName =
	| 'activity_recorded'
	| 'checklist_completed'
	| 'stamp_collected'
	| 'level_up'
	| 'session_start'
	| 'session_end'
	| 'child_switch'
	| 'tutorial_step'
	| 'special_reward_granted'
	| 'login_bonus_claimed'
	| 'daily_mission_completed'
	| 'page_view';

/**
 * Properties that can be attached to a tracking event.
 */
export type EventProperties = Record<string, string | number | boolean | null | undefined>;

/**
 * Analytics provider interface.
 * Each provider (Sentry, Umami, DynamoDB, noop) implements this.
 * All methods are fire-and-forget; failures must never break the app.
 */
export interface AnalyticsProvider {
	/** Provider name for logging/debugging */
	readonly name: string;

	/**
	 * Initialize the provider. Called once at app startup.
	 * Returns false if the provider is not configured / should be disabled.
	 */
	init(): boolean;

	/**
	 * Track a named event with optional properties.
	 */
	trackEvent(name: string, properties?: EventProperties): void;

	/**
	 * Track a page view.
	 */
	trackPageView(url: string, referrer?: string): void;

	/**
	 * Track an error/exception.
	 */
	trackError(error: Error, context?: EventProperties): void;

	/**
	 * Identify a user/tenant (for providers that support user association).
	 * Must never include PII of children (COPPA).
	 */
	identify(tenantId: string, traits?: EventProperties): void;

	/**
	 * Flush any buffered events (for graceful shutdown).
	 */
	flush(): Promise<void>;

	/**
	 * Optional runtime active check. Returns true if the provider is currently
	 * usable (SDK loaded, credentials valid, etc.). Used by CSP generation to
	 * avoid allow-listing provider domains when the provider is registered but
	 * not yet (or no longer) usable.
	 *
	 * Defaults to true when not implemented — meaning the provider is active
	 * for as long as it remains registered with the AnalyticsManager.
	 */
	isActive?(): boolean;
}
