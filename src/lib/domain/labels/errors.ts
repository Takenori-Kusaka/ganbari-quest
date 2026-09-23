// labels 層 (ADR-0045 / #4965): エラー画面・エラー通知・オフライン (画面をまたぐ機能)。置き場所の規則は docs/DESIGN.md §6
import { normalizeUiMode } from '../validation/age-tier-types';

// ============================================================
// エラーページ (#1452 Phase B)
// ============================================================

export const ERROR_PAGE_LABELS = {
	// Page titles (by status code)
	title404: 'ページが みつかりません',
	title429: 'アクセスが こんでいます',
	title403: 'アクセスが きょか されていません',
	titleDefault: 'エラーが はっせいしました',

	// Descriptions
	desc404Child: 'おうちの がめんに もどります…',
	desc404Parent: 'お探しのページは存在しないか、移動した可能性があります。',
	desc429: 'しばらくしてから再度お試しください。',
	desc403Child: 'おうちの がめんに もどります…',
	desc403Parent: 'このページにアクセスする権限がありません。ログインし直してください。',
	descGenericChild: 'おうちの がめんに もどります…',
	descGenericParent: '予期しないエラーが発生しました。時間をおいて再度お試しください。',

	// Action buttons
	btnBackNow: 'いますぐ もどる',
	btnLoginAgain: 'ログインし直す',
	btnRetry: 'もう一度試す',
	btnBackToTop: 'トップページへ戻る',

	// Error ID
	errorIdPrefix: 'エラーID: ',
} as const;

/**
 * #4690 F3: 子供画面のエラー文言（年齢帯 2 変種）。
 *
 * 旧実装は「子供かどうか」だけで分岐し、子供文言は 1 種類（ひらがな）、
 * 判定に失敗すると保護者向けの「お探しのページは存在しないか、移動した可能性が
 * あります。」がそのまま 3〜5 歳の画面に出ていた（実測: `/preschool/battle`）。
 *
 * 文体の分かれ目は `child-home/variants` と同じ baby・preschool = ひらがな /
 * elementary 以上 = 漢字（docs/DESIGN.md §8）。
 */
const ERROR_PAGE_CHILD_HIRAGANA = {
	title404: 'ページが みつかりません',
	title429: 'アクセスが こんでいます',
	title403: 'ここは ひらけません',
	titleDefault: 'エラーが おきました',
	desc404: 'おうちの がめんに もどります…',
	desc403: 'おうちの がめんに もどります…',
	descGeneric: 'おうちの がめんに もどります…',
	btnBackNow: 'いますぐ もどる',
} as const;

const ERROR_PAGE_CHILD_KANJI = {
	title404: 'ページが見つかりません',
	title429: 'アクセスが混み合っています',
	title403: 'このページは開けません',
	titleDefault: 'エラーが発生しました',
	desc404: 'ホーム画面に戻ります…',
	desc403: 'ホーム画面に戻ります…',
	descGeneric: 'ホーム画面に戻ります…',
	btnBackNow: '今すぐ戻る',
} as const;

interface ChildErrorPageLabels {
	readonly title404: string;
	readonly title429: string;
	readonly title403: string;
	readonly titleDefault: string;
	readonly desc404: string;
	readonly desc403: string;
	readonly descGeneric: string;
	readonly btnBackNow: string;
}

/** 子供画面のエラー文言を年齢帯で選ぶ。 */
export function getChildErrorPageLabels(uiMode: string): ChildErrorPageLabels {
	const mode = normalizeUiMode(uiMode);
	return mode === 'baby' || mode === 'preschool'
		? ERROR_PAGE_CHILD_HIRAGANA
		: ERROR_PAGE_CHILD_KANJI;
}

// ============================================================
// ごほうび申請承認専用画面 (#2269: /admin/rewards/requests)
// CRUD と承認フローの責務分離（PO 指摘「ごほうび/申請タブ区分が意味不明」）
// ============================================================

// ============================================================
// UI プリミティブ コンポーネントラベル (#1465 Phase B)
// src/lib/ui/primitives/ 配下のハードコード文字列を集約
// ============================================================

// #3218 (EPIC #3217): 統一エラー通知 helper (error-notify.ts) の文言 SSOT。
// 内部例外をそのまま出さず、ユーザ向け平易文言にマッピングする (WCAG 3.3.1/3.3.3、Apple HIG)。
/** error-notify helper が受け取るエラー文言セットの構造 (#3225 ②b: age-tier 切替用)。 */
export type ErrorNotifyLabelSet = {
	readonly title: string;
	readonly generic: string;
	readonly network: string;
	readonly server: string;
	readonly forbidden: string;
	readonly conflict: string;
	readonly badRequest: string;
};

export const ERROR_NOTIFY_LABELS = {
	title: '処理できませんでした',
	generic: '時間をおいて再度お試しください',
	network: '通信に失敗しました。接続を確認して再度お試しください',
	server: 'エラーが発生しました。時間をおいて再度お試しください',
	forbidden: 'この操作を行う権限がありません',
	conflict: '他の操作と競合しました。画面を更新して再度お試しください',
	badRequest: '入力内容をご確認ください',
} as const satisfies ErrorNotifyLabelSet;

// #3225 ②b (EPIC #3217): 子供画面 (preschool / baby) 向けエラー文言。
// DESIGN.md §8 整合 — ひらがな・責めない言い回し・必ず次アクション (「もういちど ためしてね」) を提示する。
export const ERROR_NOTIFY_LABELS_CHILD = {
	title: 'できなかったよ',
	generic: 'もういちど ためしてね',
	network: 'つうしんが できなかったみたい。もういちど ためしてね',
	server: 'うまく いかなかったよ。あとで もういちど ためしてね',
	forbidden: 'これは できないみたい',
	conflict: 'もういちど やってみてね',
	badRequest: 'もういちど かくにんしてね',
} as const satisfies ErrorNotifyLabelSet;

/**
 * uiMode に応じたエラー文言セットを返す (#3225 ②b)。
 * preschool / baby はひらがな (`ERROR_NOTIFY_LABELS_CHILD`)、elementary 以上は標準 (漢字許容)。
 */
export function getErrorNotifyLabels(uiMode: string): ErrorNotifyLabelSet {
	return uiMode === 'preschool' || uiMode === 'baby'
		? ERROR_NOTIFY_LABELS_CHILD
		: ERROR_NOTIFY_LABELS;
}

// #4644: オフライン着地ページ (`/offline`) の文言。
//
// 読み手は**年齢帯を問わず子供**である (Service Worker はどの画面からの遷移でも
// ここへ落とすため、preschool の子が最初に読む可能性がある)。年齢帯 variant は
// 持たず、全年齢が読めるひらがな主体の 1 種類に固定する。漢字を混ぜると preschool が
// 読めず、逆に「エラー」等のカタカナ専門語を出すと「壊した」と受け取られる。
export const OFFLINE_LABELS = {
	/** ページタイトル (svelte:head) */
	pageTitle: 'いんたーねっとに つながっていません',
	/** 画面見出し */
	heading: 'いんたーねっとに つながっていないよ',
	/** 本文 (原因と対処。子供が自分で試せることだけを書く) */
	body: 'でんぱが とどいていないみたい。おうちの Wi-Fi を たしかめてから、もういちど ためしてね。',
	/** 「壊れていない」ことの明示 (パニック防止。ADR-0012 整合で煽らない) */
	reassurance: 'きろくは きえていないから だいじょうぶ。',
	/** 再読み込みボタン */
	retry: 'もういちど ひらく',
	/** 装飾アイコン (aria-hidden) */
	icon: '📡',
} as const;
