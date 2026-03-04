import { logger } from '$lib/server/logger';
import { getAllChildren } from '$lib/server/services/child-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getChildStatus } from '$lib/server/services/status-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const children = getAllChildren();

	const childrenWithStatus = children.map((child) => {
		const balance = getPointBalance(child.id);
		const status = getChildStatus(child.id);
		if ('error' in balance) {
			logger.warn('[admin] ポイント取得フォールバック', { context: { childId: child.id, error: balance.error } });
		}
		if ('error' in status) {
			logger.warn('[admin] ステータス取得フォールバック', { context: { childId: child.id, error: status.error } });
		}
		return {
			...child,
			balance: 'error' in balance ? 0 : balance.balance,
			level: 'error' in status ? 1 : status.level,
			levelTitle: 'error' in status ? '' : status.levelTitle,
		};
	});

	return { children: childrenWithStatus };
};
