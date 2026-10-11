// labels 層 (ADR-0045 / #4965): 子供のマイルストーン (褒める軸)。置き場所の規則は docs/DESIGN.md §6
// #4268: マイルストーン (褒める軸) の ID 集合は domain 定数が SSOT
import { PRAISE_MILESTONE_IDS, type PraiseMilestoneId } from '../constants/habit-milestones';

// ============================================================
// 初月価値プレビュー体験 (#1600 ADR-0023 I9 / #2169 年齢別 variant 化)
// マイルストーン演出 + 30 日後親レポートプレビュー
// Anti-engagement (ADR-0012) 準拠: 過剰な祝福禁止、3 秒以内に閉じれる UI
// 年齢帯 variant (ADR-0015): preschool = ひらがな / elementary 以上 = 漢字
// 同一カード内のひらがな + 漢字混在を解消 (#2169)
// ============================================================
// #4268: ID 集合の SSOT は `constants/habit-milestones.ts` の `PRAISE_MILESTONE_IDS`
// (褒める軸 = 日数ベース + 開始の 1 件)。ここで独自 union を再定義しない。
type MilestoneTextKey = PraiseMilestoneId;

/** 表示文言を持つマイルストーン ID (fitness function が判定側との一致を検査する、#4268 AC4) */
export const MILESTONE_LABEL_IDS: readonly MilestoneTextKey[] = PRAISE_MILESTONE_IDS;

type MilestoneAgeContext = 'preschool' | 'elementary' | 'junior' | 'senior';

/** ひらがな variant (preschool 向け、3-5 歳) */
const MILESTONE_HIRAGANA: Record<MilestoneTextKey, { title: string; description: string }> = {
	first_record: {
		title: 'はじめての きろく',
		description: 'さいしょの がんばりを きろくできたよ',
	},
	streak_7: {
		title: '1 しゅうかん つづいた',
		description: '7 にち つづけて きろくできたよ',
	},
	streak_14: {
		title: '2 しゅうかん つづいた',
		description: '14 にち つづけて きろくできたよ',
	},
	streak_30: {
		title: '1 かげつ つづいた',
		description: '30 にち つづけて きろくできたよ',
	},
};

/** 漢字 variant (elementary / junior / senior 向け、6-18 歳) */
const MILESTONE_KANJI: Record<MilestoneTextKey, { title: string; description: string }> = {
	first_record: {
		title: 'はじめての記録',
		description: '最初のがんばりを記録できました',
	},
	streak_7: {
		title: '1 週間 つづいた',
		description: '7 日連続で記録できました',
	},
	streak_14: {
		title: '2 週間 つづいた',
		description: '14 日連続で記録できました',
	},
	streak_30: {
		title: '1 か月 つづいた',
		description: '30 日連続で記録できました',
	},
};

export const MILESTONE_LABELS = {
	/** 子供 UI に表示する小さなマイルストーンバナータイトル (#1600 旧 banner、#2168 で bell UI へ移行後も legacy で保持、#2169 でカタカナ「マイルストーン」を子供向けに変更) */
	bannerTitle: 'やったね！',
	bannerTitleKanji: '達成しました',
	bannerCloseLabel: '閉じる',
	/** #2168: Header 配置 bell button の aria-label (件数を含む) */
	bellAriaLabel: (count: number) => `新着のおしらせ ${count}件 を見る`,
	/** legacy: 漢字 variant (elementary 以上の callers が直接参照する場合用、後方互換) */
	first_record: MILESTONE_KANJI.first_record,
	streak_7: MILESTONE_KANJI.streak_7,
	streak_14: MILESTONE_KANJI.streak_14,
	streak_30: MILESTONE_KANJI.streak_30,
} as const;

/**
 * #2169 / ADR-0015: 年齢帯 variant を返す。
 *
 * `ageTier` を必ず渡すこと (アンチパターン A1: `if (uiMode === 'baby')` 散在を回避)。
 * - `preschool` → ひらがな
 * - `elementary` / `junior` / `senior` → 漢字
 * - `baby` 等 unsupported は漢字 fallback (`MilestoneBellButton` 側で baby は非表示済み、ADR-0011)
 */
export function getMilestoneLabel(
	id: MilestoneTextKey,
	ctx: { ageTier: MilestoneAgeContext | string },
): { title: string; description: string } {
	const variant = ctx.ageTier === 'preschool' ? MILESTONE_HIRAGANA : MILESTONE_KANJI;
	return variant[id] ?? MILESTONE_KANJI[id];
}

/**
 * #2169: bannerTitle の年齢帯 variant 取得。
 * preschool → 「やったね！」/ elementary 以上 → 「達成しました」
 */
export function getMilestoneBannerTitle(ctx: { ageTier: MilestoneAgeContext | string }): string {
	return ctx.ageTier === 'preschool'
		? MILESTONE_LABELS.bannerTitle
		: MILESTONE_LABELS.bannerTitleKanji;
}
