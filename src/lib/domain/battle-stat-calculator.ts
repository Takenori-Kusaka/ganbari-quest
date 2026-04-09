/**
 * バトルステータス変換
 *
 * カテゴリ別XPをRPGバトルステータスに変換する。
 * XP値をベースに、ゲームバランスに適した数値にスケーリングする。
 */

import type { BattleStats, StatName } from './battle-types';
import { CATEGORY_TO_STAT } from './battle-types';

/**
 * XP → バトルステータス値に変換する。
 *
 * 変換式: stat = BASE + floor(xp^0.6)
 * - 0 XP → BASE (初期値)
 * - 100 XP → BASE + 15
 * - 500 XP → BASE + 46
 * - 1000 XP → BASE + 63
 * - 5000 XP → BASE + 168
 *
 * ゆるやかな曲線で、初期は成長を感じやすく、後半はインフレしにくい。
 */
function xpToStatValue(xp: number, base: number): number {
	if (xp <= 0) return base;
	return base + Math.floor(xp ** 0.6);
}

/** ステータスごとの基礎値（0 XP 時点の値） */
const BASE_STATS: Record<StatName, number> = {
	hp: 50,
	atk: 10,
	def: 8,
	spd: 10,
	rec: 5,
};

/**
 * カテゴリ別XPマップからバトルステータスに変換する。
 *
 * @param categoryXp カテゴリID → XP値のマップ（status-service.ts の statuses から取得）
 * @returns RPGバトルステータス
 */
export function convertToBattleStats(categoryXp: Record<number, number>): BattleStats {
	const stats: BattleStats = {
		hp: BASE_STATS.hp,
		atk: BASE_STATS.atk,
		def: BASE_STATS.def,
		spd: BASE_STATS.spd,
		rec: BASE_STATS.rec,
	};

	for (const [catIdStr, xp] of Object.entries(categoryXp)) {
		const catId = Number(catIdStr);
		const statName = CATEGORY_TO_STAT[catId];
		if (statName) {
			stats[statName] = xpToStatValue(xp, BASE_STATS[statName]);
		}
	}

	return stats;
}

/**
 * 年齢による敵ステータスのスケーリング係数。
 * baby/preschool はおさんぽモード（弱い敵）、elementary 以上で本格バトル。
 */
export function getAgeScaling(uiMode: string): number {
	switch (uiMode) {
		case 'baby':
			return 0.3;
		case 'preschool':
			return 0.5;
		case 'elementary':
			return 0.8;
		case 'junior':
			return 1.0;
		case 'senior':
			return 1.2;
		default:
			return 1.0;
	}
}
