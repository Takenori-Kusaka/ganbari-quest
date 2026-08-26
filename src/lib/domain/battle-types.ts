/**
 * バトルアドベンチャー — ドメイン型定義
 *
 * 子供の日々の活動がRPGステータスに反映され、毎日の敵とバトルする機能。
 * カテゴリ別XPをRPGステータスに変換し、ターン制自動バトルで勝敗を決する。
 */
import type { CategoryCode } from '$lib/domain/categories';
import type { ChildId } from '$lib/domain/ids';

// ============================================================
// RPG ステータス
// ============================================================

/** RPGステータス名 */
export type StatName = 'hp' | 'atk' | 'def' | 'spd' | 'rec';

/** カテゴリ code → RPGステータスのマッピング (#3575: id は opaque のため code を key にする) */
export const CATEGORY_TO_STAT: Record<CategoryCode, StatName> = {
	undou: 'hp', // うんどう → HP（体力）
	benkyou: 'atk', // べんきょう → ATK（攻撃力）
	seikatsu: 'spd', // せいかつ → SPD（素早さ）
	kouryuu: 'def', // こうりゅう → DEF（防御力）
	souzou: 'rec', // そうぞう → REC（回復力）
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
	/** 敵キャラクター画像パス（/assets/battle/enemies/ 配下） */
	image: string;
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
// runtime 配列は DSQL daily_battles.outcome の CHECK 生成 SSOT (#3424、手書き二重化禁止)
export const BATTLE_OUTCOMES = ['win', 'lose'] as const;
export type BattleOutcome = (typeof BATTLE_OUTCOMES)[number];

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
// runtime 配列は DSQL daily_battles.status の CHECK 生成 SSOT (#3424)
export const DAILY_BATTLE_STATUSES = ['pending', 'completed'] as const;
export type DailyBattleStatus = (typeof DAILY_BATTLE_STATUSES)[number];

/** 日次バトル記録 */
export interface DailyBattle {
	id: string;
	childId: ChildId;
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

// ============================================================
// ポイント台帳
// ============================================================

/**
 * #4681: バトル報酬の `point_ledger.type`。勝利 = `enemy.dropPoints` / 敗北 =
 * `enemy.consolationPoints` を本 type で計上する (設計書 26 §4c)。
 * repo (完了 flip + 付与の原子 primitive) と service の両方が参照するため domain に置く。
 */
export const BATTLE_LEDGER_TYPE = 'battle';
