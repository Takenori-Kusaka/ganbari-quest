import { z } from 'zod';
import { AGE_TIER_LABELS } from '../labels';
import type { UiMode } from './age-tier-types';
import { LEGACY_UI_MODE_MAP, UI_MODES } from './age-tier-types';

export type { UiMode } from './age-tier-types';
// 型・定数・正規化関数は age-tier-types.ts に集約（#980: 循環依存解消）
// 既存の import path を維持するため re-export する
// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { LEGACY_UI_MODE_MAP, normalizeUiMode, UI_MODES } from './age-tier-types';

// Zod スキーマ
export const uiModeSchema = z.enum(UI_MODES);

// 年齢帯設定
export const AGE_TIER_CONFIG: Record<
	UiMode,
	{
		label: string;
		ageMin: number;
		ageMax: number;
		tapSize: number;
		fontScale: number;
	}
> = {
	baby: { label: AGE_TIER_LABELS.baby, ageMin: 0, ageMax: 2, tapSize: 120, fontScale: 1.5 },
	preschool: {
		label: AGE_TIER_LABELS.preschool,
		ageMin: 3,
		ageMax: 5,
		tapSize: 80,
		fontScale: 1.2,
	},
	elementary: {
		label: AGE_TIER_LABELS.elementary,
		ageMin: 6,
		ageMax: 12,
		tapSize: 56,
		fontScale: 1.0,
	},
	junior: {
		label: AGE_TIER_LABELS.junior,
		ageMin: 13,
		ageMax: 15,
		tapSize: 48,
		fontScale: 1.0,
	},
	senior: {
		label: AGE_TIER_LABELS.senior,
		ageMin: 16,
		ageMax: 18,
		tapSize: 44,
		fontScale: 1.0,
	},
};

/**
 * #4685 (ADR-0011): 年齢帯ごとの「ゲーミフィケーション機能を出すか」の SSOT。
 *
 * baby は **親の準備モード**であり、子供向けゲーミフィケーション (ポイント消費 / 収集 / 競争) を
 * 適用しない。判定を各画面の `if (uiMode === 'baby')` に散らすと、今回のように 1 箇所
 * (ごほうびショップ / ヘッダーのスタンプ / きょうだいランキング) だけ漏れる。**追加する機能は
 * ここに 1 行足してから画面で参照する**。
 */
export interface AgeTierCapabilities {
	/** ごほうびショップ (ポイントを使う画面 + 交換申請) */
	rewardShop: boolean;
	/** ログインスタンプカード (収集) */
	stampCard: boolean;
	/** きょうだいランキング (競争) の集計対象に含めるか */
	siblingRanking: boolean;
	/** 日次バトル */
	battle: boolean;
}

export const AGE_TIER_CAPABILITIES: Record<UiMode, AgeTierCapabilities> = {
	// 準備モード: 親が記録の下ごしらえをする画面。ゲーミフィケーションは一切出さない
	baby: { rewardShop: false, stampCard: false, siblingRanking: false, battle: false },
	// battle は #1323 / #1491 の方針で preschool にも出さない (route も 404)
	preschool: { rewardShop: true, stampCard: true, siblingRanking: true, battle: false },
	elementary: { rewardShop: true, stampCard: true, siblingRanking: true, battle: true },
	junior: { rewardShop: true, stampCard: true, siblingRanking: true, battle: true },
	senior: { rewardShop: true, stampCard: true, siblingRanking: true, battle: true },
};

/**
 * 年齢帯がその機能を持つか。未知の uiMode は**安全側 (持たない)** に倒す
 * (新モード追加時に上表へ足し忘れたら、機能が漏れ出すのではなく出なくなる)。
 */
export function hasAgeTierCapability(
	uiMode: string,
	capability: keyof AgeTierCapabilities,
): boolean {
	return AGE_TIER_CAPABILITIES[uiMode as UiMode]?.[capability] ?? false;
}

/** 年齢から推定されるデフォルトUIモードを返す */
export function getDefaultUiMode(age: number): UiMode {
	if (age <= 2) return 'baby';
	if (age <= 5) return 'preschool';
	if (age <= 12) return 'elementary';
	if (age <= 15) return 'junior';
	return 'senior';
}

/**
 * #4718: 登録時に明示指定された uiMode が年齢既定と異なるか (= 保護者の意図的な上書き)。
 * 登録経路 (insertChild) はこの判定で ui_mode_manually_set を初期化する。年齢既定と同じ値の
 * 明示指定 (backup 復元の大半) は自動扱いのまま残し、年齢帯境界の自動遷移を殺さない。
 * pg-core backend は ui_mode を compute-on-read (manually_set=false なら年齢から再導出) する
 * ため、この初期化が無いと明示指定が読み出しで消え sqlite と食い違う (parity fitness #4419)。
 */
export function isExplicitUiModeOverride(age: number, uiMode: string | undefined): boolean {
	return uiMode !== undefined && uiMode !== getDefaultUiMode(age);
}

/**
 * uiModeManuallySet フラグを考慮して、年齢変更時の UIMode を決定する。
 * フラグが立っている場合は保護者が手動設定した値を維持する。
 */
export function recalcUiMode(
	child: { uiMode: UiMode; uiModeManuallySet: number },
	newAge: number,
): UiMode {
	if (child.uiModeManuallySet) return child.uiMode;
	return getDefaultUiMode(newAge);
}

/** 値が有効なUIモードか判定する（旧コード含む） */
export function isValidUiMode(value: string): value is UiMode {
	return UI_MODES.includes(value as UiMode) || value in LEGACY_UI_MODE_MAP;
}
