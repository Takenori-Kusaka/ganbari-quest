import { requireTenantId } from '$lib/server/auth/factory';
import {
	getChallengeHistory,
	getOrCreateWeeklyChallenge,
} from '$lib/server/services/auto-challenge-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { child } = await parent();
	if (!child) return { activeChallenge: null, history: [] };

	// ADR-0039 Phase 2 (#2097): デモ実行モード時は in-memory state (空 = 「達成なし」)。
	// 子供画面の称号一覧は LP では撮影対象外、AC9 で本番と等価検証が必要なら別 SS。
	if (locals.isDemo) {
		return { activeChallenge: null, history: [] };
	}

	const tenantId = requireTenantId(locals);
	const [activeChallenge, history] = await Promise.all([
		getOrCreateWeeklyChallenge(child.id, tenantId),
		getChallengeHistory(child.id, tenantId, 10),
	]);

	return { activeChallenge, history };
};
