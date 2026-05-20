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
	// #2140 MP-5: setup wizard β 採用 (3 step 分割) — reward / rule step イベント
	| 'setup_rewards_selected'
	| 'setup_rewards_skipped'
	| 'setup_rules_selected'
	| 'setup_rules_skipped'
	// #2298 (EPIC #2294 ④): 家族チャレンジ一括追加 step
	| 'setup_challenges_selected'
	| 'setup_challenges_skipped'
	// #2322 (EPIC #2319 ③): 活動・ポイント設定の初期値投入 step
	| 'setup_activities_defaults_applied'
	| 'setup_activities_defaults_skipped'
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
