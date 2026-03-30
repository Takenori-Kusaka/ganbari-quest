/**
 * Lightweight demo analytics client.
 * Sends beacon events to /api/demo-analytics for funnel tracking.
 */

type DemoEvent =
	| 'demo_start'
	| 'demo_page_view'
	| 'demo_guide_start'
	| 'demo_guide_step'
	| 'demo_guide_dismiss'
	| 'demo_record_activity'
	| 'demo_cta_click'
	| 'demo_signup_page';

export function trackDemoEvent(event: DemoEvent, metadata?: Record<string, unknown>): void {
	try {
		const payload = {
			event,
			path: window.location.pathname,
			...metadata,
		};

		// Use sendBeacon for fire-and-forget (works even during navigation)
		if (navigator.sendBeacon) {
			navigator.sendBeacon(
				'/api/demo-analytics',
				new Blob([JSON.stringify(payload)], { type: 'application/json' }),
			);
		} else {
			fetch('/api/demo-analytics', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				keepalive: true,
			}).catch(() => {
				// silently ignore
			});
		}
	} catch {
		// analytics should never break the app
	}
}
