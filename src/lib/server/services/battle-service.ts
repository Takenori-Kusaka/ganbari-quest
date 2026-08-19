import type { ChildId } from '$lib/domain/ids';
// src/lib/server/services/battle-service.ts
// バトルアドベンチャー サービス層

import { getEnemyById, selectDailyEnemy } from '$lib/domain/battle-enemies';
import { executeBattle, scaleEnemyStats } from '$lib/domain/battle-engine';
import { convertToBattleStats, getAgeScaling } from '$lib/domain/battle-stat-calculator';
import type { BattleResult, BattleStats, Enemy } from '$lib/domain/battle-types';
import { BATTLE_LEDGER_TYPE } from '$lib/domain/battle-types';
import { jstDayOfWeek, todayDateJST } from '$lib/domain/date-utils';
import {
	completeBattleAndGrantPoints,
	countConsecutiveLosses,
	findCollection,
	findRecentBattles,
	findTodayBattle,
	insertDailyBattle,
	upsertCollectionEntry,
} from '$lib/server/db/battle-repo';
import type {
	DailyBattleRow,
	EnemyCollectionRow,
} from '$lib/server/db/interfaces/battle-repo.interface';

// ============================================================
// 型定義
// ============================================================

/**
 * #4681: バトル報酬の point_ledger type (SSOT は `$lib/domain/battle-types`)。
 * repo の原子 primitive と共有するため domain に置き、ここから re-export する。
 */
export { BATTLE_LEDGER_TYPE };

export interface TodayBattleInfo {
	/** バトル ID（DB レコード） */
	battleId: string;
	/** 対戦相手の敵 */
	enemy: Enemy;
	/** プレイヤーのバトルステータス */
	playerStats: BattleStats;
	/** スケーリング後の敵最大HP（UI表示用） */
	scaledEnemyMaxHp: number;
	/** バトル済みか */
	completed: boolean;
	/** バトル結果（完了時のみ） */
	result: {
		outcome: 'win' | 'lose';
		rewardPoints: number;
		turnsUsed: number;
	} | null;
}

export interface BattleExecutionResult {
	battleResult: BattleResult;
	rewardPoints: number;
	enemy: Enemy;
}

export interface CollectionEntry {
	enemy: Enemy;
	firstDefeatedAt: string;
	defeatCount: number;
}

// ============================================================
// 公開API
// ============================================================

/**
 * 今日のバトル情報を取得する。
 * 未登録ならバトルを生成して返す。
 */
export async function getTodayBattle(
	childId: ChildId,
	uiMode: string,
	categoryXp: Record<string, number>,
	tenantId: string,
): Promise<TodayBattleInfo> {
	const today = todayDateJST();
	let battle = await findTodayBattle(childId, today, tenantId);

	if (!battle) {
		// 新しいバトルを生成
		const consecutiveLosses = await countConsecutiveLosses(childId, tenantId);
		// 曜日は JST SSOT 経由 (#4015)。同 function の `today` は todayDateJST() なので、
		// ローカル getter のままだと UTC runtime で「日付は今日 / 敵は前日の曜日」が混在していた。
		const dayOfWeek = jstDayOfWeek();
		const enemy = selectDailyEnemy(dayOfWeek, Math.random(), consecutiveLosses);
		const playerStats = convertToBattleStats(categoryXp);

		try {
			const battleId = await insertDailyBattle(childId, enemy.id, today, playerStats, tenantId);
			battle = {
				id: battleId,
				childId,
				enemyId: enemy.id,
				date: today,
				status: 'pending',
				outcome: null,
				rewardPoints: 0,
				turnsUsed: 0,
				playerStatsJson: JSON.stringify(playerStats),
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			} satisfies DailyBattleRow;
		} catch {
			// UNIQUE 制約違反（並行リクエスト）→ 再取得
			battle = await findTodayBattle(childId, today, tenantId);
			if (!battle) throw new Error('Failed to create or find today battle');
		}
	}

	const enemy = getEnemyById(battle.enemyId);
	if (!enemy) {
		throw new Error(`Enemy not found: ${battle.enemyId}`);
	}

	const playerStats: BattleStats = JSON.parse(battle.playerStatsJson);
	const scaling = getAgeScaling(uiMode);
	const scaledEnemyStats = scaleEnemyStats(enemy.stats, scaling);

	return {
		battleId: battle.id,
		enemy,
		playerStats,
		scaledEnemyMaxHp: scaledEnemyStats.hp,
		completed: battle.status === 'completed',
		result:
			battle.status === 'completed' && battle.outcome
				? {
						outcome: battle.outcome as 'win' | 'lose',
						rewardPoints: battle.rewardPoints,
						turnsUsed: battle.turnsUsed,
					}
				: null,
	};
}

