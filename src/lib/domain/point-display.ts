/**
 * Point display formatting utilities.
 * Internal points remain integers; currency conversion is display-only.
 */

/** Supported point display modes */
export type PointUnitMode = 'point' | 'currency';

/** Supported currency codes */
export type CurrencyCode = 'JPY' | 'USD' | 'EUR' | 'GBP' | 'AUD' | 'CAD';

/** Currency definition */
export interface CurrencyDef {
	symbol: string;
	prefix: boolean;
	decimals: number;
	flag: string;
}

/** All supported currency definitions */
export const CURRENCY_DEFS: Record<CurrencyCode, CurrencyDef> = {
	JPY: { symbol: '円', prefix: false, decimals: 0, flag: '🇯🇵' },
	USD: { symbol: '$', prefix: true, decimals: 2, flag: '🇺🇸' },
	EUR: { symbol: '€', prefix: true, decimals: 2, flag: '🇪🇺' },
	GBP: { symbol: '£', prefix: true, decimals: 2, flag: '🇬🇧' },
	AUD: { symbol: 'A$', prefix: true, decimals: 2, flag: '🇦🇺' },
	CAD: { symbol: 'C$', prefix: true, decimals: 2, flag: '🇨🇦' },
} as const;

export const CURRENCY_CODES = Object.keys(CURRENCY_DEFS) as CurrencyCode[];

/** Point display settings (loaded from settings KVS) */
export interface PointSettings {
	mode: PointUnitMode;
	currency: CurrencyCode;
	rate: number;
}

/** Default settings (point mode) */
export const DEFAULT_POINT_SETTINGS: PointSettings = {
	mode: 'point',
	currency: 'JPY',
	rate: 1,
};

/**
 * Format a point value for display.
 *
 * In point mode: returns "1,250P"
 * In currency mode: converts via rate and formats with currency symbol.
 *
 * @param points - Internal point value (integer)
 * @param mode - 'point' or 'currency'
 * @param currency - Currency code (used only in currency mode)
 * @param rate - Conversion rate: 1P = rate * currency units
 */
export function formatPointValue(
	points: number,
	mode: PointUnitMode,
	currency: CurrencyCode,
	rate: number,
): string {
	if (mode === 'point') {
		return `${points.toLocaleString('ja-JP')}P`;
	}

	const value = points * rate;
	const def = CURRENCY_DEFS[currency];
	const formatted = value.toFixed(def.decimals);
	const display = Number(formatted).toLocaleString('ja-JP', {
		minimumFractionDigits: def.decimals,
		maximumFractionDigits: def.decimals,
	});

	return def.prefix ? `${def.symbol}${display}` : `${display}${def.symbol}`;
}

/**
 * Format a point value with sign prefix (e.g., "+10P", "+5円", "-$1.00").
 * Used for activity completion messages and transaction displays.
 */
export function formatPointValueWithSign(
	points: number,
	mode: PointUnitMode,
	currency: CurrencyCode,
	rate: number,
): string {
	const sign = points >= 0 ? '+' : '';
	if (mode === 'point') {
		return `${sign}${points.toLocaleString('ja-JP')}P`;
	}

	const value = points * rate;
	const def = CURRENCY_DEFS[currency];
	const absValue = Math.abs(value);
	const formatted = absValue.toFixed(def.decimals);
	const display = Number(formatted).toLocaleString('ja-JP', {
		minimumFractionDigits: def.decimals,
		maximumFractionDigits: def.decimals,
	});

	const prefix = value >= 0 ? '+' : '-';
	return def.prefix ? `${prefix}${def.symbol}${display}` : `${prefix}${display}${def.symbol}`;
}

/**
 * Get the unit label for the current mode.
 * Point mode: "P", Currency mode: currency symbol (e.g., "円", "$")
 */
export function getUnitLabel(mode: PointUnitMode, currency: CurrencyCode): string {
	if (mode === 'point') return 'P';
	return CURRENCY_DEFS[currency].symbol;
}

/** 「数値」と「単位」を別要素で描画する画面のための分割表現 */
export interface PointDisplayParts {
	/** 数値部分。通貨モードでは通貨記号込みの完成形になる */
	amount: string;
	/** 単位部分。通貨モードでは空文字 (記号は amount 側に含まれる) */
	unit: string;
}

/**
 * 数値と単位を別要素で組む画面 (子供のショップ残高 / ごほうび価格 / 交換確認) 向けの整形。
 *
 * #4509 ②: これらの画面は生ポイント + 固定「ポイント」を描画しており、通貨モードの家庭では
 * 同じ画面のヘッダー (円換算) と数字が矛盾していた。表示は必ず PointSettings を通す。
 *
 * - point モード: 子供向けの語 (`pointWord`) をそのまま単位に使う (既存の見た目を維持)
 * - currency モード: rate 換算 + 通貨記号を amount に含め、unit は空にする
 *   (記号前置通貨 `$5.00` を「数値 + 単位」に割れないため。二重単位も防げる)
 */
export function splitPointDisplay(
	points: number,
	settings: PointSettings,
	pointWord: string,
): PointDisplayParts {
	if (settings.mode === 'point') {
		return { amount: points.toLocaleString('ja-JP'), unit: pointWord };
	}
	return { amount: formatWithSettings(points, settings), unit: '' };
}

/**
 * Format using PointSettings object (convenience wrapper).
 */
export function formatWithSettings(points: number, settings: PointSettings): string {
	return formatPointValue(points, settings.mode, settings.currency, settings.rate);
}

/**
 * Format with sign using PointSettings object (convenience wrapper).
 */
export function formatWithSettingsAndSign(points: number, settings: PointSettings): string {
	return formatPointValueWithSign(points, settings.mode, settings.currency, settings.rate);
}
