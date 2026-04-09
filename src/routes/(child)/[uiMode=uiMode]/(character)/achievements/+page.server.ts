import { requireTenantId } from '$lib/server/auth/factory';
import {
	getChallengeHistory,
	getOrCreateWeeklyChallenge,
} from '$lib/server/services/auto-challenge-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { activeChallenge: null, history: [] };

	const [activeChallenge, history] = await Promise.all([
		getOrCreateWeeklyChallenge(child.id, tenantId),
		getChallengeHistory(child.id, tenantId, 10),
	]);

	return { activeChallenge, history };
};