/**
 * バトルを実行する。
 * サーバ側で今日の pending バトルを再取得し、battleId/enemyId の整合性を検証する。
 */
export async function executeDailyBattle(
	childId: ChildId,
	uiMode: string,
	categoryXp: Record<string, number>,
	tenantId: string,
): Promise<BattleExecutionResult> {
	const today = todayDateJST();
	const battle = await findTodayBattle(childId, today, tenantId);

	if (!battle) {
		throw new Error('今日のバトルが見つかりません');
	}
	if (battle.status === 'completed') {
		throw new Error('今日のバトルは既に完了しています');
	}

	const enemy = getEnemyById(battle.enemyId);
	if (!enemy) {
		throw new Error(`Enemy not found: ${battle.enemyId}`);
	}

	const playerStats = convertToBattleStats(categoryXp);
	const scaling = getAgeScaling(uiMode);
	const scaledEnemyStats = scaleEnemyStats(enemy.stats, scaling);

	const battleResult = executeBattle(playerStats, scaledEnemyStats);

	// 報酬計算
	const rewardPoints = battleResult.outcome === 'win' ? enemy.dropPoints : enemy.consolationPoints;
	battleResult.rewardPoints = rewardPoints;

	// DB 更新 + 報酬付与 (#4681)
	//
	// 画面「+N ポイント」と残高を一致させる。`daily_battles.reward_points` は結果表示用の
	// snapshot であり、残高の正は point_ledger (SUM / total_point) なので台帳に計上しなければ
	// 「表示されるが一度も加算されない」になる。付与額は rewardPoints そのもの (別計算を持たない)。
	//
	// 完了 flip と付与は **単一 txn の原子 primitive** で行う (#3284/#3342 の claim と同型)。
	// 2 段に分けると ledger 失敗時に「完了済み + 付与 0」= 二度と取り返せない lost-award になる。
	const flipped = await completeBattleAndGrantPoints(
		battle.id,
		battleResult.outcome,
		rewardPoints,
		battleResult.totalTurns,
		{
			childId,
			amount: rewardPoints,
			description: `[${today}] バトル${battleResult.outcome === 'win' ? 'しょうり' : 'なぐさめ'} ${enemy.name}`,
		},
		tenantId,
	);
	if (flipped !== 1) {
		// 並行 2 連打で他方が先に完了させた (status が pending でなくなった)。
		throw new Error('今日のバトルは既に完了しています');
	}

	// 勝利時は図鑑に記録
	if (battleResult.outcome === 'win') {
		await upsertCollectionEntry(childId, battle.enemyId, tenantId);
	}

	return {
		battleResult,
		rewardPoints,
		enemy,
	};
}

/**
 * 敵図鑑を取得する。
 */
async function _getEnemyCollection(childId: ChildId, tenantId: string): Promise<CollectionEntry[]> {
	const rows = await findCollection(childId, tenantId);
	return rows
		.map((row: EnemyCollectionRow) => {
			const enemy = getEnemyById(row.enemyId);
			if (!enemy) return null;
			return {
				enemy,
				firstDefeatedAt: row.firstDefeatedAt,
				defeatCount: row.defeatCount,
			};
		})
		.filter((e): e is CollectionEntry => e !== null);
}

/**
 * バトル履歴を取得する。
 */
async function _getBattleHistory(
	childId: ChildId,
	limit: number,
	tenantId: string,
): Promise<
	Array<{
		date: string;
		enemy: Enemy | null;
		outcome: 'win' | 'lose' | null;
		rewardPoints: number;
	}>
> {
	const battles = await findRecentBattles(childId, limit, tenantId);
	return battles.map((b: DailyBattleRow) => ({
		date: b.date,
		enemy: getEnemyById(b.enemyId) ?? null,
		outcome: b.outcome as 'win' | 'lose' | null,
		rewardPoints: b.rewardPoints,
	}));
}
