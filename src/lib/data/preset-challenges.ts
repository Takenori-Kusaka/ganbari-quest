import { addDaysJST, jstYearMonth, monthEndOfKey, toJSTDateString } from '$lib/domain/date-utils';

// Preset cooperative challenge catalog — 新規ユーザー向けの家族チャレンジテンプレート (#2298)
//
// Issue #2298 (EPIC #2294 ④): デフォルトプリセット 5-7 件 + setup フロー統合
// - Research §5.1 (Notion / Pinterest / ClassDojo onboarding) のベストプラクティス整合
// - empty state (ゼロベース構築問題) の構造的解消
// - challengeType=cooperative 固定 (子#2 で競争型は削除済)
// - ADR-0012 anti-engagement 整合: skip 可、自動 add は 3 件のみ
// - ADR-0014 整合: 既存 preset-rewards.ts 構造を踏襲、新規 OSS 不要
//
// 既存 season-event-calendar.ts (auto-delivered seasonal events) とは別物:
// - SEASON_EVENTS は tenant_events table で日付一致時に自動配信される
// - PRESET_CHALLENGES は setup フロー任意 step で親が明示選択 → sibling_challenges に手動 add
//
// カテゴリ id↔code の対応は $lib/domain/categories.ts (SSOT、#3607) に整合。

import { CATEGORY_CODE_TO_ID } from '$lib/domain/categories';
import { asCategoryId, type CategoryId } from '$lib/domain/ids';
import { CHILD_TERMS } from '$lib/domain/terms';

export interface PresetChallenge {
	/** 内部 id (PR description / e2e で使用)、unique */
	id: string;
	/** 表示タイトル */
	title: string;
	/** 説明文 (1 行、setup card に表示) */
	description: string;
	/** 開始月日 (MM-DD、年は実行時の当年を埋める) */
	startMonthDay: string;
	/** 終了月日 (MM-DD、startMonthDay より後または同日) */
	endMonthDay: string;
	/** 目標回数 (年齢調整なし、family 単位累積) */
	baseTarget: number;
	/** カテゴリ id (1-5、null は全カテゴリ対象) */
	categoryId: CategoryId | null;
	/** クリア時 family 全員に配布する point 数 */
	rewardPoints: number;
	/** カードに表示する emoji */
	icon: string;
	/** auto-add の推奨対象 (setup 任意 step で「おすすめ 3 件を自動追加」ボタン用) */
	autoAddRecommended: boolean;
}

/**
 * 5-7 件の家族向けチャレンジテンプレート。
 * - 日本ローカライズ 5 件: ひな祭り / こどもの日 / 七夕 / 夏休み読書 / 敬老の日
 * - 任意の家族プロジェクト 2 件: 7 日間連続 / 今月のおてつだい
 * - autoAddRecommended=true の 3 件は setup フロー「おすすめ自動追加」で取込
 */
export const PRESET_CHALLENGES: readonly PresetChallenge[] = [
	{
		id: 'preset-hinamatsuri',
		title: 'ひな祭り大掃除チャレンジ',
		description: `ひな祭りに向けて家族で大掃除をしよう（${CHILD_TERMS.honorific}と一緒に部屋をきれいに）`,
		startMonthDay: '03-01',
		endMonthDay: '03-03',
		baseTarget: 3,
		categoryId: asCategoryId(CATEGORY_CODE_TO_ID.seikatsu),
		rewardPoints: 50,
		icon: '🎎',
		autoAddRecommended: false,
	},
	{
		id: 'preset-kodomonohi',
		title: 'こどもの日プロジェクト',
		description: 'こどもの日に向けて家族で工作や料理にチャレンジ',
		startMonthDay: '04-25',
		endMonthDay: '05-05',
		baseTarget: 5,
		categoryId: asCategoryId(CATEGORY_CODE_TO_ID.souzou),
		rewardPoints: 80,
		icon: '🎏',
		autoAddRecommended: true,
	},
	{
		id: 'preset-tanabata',
		title: '七夕短冊チャレンジ',
		description: '家族みんなで願い事を書いて、毎日 1 つずつ努力してみよう',
		startMonthDay: '06-25',
		endMonthDay: '07-07',
		baseTarget: 7,
		categoryId: null,
		rewardPoints: 70,
		icon: '🎋',
		autoAddRecommended: false,
	},
	{
		id: 'preset-natsuyasumi-reading',
		title: '夏休み読書記録',
		description: '夏休みに家族で本を読もう（読書時間を活動として記録）',
		startMonthDay: '07-20',
		endMonthDay: '08-31',
		baseTarget: 10,
		categoryId: asCategoryId(CATEGORY_CODE_TO_ID.benkyou),
		rewardPoints: 100,
		icon: '📚',
		autoAddRecommended: true,
	},
	{
		id: 'preset-keironohi',
		title: '敬老の日に手紙を書こう',
		description: 'おじいちゃん・おばあちゃんに家族で手紙やお礼を伝えよう',
		startMonthDay: '09-10',
		endMonthDay: '09-18',
		baseTarget: 3,
		categoryId: asCategoryId(CATEGORY_CODE_TO_ID.kouryuu),
		rewardPoints: 50,
		icon: '👴',
		autoAddRecommended: false,
	},
	{
		id: 'preset-monthly-otetsudai',
		title: '今月のおてつだいチャレンジ',
		description: '今月家族みんなでおてつだいをがんばろう（記録は何でも OK）',
		startMonthDay: 'this-month-start',
		endMonthDay: 'this-month-end',
		baseTarget: 15,
		categoryId: asCategoryId(CATEGORY_CODE_TO_ID.seikatsu),
		rewardPoints: 60,
		icon: '🏠',
		autoAddRecommended: true,
	},
	{
		id: 'preset-7day-streak',
		title: '7 日間連続で記録に挑戦',
		description: '家族のだれかが毎日 1 件以上記録できるか挑戦',
		startMonthDay: 'today',
		endMonthDay: 'today-plus-7',
		baseTarget: 7,
		categoryId: null,
		rewardPoints: 40,
		icon: '🔥',
		autoAddRecommended: false,
	},
] as const;

