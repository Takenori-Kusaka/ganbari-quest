import { getActivityLogs } from '$lib/server/services/activity-log-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { child } = await parent();
	if (!child) return { logs: [] };

	// baby は直近7日分のみ表示
	const now = new Date();
	const to = now.toISOString().slice(0, 10);
	const from = new Date(now);
	from.setDate(from.getDate() - 7);
	const result = getActivityLogs(child.id, { from: from.toISOString().slice(0, 10), to });

	return { logs: result.logs };
};
