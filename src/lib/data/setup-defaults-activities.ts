// 活動・ポイント設定の sensible defaults — setup フローで一括投入 (#2322)
//
// Issue #2322 (EPIC #2319 ③): マーケプレ rule-preset 集約 (PO 提案) を Research が否定したため、
// 代替案 A として **setup フローに sensible defaults を hard-code する** パターンを採用。
// Challenges EPIC #2298 と同パターン (setup 任意 step + skip 可、ADR-0012 anti-engagement 整合)。
//
// 各 default 値の根拠:
// - decayIntensity='normal': 既定 (実画面の DECAY_OPTIONS デフォルト値と同期)
// - pointMode='point': 通貨換算は上級者向けなので「ポイント」表示を初期推奨
// - siblingRankingEnabled=false: family プラン限定機能、free / standard では gate される
//   (#3195: 競争モード sibling_mode は撤去。チャレンジはアプリ自動生成・協力固定)
//
// ADR-0014 整合: 既存パターン継承、新規 OSS 不要

import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';

export interface ActivitiesSettingsDefaults {
	/** ステータス減少の強さ ('none' | 'gentle' | 'normal' | 'strict') */
	decayIntensity: 'none' | 'gentle' | 'normal' | 'strict';
	/** ポイント表示モード ('point' | 'currency') */
	pointMode: PointUnitMode;
	/** 通貨コード (currency モード時のみ参照) */
	pointCurrency: CurrencyCode;
	/** ポイント → 通貨換算レート */
	pointRate: number;
	/** きょうだいランキング表示 (family 限定、setup 時は OFF) */
	siblingRankingEnabled: boolean;
}

export const ACTIVITIES_SETTINGS_DEFAULTS: ActivitiesSettingsDefaults = {
	decayIntensity: 'normal',
	pointMode: 'point',
	pointCurrency: 'JPY',
	pointRate: 1,
	siblingRankingEnabled: false,
} as const;

/** settings に書き込む際の (key, value) ペア配列に変換 */
export function activitiesDefaultsToSettingPairs(
	defaults: ActivitiesSettingsDefaults = ACTIVITIES_SETTINGS_DEFAULTS,
): Array<[string, string]> {
	return [
		['decay_intensity', defaults.decayIntensity],
		['point_unit_mode', defaults.pointMode],
		['point_currency', defaults.pointCurrency],
		['point_rate', String(defaults.pointRate)],
		['sibling_ranking_enabled', defaults.siblingRankingEnabled ? 'true' : 'false'],
	];
}
