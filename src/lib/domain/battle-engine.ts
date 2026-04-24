/**
 * バトルエンジン
 *
 * ターン制自動バトルのコアロジック。
 * プレイヤーと敵のステータスを受け取り、バトル結果を返す。
 *
 * 設計方針:
 * - 活動を 1 つでもやれば勝率 70% 以上
 * - 活動 0 の日は確実に負ける（BASE_STATS のみ）
 * - 3〜5 ターンで決着
 * - baby/preschool は「おさんぽモード」（必ず勝利）
 */

import type {
	BattleOutcome,
	BattleResult,
	BattleStats,
	BattleTurnLog,
	TurnAction,
} from './battle-types';

/** バトル設定 */
interface BattleConfig {
	/** 最大ターン数 */
	maxTurns: number;
	/** クリティカル率（0〜1） */
	criticalRate: number;
	/** クリティカル倍率 */
	criticalMultiplier: number;
	/** ダメージの乱数幅（±この値の割合） */
	damageVariance: number;
	/** おさんぽモード（必ず勝利） */
	walkMode: boolean;
}

const DEFAULT_CONFIG: BattleConfig = {
	maxTurns: 5,
	criticalRate: 0.1,
	criticalMultiplier: 1.5,
	damageVariance: 0.15,
	walkMode: false,
};

/**
 * ダメージ計算。
 *
 * 基本式: max(1, ATK - DEF/2) × 乱数 × クリティカル
 * DEF が高くても最低 1 ダメージは通る。
 */
function calculateDamage(
	atk: number,
	def: number,
	random: () => number,
	config: BattleConfig,
): { damage: number; critical: boolean } {
	const baseDamage = Math.max(1, atk - Math.floor(def / 2));
	const variance = 1 + (random() * 2 - 1) * config.damageVariance;
	const critical = random() < config.criticalRate;
	const multiplier = critical ? config.criticalMultiplier : 1;
	const damage = Math.max(1, Math.floor(baseDamage * variance * multiplier));
	return { damage, critical };
}

/**
 * 先攻判定。SPD が高い方が先攻。同値なら 50:50。
 */
function determineFirstAttacker(
	playerSpd: number,
	enemySpd: number,
	random: () => number,
): 'player' | 'enemy' {
	if (playerSpd > enemySpd) return 'player';
	if (enemySpd > playerSpd) return 'enemy';
	return random() < 0.5 ? 'player' : 'enemy';
}

/**
 * 回復量計算。REC の 30% を HP 回復（端数切り捨て）。
 * 回復は攻撃と二択ではなく、ターン開始時に自動適用。
 */
function calculateRecovery(rec: number): number {
	return Math.floor(rec * 0.3);
}

/**
 * おさんぽモード用の弱体化ステータスを生成。
 * 敵の ATK を大幅に下げ、HP も低くして必ず勝てるようにする。
 */
function applyWalkModeScaling(enemyStats: BattleStats): BattleStats {
	return {
		hp: Math.max(1, Math.floor(enemyStats.hp * 0.2)),
		atk: 1,
		def: 1,
		spd: 1,
		rec: 0,
	};
}

/**
 * 年齢スケーリングを敵ステータスに適用する。
 */
export function scaleEnemyStats(baseStats: BattleStats, scaling: number): BattleStats {
	return {
		hp: Math.max(1, Math.floor(baseStats.hp * scaling)),
		atk: Math.max(1, Math.floor(baseStats.atk * scaling)),
		def: Math.max(1, Math.floor(baseStats.def * scaling)),
		spd: Math.max(1, Math.floor(baseStats.spd * scaling)),
		rec: Math.max(0, Math.floor(baseStats.rec * scaling)),
	};
}

