// labels 層 (ADR-0045 / #4965): 子供のバトル。置き場所の規則は docs/DESIGN.md §6
import { normalizeUiMode } from '../validation/age-tier-types';

// ============================================================
// features ラベル (#1465 Phase B Priority 3)
// src/lib/features/ 配下のハードコード文字列を集約。
// 機能カテゴリ別にネスト構造で管理する。
// ============================================================

/**
 * バトル画面（features/battle/）の文言セット。ひらがな側が base
 * （baby は route 側で 404、preschool/elementary はこのまま使用）。
 * 値の型は `string` に広げてある（`as const` のままだと年齢帯変種が別の文字列を入れられない）。
 */
export const FEATURES_BATTLE_LABELS = {
	// BattlePage
	pageTitle: '⚔️ きょうの バトル',
	loadError: 'バトルじょうほうを よみこめませんでした',
	loadingText: 'バトルちゅう...',
	// BattleScene
	playerName: 'きみ',
	playerSpriteAlt: 'きみ',
	statsTitle: 'きみのステータス',
	// #1791: ステータス 5 軸とカテゴリ 5 軸の対応表（自キャラ左 + 対応表で「直近の活動が攻撃力になる」を可視化）
	statCategoryHpLabel: 'うんどう',
	statCategoryAtkLabel: 'べんきょう',
	statCategoryDefLabel: 'こうりゅう',
	statCategorySpdLabel: 'せいかつ',
	statCategoryRecLabel: 'そうぞう',
	statCategoryAriaLabel: '対応するカテゴリ',
	statCategoryNote: '※ 直近 7 日間の各カテゴリの累積ポイントが、ステータスに反映されます',
	startBtn: '⚔️ バトル かいし！',
	alreadyDone: 'きょうの バトルは おわったよ！',
	resultWin: '🎉 かった！',
	resultLose: '😢 まけちゃった…',
	rewardWin: (points: number) => `+${points}ポイント`,
	rewardLose: (points: number) => `+${points}ポイント（なぐさめ）`,
	encourageLose: 'つぎは かてるよ！ がんばろう！',
	// BattleLog
	logEnemy: 'てき',
	logPlayer: 'きみ',
	logDefeated: (who: string) => `${who}は たおれた…`,
	logCriticalPrefix: 'かいしんの いちげき！ ',
	logAttack: (who: string, damage: number, critical: boolean) =>
		`${critical ? 'かいしんの いちげき！ ' : ''}${who}の こうげき！ ${damage} ダメージ`,
	logTurnLabel: (turn: number) => `ターン${turn}`,
} as const;

type FeaturesBattleLabels = {
	readonly [K in keyof typeof FEATURES_BATTLE_LABELS]: (typeof FEATURES_BATTLE_LABELS)[K] extends string
		? string
		: (typeof FEATURES_BATTLE_LABELS)[K];
};

/**
 * #4921: バトル画面の漢字変種 (junior / senior、13-18 歳)。
 *
 * 旧実装は年齢帯を持たず、高校生の画面にも「⚔️ きょうの バトル / きみのステータス /
 * バトル かいし！」等の幼児向けひらがな文体が出ていた (docs/DESIGN.md §8)。
 * 差分だけを持ち、ベースに spread で重ねる (#4690 パターン)。
 */
const FEATURES_BATTLE_KANJI_OVERRIDES = {
	pageTitle: '⚔️ 今日のバトル',
	loadError: 'バトル情報を読み込めませんでした',
	loadingText: 'バトル中...',
	statsTitle: 'ステータス',
	statCategoryHpLabel: '運動',
	statCategoryAtkLabel: '勉強',
	statCategoryDefLabel: '交流',
	statCategorySpdLabel: '生活',
	statCategoryRecLabel: '創造',
	startBtn: '⚔️ バトル開始！',
	alreadyDone: '今日のバトルは終わったよ',
	resultWin: '🎉 勝った！',
	resultLose: '😢 負けてしまった…',
	rewardLose: (points: number) => `+${points}ポイント（参加賞）`,
	encourageLose: '次は勝てるよ！頑張ろう',
	logEnemy: '敵',
	logDefeated: (who: string) => `${who}は倒れた…`,
	logCriticalPrefix: '会心の一撃！ ',
	logAttack: (who: string, damage: number, critical: boolean) =>
		`${critical ? '会心の一撃！ ' : ''}${who}の攻撃！ ${damage} ダメージ`,
} as const satisfies Partial<FeaturesBattleLabels>;

/** バトル画面の文言を年齢帯で選ぶ (docs/DESIGN.md §8)。 */
export function getBattleLabels(uiMode: string): FeaturesBattleLabels {
	const mode = normalizeUiMode(uiMode);
	if (mode === 'baby' || mode === 'preschool' || mode === 'elementary')
		return FEATURES_BATTLE_LABELS;
	return { ...FEATURES_BATTLE_LABELS, ...FEATURES_BATTLE_KANJI_OVERRIDES };
}
