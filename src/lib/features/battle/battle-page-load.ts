/**
 * バトルページ共通の load ロジック。
 * 各年齢モードの +page.server.ts から呼び出す。
 */
import { requireTenantId } from '$lib/server/auth/factory';
import { getTodayBattle } from '$lib/server/services/battle-service';
import { getChildStatus } from '$lib/server/services/status-service';

export async function loadBattlePage(
	parent: () => Promise<{ child: { id: number; uiMode: string } | null }>,
	locals: App.Locals,
) {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) return { battle: null };

	const statusResult = await getChildStatus(child.id, tenantId);
	if ('error' in statusResult) {
		return { battle: null };
	}

	const categoryXp: Record<number, number> = {};
	for (const [catId, detail] of Object.entries(statusResult.statuses)) {
		categoryXp[Number(catId)] = detail.value;
	}

	const battle = await getTodayBattle(child.id, child.uiMode, categoryXp, tenantId);

	return {
		battle: {
			battleId: battle.battleId,
			enemy: battle.enemy,
			playerStats: battle.playerStats,
			scaledEnemyMaxHp: battle.scaledEnemyMaxHp,
			completed: battle.completed,
			result: battle.result,
		},
	};
}
