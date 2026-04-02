// src/lib/server/services/setup-funnel-service.ts
// セットアップウィザードの離脱ファネル計測 (#0262 G6)
// 各ステップの到達率を structured log で記録

import { logger } from '$lib/server/logger';

export type SetupFunnelEvent =
	| 'setup_start'
	| 'setup_child_registered'
	| 'setup_questionnaire_completed'
	| 'setup_questionnaire_skipped'
	| 'setup_packs_selected'
	| 'setup_packs_skipped'
	| 'setup_first_adventure_completed'
	| 'setup_first_adventure_skipped'
	| 'setup_completed'
	| 'setup_to_child'
	| 'setup_to_admin';

export function trackSetupFunnel(
	event: SetupFunnelEvent,
	tenantId: string,
	context?: Record<string, unknown>,
): void {
	logger.info(`[setup-funnel] ${event}`, {
		service: 'setup-funnel',
		tenantId,
		context: { event, ...context },
	});
}
