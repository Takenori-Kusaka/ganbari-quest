import type { BattleOutcome, BattleStats } from '$lib/domain/battle-types';
import type { ChildId } from '$lib/domain/ids';

export interface DailyBattleRow {
	id: string;
	childId: ChildId;
	enemyId: number;
	date: string;
	status: 'pending' | 'completed';
	outcome: BattleOutcome | null;
	rewardPoints: number;
	turnsUsed: number;
	playerStatsJson: string;
	createdAt: string;
	updatedAt: string;
}

export interface EnemyCollectionRow {
	id: string;
	childId: ChildId;
	enemyId: number;
	firstDefeatedAt: string;
	defeatCount: number;
}

export interface IBattleRepo {
	findTodayBattle(
		childId: ChildId,
		date: string,
		tenantId: string,
	): Promise<DailyBattleRow | undefined>;

	findRecentBattles(childId: ChildId, limit: number, tenantId: string): Promise<DailyBattleRow[]>;

	countConsecutiveLosses(childId: ChildId, tenantId: string): Promise<number>;

	insertDailyBattle(
		childId: ChildId,
		enemyId: number,
		date: string,
		playerStats: BattleStats,
		tenantId: string,
	): Promise<string>;

	completeBattle(
		battleId: string,
		outcome: BattleOutcome,
		rewardPoints: number,
		turnsUsed: number,
		tenantId: string,
	): Promise<void>;

	/**
	 * #4681: バトル完了 flip と報酬 ledger 書込を **単一 txn** で行う (原子 primitive)。
	 *
	 * `status='pending'` の行だけを `completed` に flip し、flip が成立したときに限り
	 * `point_ledger` (type='battle', reference_id=battleId) を同一 txn で INSERT する。
	 * 2 段に分けると「完了済み + 付与 0」= lost-award (顧客から見て「勝ったのに増えない」) が
	 * 残るため、child_challenge の claimRewardAndGrantPoints (#3284/#3342) と同型にする。
	 *
	 * @param ledger amount = 0 のときは ledger を書かない (flip のみ)
	 * @returns flip した行数 (1 = 完了 + 付与、0 = 既に完了済み or 不在)
	 */
	completeBattleAndGrantPoints(
		battleId: string,
		result: { outcome: BattleOutcome; rewardPoints: number; turnsUsed: number },
		ledger: { childId: ChildId; amount: number; description: string },
		tenantId: string,
	): Promise<number>;

	findCollection(childId: ChildId, tenantId: string): Promise<EnemyCollectionRow[]>;

	upsertCollectionEntry(childId: ChildId, enemyId: number, tenantId: string): Promise<void>;
}
