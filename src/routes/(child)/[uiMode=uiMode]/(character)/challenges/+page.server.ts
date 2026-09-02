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
export const load: PageServerLoad = async ({ locals, params, parent }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { activeChallenge: null, history: [] };

	// #4690 F2: 表示文言 (カテゴリ名 / 理由文) は年齢帯で文体が変わるため uiMode を渡す。
	const [activeChallenge, history] = await Promise.all([
		getOrCreateWeeklyChildChallengeView(child.id, tenantId, params.uiMode),
		getChildChallengeHistory(child.id, tenantId, params.uiMode, 10),
	]);

	return { activeChallenge, history };
};
