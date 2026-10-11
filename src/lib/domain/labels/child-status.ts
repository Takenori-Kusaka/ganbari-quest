// labels 層 (ADR-0045 / #4965): 子供のステータス画面。置き場所の規則は docs/DESIGN.md §6
import { normalizeUiMode } from '../validation/age-tier-types';

const CHILD_STATUS_LABELS = {
	growthChartTitle: 'せいちょうチャート',
	growthBestCatPrefix: '💬 ',
	growthBestCatSuffix: 'が',
	growthHighMessage: 'すごくのびたね！',
	growthLowMessage: 'ちょっとずつ せいちょうしてるよ！',
	growthStableMessage: '💬 あんていしてるね！ またがんばろう！',
	growthWeakCatPrefix: '🌟 ',
	growthWeakCatSuffix: 'にチャレンジすると のびしろがたくさん！',
	emptyStatus: 'ステータスがまだないよ',
	// #4690 F5: RadarChart の凡例。年齢帯で文体が変わるため page から渡す。
	radarNow: 'いま',
	radarComparison: 'せんげつ',
} as const;

/**
 * ステータス画面の文言セット。値の型は `string` に広げてある
 * （リテラル型のままだと年齢帯変種が別の文字列を入れられない）。
 */
type ChildStatusLabels = {
	readonly [K in keyof typeof CHILD_STATUS_LABELS]: string;
};

/**
 * #4690 F5: ステータス画面の漢字変種 (junior / senior、13-18 歳)。
 *
 * 旧実装は年齢帯に関係なく「せいちょうチャート / べんきょうが すごくのびたね！ /
 * のびしろがたくさん！」を出しており、13-18 歳の画面が幼児向け文体のままだった
 * (docs/DESIGN.md §8)。差分だけを持ち、ベースに spread で重ねる。
 */
const CHILD_STATUS_KANJI_OVERRIDES = {
	growthChartTitle: '成長チャート',
	growthHighMessage: '大きく伸びたね！',
	growthLowMessage: '少しずつ成長しているよ',
	growthStableMessage: '💬 安定しているね。この調子で続けよう',
	growthWeakCatSuffix: 'にチャレンジすると伸びしろが大きいよ',
	emptyStatus: 'ステータスはまだありません',
	radarNow: '今月',
	radarComparison: '先月',
} as const satisfies Partial<ChildStatusLabels>;

/** ステータス画面の文言を年齢帯で選ぶ (docs/DESIGN.md §8)。 */
export function getChildStatusLabels(uiMode: string): ChildStatusLabels {
	const mode = normalizeUiMode(uiMode);
	if (mode === 'baby' || mode === 'preschool' || mode === 'elementary') {
		return CHILD_STATUS_LABELS;
	}
	return { ...CHILD_STATUS_LABELS, ...CHILD_STATUS_KANJI_OVERRIDES };
}
