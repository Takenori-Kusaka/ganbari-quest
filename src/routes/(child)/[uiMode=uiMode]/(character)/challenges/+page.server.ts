import { requireTenantId } from '$lib/server/auth/factory';
import {
	getChildChallengeHistory,
	getOrCreateWeeklyChildChallengeView,
} from '$lib/server/services/child-challenge-service';
import type { PageServerLoad } from './$types';

// #3195 (EPIC #3193): チャレンジ child_challenges 一本化。
// 旧 auto-challenge-service (auto_challenges テーブル) 経由の生成/読み取りを撤去し、
// home (`getOrCreateWeeklyChildChallenge`) と同一の生成入口 child_challenges を共有する。
// これにより home とこのページが常に同一の週次チャレンジを表示し、二重生成を起こさない。
export const load: PageServerLoad = async ({ locals, parent }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { activeChallenge: null, history: [] };

	const [activeChallenge, history] = await Promise.all([
		getOrCreateWeeklyChildChallengeView(child.id, tenantId),
		getChildChallengeHistory(child.id, tenantId, 10),
	]);

	return { activeChallenge, history };
};
