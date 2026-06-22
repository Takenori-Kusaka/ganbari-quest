import { requireTenantId } from '$lib/server/auth/factory';
import { getWeeklyChildChallengeView } from '$lib/server/services/child-challenge-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { activeChallenge: null, history: [] };

	// #3213: auto_challenges 廃止。child_challenges (sourceTemplateId='auto:weekly') から取得。
	return getWeeklyChildChallengeView(child.id, tenantId, 10);
};