/**
 * バトルを実行する。
 *
 * @param playerStats プレイヤーのバトルステータス
 * @param enemyStats 敵のバトルステータス（スケーリング適用済み）
 * @param options バトルオプション
 * @returns バトル結果
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
export function executeBattle(
	playerStats: BattleStats,
	enemyStats: BattleStats,
	options: {
		walkMode?: boolean;
		random?: () => number;
		maxTurns?: number;
	} = {},
): BattleResult {
	const random = options.random ?? Math.random;
	const config: BattleConfig = {
		...DEFAULT_CONFIG,
		walkMode: options.walkMode ?? false,
		maxTurns: options.maxTurns ?? DEFAULT_CONFIG.maxTurns,
	};

	// おさんぽモードでは敵を大幅弱体化
	const effectiveEnemyStats = config.walkMode ? applyWalkModeScaling(enemyStats) : enemyStats;

	let playerHp = playerStats.hp;
	let enemyHp = effectiveEnemyStats.hp;
	const turns: BattleTurnLog[] = [];

	for (let turn = 1; turn <= config.maxTurns; turn++) {
		// ターン開始時の回復（1ターン目は回復なし）
		if (turn > 1) {
			const playerRecovery = calculateRecovery(playerStats.rec);
			const enemyRecovery = calculateRecovery(effectiveEnemyStats.rec);
			playerHp = Math.min(playerStats.hp, playerHp + playerRecovery);
			enemyHp = Math.min(effectiveEnemyStats.hp, enemyHp + enemyRecovery);
		}

		// 先攻判定
		const firstAttacker = determineFirstAttacker(playerStats.spd, effectiveEnemyStats.spd, random);

		let playerAction: TurnAction;
		let enemyAction: TurnAction;

		if (firstAttacker === 'player') {
			// プレイヤー先攻
			const pAtk = calculateDamage(playerStats.atk, effectiveEnemyStats.def, random, config);
			enemyHp = Math.max(0, enemyHp - pAtk.damage);
			playerAction = { type: 'attack', damage: pAtk.damage, critical: pAtk.critical };

			// 敵が倒れていなければ反撃
			if (enemyHp > 0) {
				const eAtk = calculateDamage(effectiveEnemyStats.atk, playerStats.def, random, config);
				playerHp = Math.max(0, playerHp - eAtk.damage);
				enemyAction = { type: 'attack', damage: eAtk.damage, critical: eAtk.critical };
			} else {
				enemyAction = { type: 'attack', damage: 0, critical: false };
			}
		} else {
			// 敵先攻
			const eAtk = calculateDamage(effectiveEnemyStats.atk, playerStats.def, random, config);
			playerHp = Math.max(0, playerHp - eAtk.damage);
			enemyAction = { type: 'attack', damage: eAtk.damage, critical: eAtk.critical };

			// プレイヤーが倒れていなければ反撃
			if (playerHp > 0) {
				const pAtk = calculateDamage(playerStats.atk, effectiveEnemyStats.def, random, config);
				enemyHp = Math.max(0, enemyHp - pAtk.damage);
				playerAction = { type: 'attack', damage: pAtk.damage, critical: pAtk.critical };
			} else {
				playerAction = { type: 'attack', damage: 0, critical: false };
			}
		}

		turns.push({
			turn,
			firstAttacker,
			playerAction,
			enemyAction,
			playerHpAfter: playerHp,
			enemyHpAfter: enemyHp,
		});

		// どちらかが倒れたら終了
		if (playerHp <= 0 || enemyHp <= 0) break;
	}

	// 勝敗判定
	let outcome: BattleOutcome;
	if (enemyHp <= 0) {
		outcome = 'win';
	} else if (playerHp <= 0) {
		outcome = 'lose';
	} else {
		// ターン切れ: HP 割合の高い方が勝ち
		const playerHpRatio = playerHp / playerStats.hp;
		const enemyHpRatio = enemyHp / effectiveEnemyStats.hp;
		outcome = playerHpRatio >= enemyHpRatio ? 'win' : 'lose';
	}

	// おさんぽモードは常に勝利
	if (config.walkMode) {
		outcome = 'win';
	}

	return {
		outcome,
		turns,
		totalTurns: turns.length,
		rewardPoints: 0, // サービス層で計算
		playerFinalHp: playerHp,
		enemyFinalHp: enemyHp,
	};
}
