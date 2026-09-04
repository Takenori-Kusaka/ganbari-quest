import { getChildTutorialLabels } from '$lib/domain/labels';
import type { TutorialChapter } from './tutorial-types';

/**
 * 子供画面用チュートリアルチャプター定義（#4652、EPIC #4650 判断 3 / 4 / 5）
 *
 * 「記録して閉じる」最短経路だけを 3 章 5 step で説明する（ADR-0012 anti-engagement）:
 *   1. きろくしよう: 活動カード（光る）→ とりけし（説明、中央）
 *   2. まいにち つづけよう: 💮 スタンプ（光る）
 *   3. ほかの がめん: 下ナビ つよさ / ステータス（光る）→ ショップ（光る）
 *
 * - selector を持つ step は**ホームに常在する UI** だけを指す（押す step は必ず光る）。
 *   コンボ / おみくじ（記録結果 dialog・スタンプ演出の中にしか無い）/ レーダーチャート（/status）は
 *   ホームに無い仕組みのため step を置かない。
 * - 文言は labels.ts `getChildTutorialLabels(uiMode)` の年齢帯 variant（preschool / elementary =
 *   ひらがな、junior / senior = 漢字）で、nav 名（つよさ / ステータス、ショップ）・とりけし秒数は
 *   画面と同じ定数を参照する。
 *
 * uiMode ごとに生成するため関数にしている（(child)/+layout が `setChapters(getChildTutorialChapters(uiMode))`）。
 *
 * `hasActivities` は「活動カードが 1 枚でもあるか」。0 件のときに
 * `[data-tutorial="activity-card"]` を指して「カードをタップすると」と案内すると、
 * **光らせる先も押すものも無い**（初回演出 `AdventureStartOverlay` と同じクラスの欠陥）。
 * 0 件では selector を外して説明型 step に落とし、文言も「まだ届いていない」に差し替える。
 * 既定値は持たせない（渡し忘れが型で落ちるようにする）。
 */
export function getChildTutorialChapters(
	uiMode: string,
	options: { hasActivities: boolean },
): TutorialChapter[] {
	const L = getChildTutorialLabels(uiMode);
	const recordCardStep = options.hasActivities
		? {
				id: 'child-record-card',
				chapterId: 1,
				selector: '[data-tutorial="activity-card"]',
				...L.steps['child-record-card'],
				position: 'bottom' as const,
			}
		: {
				// selector 無し = 説明型（中央表示）。無い要素を spotlight しない。
				id: 'child-record-card',
				chapterId: 1,
				...L.steps['child-record-card-empty'],
				position: 'bottom' as const,
			};
	return [
		{
			id: 1,
			title: L.chapters.record.title,
			icon: L.chapters.record.icon,
			steps: [
				recordCardStep,
				{
					id: 'child-record-cancel',
					chapterId: 1,
					// とりけしボタンは記録直後の結果 dialog にしか無い → selector 無し（説明型、中央）
					...L.steps['child-record-cancel'],
					position: 'bottom',
				},
			],
		},
		{
			id: 2,
			title: L.chapters.daily.title,
			icon: L.chapters.daily.icon,
			steps: [
				{
					id: 'child-daily-stamp',
					chapterId: 2,
					selector: '[data-tutorial="stamp-progress"]',
					...L.steps['child-daily-stamp'],
					position: 'bottom',
				},
			],
		},
		{
			id: 3,
			title: L.chapters.more.title,
			icon: L.chapters.more.icon,
			steps: [
				{
					id: 'child-nav-status',
					chapterId: 3,
					selector: '[data-tutorial="nav-status"]',
					...L.steps['child-nav-status'],
					position: 'top',
				},
				{
					id: 'child-nav-shop',
					chapterId: 3,
					selector: '[data-tutorial="nav-shop"]',
					...L.steps['child-nav-shop'],
					position: 'top',
				},
			],
		},
	];
}

/**
 * 子供ガイドの進捗 (localStorage) の namespace。**子供ごと**に分ける (#4765 PO 回答 2026-09-03)。
 *
 * #4765 までは `child:<uiMode>` で、同じ端末・同じ年齢モードの兄弟が進捗を共有していた
 * (兄が途中まで進めると弟に「前回の途中から続けますか？」が出て、弟のガイドが飛ぶ)。
 * 子供 ID を key に含めることで、同じ端末を使い回す兄弟でも進捗が混ざらない。
 * uiMode も残す (年齢モードが変わると文言セットが変わるため、モード別に最初から案内する)。
 */
export function getChildTutorialProgressScope(childId: string | number, uiMode: string): string {
	return `child:${childId}:${uiMode}`;
}

/**
 * #4765 までの家族共有 key (子供 ID を含まない)。どの子の進捗か判別できないため
 * **読まずに捨てる** (`discardSavedProgress`)。引き継ぐと兄の進捗が弟に付く不具合がそのまま残る。
 */
export function getLegacyChildTutorialProgressScope(uiMode: string): string {
	return `child:${uiMode}`;
}
