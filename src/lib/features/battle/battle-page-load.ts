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
	const { child } = await parent();
	if (!child) return { battle: null };

	// ADR-0039 Phase 2 (#2097): デモ実行モード時は demo-service の battle data を返す。
	// 本番 type と整合させるため battleId を 0 (fake) で付与する (demo は DB に書かないので
	// 実 battleId は不要、子供画面では action 経由でしか使われない)。
	if (locals.isDemo) {
		const { getDemoBattleData } = await import('$lib/server/demo/demo-service');
		const demoBattle = getDemoBattleData(child.id);
		if (!demoBattle.battle) return { battle: null };
		return {
			battle: {
				battleId: 0,
				enemy: demoBattle.battle.enemy,
				playerStats: demoBattle.battle.playerStats,
				scaledEnemyMaxHp: demoBattle.battle.scaledEnemyMaxHp,
				completed: demoBattle.battle.completed,
				result: demoBattle.battle.result,
			},
		};
	}

	const tenantId = requireTenantId(locals);
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
