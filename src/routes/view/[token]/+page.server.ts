// /view/[token] — 閲覧専用リンクのサーバーロード (#371)
// 認証不要。トークンの有効性のみ検証。

import { error } from '@sveltejs/kit';
import { getAllChildren } from '$lib/server/services/child-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getChildStatus } from '$lib/server/services/status-service';
import { resolveViewerToken } from '$lib/server/services/viewer-token-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const viewer = await resolveViewerToken(params.token);
	if (!viewer) {
		error(404, 'このリンクは無効か、期限切れです');
	}

	const tenantId = viewer.tenantId;
	const children = await getAllChildren(tenantId);

	const childrenData = await Promise.all(
		children.map(async (child) => {
			const [balance, statusResult] = await Promise.all([
				getPointBalance(child.id, tenantId),
				getChildStatus(child.id, tenantId),
			]);

			if ('error' in statusResult) {
				return {
					nickname: child.nickname,
					age: child.age,
					totalPoints: balance,
					totalLevel: 0,
					statuses: [] as { categoryId: number; level: number; totalXp: number }[],
				};
			}

			const statusEntries = Object.entries(statusResult.statuses).map(([catId, s]) => ({
				categoryId: Number(catId),
				level: s.level,
				totalXp: s.value,
			}));
			const totalLevel = statusEntries.reduce((sum, s) => sum + s.level, 0);

			return {
				nickname: child.nickname,
				age: child.age,
				totalPoints: balance,
				totalLevel,
				statuses: statusEntries,
			};
		}),
	);

	return {
		label: viewer.label,
		childrenData,
	};
};