/**
 * PresetChallenge の startMonthDay / endMonthDay を実行時の具体日付に解決する。
 * - `MM-DD` 形式: 当年を埋める。ただし当年の該当日が既に過去なら来年に shift
 * - `this-month-start` / `this-month-end`: 今月初日 / 末日
 * - `today` / `today-plus-N`: 今日 / 今日+N日
 *
 * @returns `{ startDate, endDate }` (YYYY-MM-DD 形式、startDate <= endDate を保証)
 */
export function resolvePresetChallengeDates(
	preset: PresetChallenge,
	now: Date = new Date(),
): { startDate: string; endDate: string } {
	// 暦要素は JST SSOT 経由 (#4015)。ローカル getter だと Lambda (UTC) では JST 00:00〜09:00 に
	// チャレンジ期間が 1 日 (月初 / 年始は 1 ヶ月 / 1 年) ずれる。
	const todayStr = toJSTDateString(now);
	const { year, month } = jstYearMonth(now);
	const day = Number(todayStr.slice(8, 10));

	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}

	function resolveToken(token: string, isEnd: boolean): string {
		if (token === 'this-month-start') {
			return `${year}-${pad(month)}-01`;
		}
		if (token === 'this-month-end') {
			return monthEndOfKey(`${year}-${pad(month)}`);
		}
		if (token === 'today') {
			return todayStr;
		}
		if (token.startsWith('today-plus-')) {
			const offset = Number(token.slice('today-plus-'.length));
			return addDaysJST(todayStr, offset);
		}
		// MM-DD 形式
		const match = /^(\d{2})-(\d{2})$/.exec(token);
		if (!match) {
			// fallback: 不正値は今日
			return todayStr;
		}
		const mm = Number(match[1]);
		const dd = Number(match[2]);
		// end token は start が次年なら end も次年（year shift は呼び元で判断）
		const candidateYear = year;
		const candidate = `${candidateYear}-${pad(mm)}-${pad(dd)}`;
		if (isEnd) return candidate;
		// start: 当年の該当日が既に過去なら来年
		if (mm < month || (mm === month && dd < day)) {
			return `${year + 1}-${pad(mm)}-${pad(dd)}`;
		}
		return candidate;
	}

	const startDate = resolveToken(preset.startMonthDay, false);
	const endDate = resolveToken(preset.endMonthDay, true);

	// start が来年に shift された場合は end も来年に shift（MM-DD 形式の場合のみ）
	if (
		/^\d{2}-\d{2}$/.test(preset.startMonthDay) &&
		/^\d{2}-\d{2}$/.test(preset.endMonthDay) &&
		startDate.slice(0, 4) !== endDate.slice(0, 4)
	) {
		// startDate が来年 → endDate も来年に揃える
		return {
			startDate,
			endDate: `${startDate.slice(0, 4)}-${endDate.slice(5)}`,
		};
	}

	// safety: start > end の不整合は end を start に揃える (fallback)
	if (startDate > endDate) {
		return { startDate, endDate: startDate };
	}
	return { startDate, endDate };
}

/** auto-add 推奨セットを返す (setup フロー「おすすめ自動追加」用) */
export function getAutoAddRecommendedPresets(): readonly PresetChallenge[] {
	return PRESET_CHALLENGES.filter((p) => p.autoAddRecommended);
}

/** id から preset を取得 */
export function getPresetChallengeById(id: string): PresetChallenge | undefined {
	return PRESET_CHALLENGES.find((p) => p.id === id);
}
