import { getAllChildren } from '$lib/server/services/child-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getChildStatus } from '$lib/server/services/status-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const children = getAllChildren();

	const childrenWithStatus = children.map((child) => {
		const balance = getPointBalance(child.id);
		const status = getChildStatus(child.id);
		return {
			...child,
			balance: 'error' in balance ? 0 : balance.balance,
			level: 'error' in status ? 1 : status.level,
			levelTitle: 'error' in status ? '' : status.levelTitle,
		};
	});

	return { children: childrenWithStatus };
};
