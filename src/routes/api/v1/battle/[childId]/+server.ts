import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { validationError } from '$lib/server/errors';
import { executeDailyBattle, getTodayBattle } from '$lib/server/services/battle-service';
import { getChildStatus } from '$lib/server/services/status-service';
import type { RequestHandler } from './$types';

/** GET: 今日のバトル情報を取得 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const statusResult = await getChildStatus(childId, tenantId);
	if ('error' in statusResult) {
		return validationError('ステータスが見つかりません');
	}

	// カテゴリ別 XP マップを構築
	const categoryXp: Record<number, number> = {};
	for (const [catId, detail] of Object.entries(statusResult.statuses)) {
		categoryXp[Number(catId)] = detail.value;
	}

	const battle = await getTodayBattle(childId, 'kinder', categoryXp, tenantId);
	return json(battle);
};

/** POST: バトルを実行 */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const body = await request.json();
	const { battleId, enemyId, uiMode } = body as {
		battleId: number;
		enemyId: number;
		uiMode: string;
	};

	if (!battleId || !enemyId) {
		return validationError('battleId と enemyId は必須です');
	}

	const statusResult = await getChildStatus(childId, tenantId);
	if ('error' in statusResult) {
		return validationError('ステータスが見つかりません');
	}

	const categoryXp: Record<number, number> = {};
	for (const [catId, detail] of Object.entries(statusResult.statuses)) {
		categoryXp[Number(catId)] = detail.value;
	}

	const result = await executeDailyBattle(
		battleId,
		childId,
		enemyId,
		uiMode ?? 'kinder',
		categoryXp,
		tenantId,
	);

	return json(result);
};
