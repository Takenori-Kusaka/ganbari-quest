// labels 層 (ADR-0045 / #4965): 整形関数 (format* / getCategoryDisplayName。2 つ以上の area で使う下層の共有)。置き場所の規則は docs/DESIGN.md §6
import { CATEGORIES, type CategoryCode, toCategoryCode } from '../categories';
import { toJSTDateString } from '../date-utils';
import { normalizeUiMode } from '../validation/age-tier-types';

// ============================================================
// フォーマット関数 (#1452 Phase B)
// ============================================================

export function formatCount(n: number): string {
	return `${n}件`;
}
export function formatAge(n: number): string {
	return `${n}歳`;
}
/**
 * 子供向け画面のひらがな年齢表記 (#4512 / #4716 item 15)。`formatAge` の漢字版と対。
 * /switch / /view/[token] のように子供・来訪者が読む画面はこちらを使う
 * (以前は `child.age + 'さい'` を画面側で直書きしていた)。
 */
export function formatAgeKana(n: number): string {
	return `${n}さい`;
}
export function formatAgeRange(min: number, max: number): string {
	return `${min}〜${max}歳`;
}
export function formatStreak(n: number): string {
	return `${n}日れんぞく`;
}
export function formatTimes(n: number): string {
	return `${n}回`;
}
export function formatPeople(n: number): string {
	return `${n}人`;
}
export function formatDateRange(start: string, end: string): string {
	return `${formatJstDate(start)} 〜 ${formatJstDate(end)}`;
}

/**
 * 保護者向け画面の日付表示 SSOT (#4716)。`YYYY/MM/DD` (JST, ゼロ埋め) に統一する。
 *
 * 以前は画面ごとに `d.replace(/-/g, '/')`（→ 2026/08/17）と
 * `toLocaleDateString('ja-JP')`（→ 2026/8/19）が混在し、同じ日付が 2 通りに見えていた。
 * ISO 文字列 (`YYYY-MM-DD`) / epoch ミリ秒 / Date のいずれも受け取り、JST 暦日に正規化する
 * (`toJSTDateString` 経由。ローカル TZ の getter は使わない — #4015 JST SSOT)。
 */
export function formatJstDate(input: string | number | Date): string {
	const iso =
		typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)
			? input
			: toJSTDateString(input instanceof Date ? input : new Date(input));
	return iso.replaceAll('-', '/');
}

/**
 * 子供向け画面の日付表示 SSOT (#4716)。年齢帯で文体を変える。
 *
 * ISO 日付 (`2026-08-17`) をそのまま出すと、幼児画面に開発者フォーマットが露出する
 * (実測: 子供 /challenges が `2026-08-17〜` を表示していた)。
 */
export function formatChildDate(input: string | number | Date, ageTier: string): string {
	const iso =
		typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)
			? input
			: toJSTDateString(input instanceof Date ? input : new Date(input));
	const [, month, day] = iso.split('-');
	const m = Number.parseInt(month ?? '1', 10);
	const d = Number.parseInt(day ?? '1', 10);
	const tier = normalizeUiMode(ageTier);
	return tier === 'baby' || tier === 'preschool' ? `${m}がつ${d}にち` : `${m}月${d}日`;
}
/**
 * 「YYYY年M月」表記 (#4512)。
 *
 * 旧実装は admin/reports・admin/growth-book・ADMIN_HOME_LABELS・OPS_COSTS_LABELS が
 * それぞれ同じ組版を持っていた。年月の見せ方を変えるときに 4 箇所直す状態を解消する。
 */
export function formatYearMonth(year: number | string, month: number | string): string {
	return `${year}年${Number(month)}月`;
}
/** 「M月」表記 (年を伴わない月見出し、#4512) */
export function formatMonthOnly(month: number | string): string {
	return `${Number(month)}月`;
}

/**
 * #4690: カテゴリ表示名を年齢帯で選ぶ。
 *
 * `CATEGORIES[code].name` はひらがな固定（DB seed 値 / `CategoryName` union /
 * marketplace payload が依存しているため変えられない）。13-18 歳の画面に
 * 「うんどう」「べんきょう」が出るのは docs/DESIGN.md §8 と食い違うので、
 * 同じ SSOT に並べた `kanjiName` を elementary 以上で使う。
 *
 * @param category カテゴリ code、または legacy 数値 id / branded CategoryId 文字列
 */
export function getCategoryDisplayName(category: string | number, uiMode: string): string {
	// `in` は継承プロパティ ('toString' 等) にも true を返し、DB 汚染時に Function を meta として
	// 返してしまうため own property 判定にする (QM #4809 レビュー)。
	const code = (Object.hasOwn(CATEGORIES, category) ? category : toCategoryCode(category)) as
		| CategoryCode
		| undefined;
	if (!code) return '';
	const meta = CATEGORIES[code];
	const mode = normalizeUiMode(uiMode);
	return mode === 'baby' || mode === 'preschool' ? meta.name : meta.kanjiName;
}

// #4407: 交換の「× 個数」表記 SSOT。個数 1 のときは付けない (従来表示を変えない)。
// ポイント台帳の description / 親の承認一覧の両方が本 helper を使う。
export function formatRewardWithQuantity(rewardTitle: string, quantity: number): string {
	return quantity > 1 ? `${rewardTitle} × ${quantity}` : rewardTitle;
}
