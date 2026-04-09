/**
 * バトルアドベンチャー — ドメイン型定義
 *
 * 子供の日々の活動がRPGステータスに反映され、毎日の敵とバトルする機能。
 * カテゴリ別XPをRPGステータスに変換し、ターン制自動バトルで勝敗を決する。
 */

// ============================================================
// RPG ステータス
// ============================================================

/** RPGステータス名 */
export type StatName = 'hp' | 'atk' | 'def' | 'spd' | 'rec';

/** カテゴリID → RPGステータスのマッピング */
export const CATEGORY_TO_STAT: Record<number, StatName> = {
	1: 'hp', // うんどう → HP（体力）
	2: 'atk', // べんきょう → ATK（攻撃力）
	3: 'spd', // せいかつ → SPD（素早さ）
	4: 'def', // こうりゅう → DEF（防御力）
	5: 'rec', // そうぞう → REC（回復力）
};

/** RPGステータスの日本語名 */
export const STAT_LABELS: Record<StatName, string> = {
	hp: 'たいりょく',
	atk: 'こうげき',
	def: 'ぼうぎょ',
	spd: 'すばやさ',
	rec: 'かいふく',
};

/** RPGバトルステータス */
export interface BattleStats {
	hp: number;
	atk: number;
	def: number;
	spd: number;
	rec: number;
}

// ============================================================
// 敵
// ============================================================

/** 敵のレアリティ */
export type EnemyRarity = 'common' | 'uncommon' | 'rare' | 'boss';

/** 敵マスタデータ */
export interface Enemy {
	id: number;
	name: string;
	icon: string;
	rarity: EnemyRarity;
	stats: BattleStats;
	/** ドロップポイント（勝利時） */
	dropPoints: number;
	/** 慰めポイント（敗北時） */
	consolationPoints: number;
	/** 出現曜日（0=日〜6=土、空配列=毎日） */
	availableDays: number[];
}

// ============================================================
// バトル結果
// ============================================================

/** 1ターンのログ */
export interface BattleTurnLog {
	turn: number;
	/** 先制したのはプレイヤーか敵か */
	firstAttacker: 'player' | 'enemy';
	playerAction: TurnAction;
	enemyAction: TurnAction;
	playerHpAfter: number;
	enemyHpAfter: number;
}

/** 1ターンのアクション */
export interface TurnAction {
	type: 'attack' | 'recover';
	damage: number;
	critical: boolean;
}

/** バトル結果 */
export type BattleOutcome = 'win' | 'lose';

/** バトル結果データ */
export interface BattleResult {
	outcome: BattleOutcome;
	turns: BattleTurnLog[];
	totalTurns: number;
	rewardPoints: number;
	/** プレイヤーの最終HP */
	playerFinalHp: number;
	/** 敵の最終HP */
	enemyFinalHp: number;
}

// ============================================================
// 日次バトル
// ============================================================

/** 日次バトル状態 */
export type DailyBattleStatus = 'pending' | 'completed';

/** 日次バトル記録 */
export interface DailyBattle {
	id: number;
	childId: number;
	enemyId: number;
	date: string;
	status: DailyBattleStatus;
	outcome: BattleOutcome | null;
	rewardPoints: number;
	turnsUsed: number;
	playerStats: BattleStats;
}

// ============================================================
// 敵図鑑
// ============================================================

/** 敵図鑑エントリ */
export interface EnemyCollectionEntry {
	enemyId: number;
	firstDefeatedAt: string;
	defeatCount: number;
}
