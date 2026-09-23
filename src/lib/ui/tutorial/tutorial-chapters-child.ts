import { getChildPageGuideLabels, getChildTutorialLabels } from '$lib/domain/labels';
import {
	CHILD_HOME_GUIDE_PAGE,
	type ChildChapterBuilder,
	type TutorialChapter,
	type TutorialStep,
} from './tutorial-types';

/**
 * 子供の ❓ が説明を持つ画面 (#4864、PO 決裁 2026-09-23 案 1)。
 *
 * 子供の ❓ は **押した画面について説明する** (親の ❓ ページガイドと同じ意味)。
 * 旧実装はどの画面で押しても固定 5 step のホームのツアーになり、`/checklist` で押した子が
 * 別の画面の説明を 5 枚めくらされていた。
 */
export type ChildGuidePage = typeof CHILD_HOME_GUIDE_PAGE | 'checklist' | 'shop' | 'status';

/**
 * 子供画面の route id → ❓ で開く章 (#4864)。
 *
 * key は SvelteKit の `page.route.id` (URL ではなく route の形)。`[uiMode=uiMode]` を含むので
 * 年齢モードが変わっても 1 行で済む。**本表に無い route では ❓ を出さない** — 別の画面の説明を
 * めくらせるより ❓ が無い方がよい (PO 決裁 2 / ADR-0012)。
 */
export const CHILD_GUIDE_PAGE_BY_ROUTE: Readonly<Record<string, ChildGuidePage>> = {
	'/(child)/[uiMode=uiMode]/home': CHILD_HOME_GUIDE_PAGE,
	'/(child)/checklist': 'checklist',
	'/(child)/[uiMode=uiMode]/shop': 'shop',
	'/(child)/[uiMode=uiMode]/(character)/status': 'status',
};

/**
 * 説明を用意せず ❓ を出さない子供画面と、その理由 (#4864)。
 *
 * 子供画面の route は {@link CHILD_GUIDE_PAGE_BY_ROUTE} か本表のどちらかに必ず載る
 * (`tests/unit/tutorial/child-page-guide-4864.test.ts` が `src/routes/(child)` を走査して検査する)。
 * 新しい子供画面を足したら、説明を書くか ❓ を出さないかをその場で決める (黙って ❓ が消えない)。
 */
export const CHILD_ROUTES_WITHOUT_GUIDE: Readonly<Record<string, string>> = {
	'/(child)/[uiMode=uiMode]/(character)/history':
		'見返すだけの画面で、操作は種類 / 期間のタブ切り替えだけ。タブの名前で読める',
	'/(child)/[uiMode=uiMode]/(character)/challenges':
		'今週のチャレンジの内容と進み具合は、カード自身が文と数で表示している',
	'/(child)/[uiMode=uiMode]/(character)/battle':
		'操作はバトル開始ボタン 1 つで、ステータスの出どころは画面内の注記が説明している',
	'/(child)/[uiMode=uiMode]/home/initial-points':
		'baby (親の準備モード) 専用の画面で、baby には ❓ 自体を出さない (ADR-0011)',
};

/** `page.route.id` から ❓ で開く章を引く。説明を持たない画面 / 不明な route は `null` (= ❓ を出さない)。 */
export function resolveChildGuidePage(routeId: string | null | undefined): ChildGuidePage | null {
	if (!routeId) return null;
	return CHILD_GUIDE_PAGE_BY_ROUTE[routeId] ?? null;
}

/**
 * ガイドが spotlight する要素の selector (#4864)。各画面の `data-tutorial` と 1 対 1。
 *
 * test (`child-page-guide-4864.test.ts`) が、ここに書いた値が実際に画面の source に在ることを検査する
 * (anchor を消したのに selector だけ残り、中央 fallback で黙って成立する事故を防ぐ)。
 */
export const CHILD_PAGE_GUIDE_SELECTORS = {
	checklistItem: '[data-tutorial="checklist-item"]',
	checklistPoints: '[data-tutorial="checklist-points"]',
	shopRewardCard: '[data-tutorial="shop-reward-card"]',
	shopHistory: '[data-tutorial="shop-history"]',
	statusGrowth: '[data-tutorial="status-growth"]',
	statusLevels: '[data-tutorial="status-levels"]',
} as const;

/**
 * 子供 layout が store に渡す builder を作る (#4860 / #4864)。
 *
 * layout に closure を直書きすると「件数を素通しする」配線が **test から見えない場所** に残り、
 * 純関数の test が通っていても実機で外れる (それが #4860 must-A の実害だった)。
 * builder をここで組み立てて export し、素通しであることを test で固定する。
 * 画面 (page) と件数 (presence) はどちらも store が持つ — layout も builder も推測しない。
 */
export function makeChildChapterBuilder(uiMode: string): ChildChapterBuilder {
	return (page, presence) => getChildGuideChapters(page, uiMode, presence);
}

/**
 * 画面ごとの章を返す (#4864)。ホームは従来の 3 章 5 step をそのまま使う (PO 決裁)。
 * 説明を持たない画面 (`null` / 未知の page) は空配列 = ガイドは起動しない。
 *
 * `presence` はその画面の主役が 1 つでもあるか:
 *   - `true`      → 実要素を spotlight して操作を案内する
 *   - `false`     → **無いものを指さない**。「まだ ないよ」の説明 step に差し替える
 *   - `undefined` → あるとも無いとも言わない。spotlight せず、画面の決まりだけを言う
 */
export function getChildGuideChapters(
	page: string | null,
	uiMode: string,
	presence: boolean | undefined,
): TutorialChapter[] {
	switch (page) {
		case CHILD_HOME_GUIDE_PAGE:
			return getChildTutorialChapters(uiMode, { hasActivities: presence });
		case 'checklist':
			return getChildChecklistGuideChapters(uiMode, presence);
		case 'shop':
			return getChildShopGuideChapters(uiMode, presence);
		case 'status':
			return getChildStatusGuideChapters(uiMode, presence);
		default:
			return [];
	}
}

/**
 * 対象が「ある」と分かっているときだけ selector を付ける。
 * 無い / 分からないときは selector 無し = 説明型 step (中央表示、偽の spotlight を描かない)。
 */
function anchoredWhenPresent(
	selector: string,
	presence: boolean | undefined,
): Pick<TutorialStep, 'selector'> {
	return presence === true ? { selector } : {};
}

/**
 * チェックリスト (/checklist) の章。`hasItems` = チェックする項目が 1 つでもあるか。
 * (チェックリストが在っても項目 0 件なら押す行が無いので、項目の有無で判定する)
 */
function getChildChecklistGuideChapters(
	uiMode: string,
	hasItems: boolean | undefined,
): TutorialChapter[] {
	const L = getChildPageGuideLabels(uiMode);
	const steps: TutorialStep[] =
		hasItems === false
			? [
					{
						id: 'child-checklist-empty',
						chapterId: 1,
						title: L.checklistEmptyTitle,
						description: L.checklistEmptyDesc,
						position: 'bottom',
					},
				]
			: [
					{
						id: 'child-checklist-check',
						chapterId: 1,
						...anchoredWhenPresent(CHILD_PAGE_GUIDE_SELECTORS.checklistItem, hasItems),
						title: L.checklistCheckTitle,
						description: L.checklistCheckDesc,
						position: 'bottom',
					},
					{
						id: 'child-checklist-points',
						chapterId: 1,
						...anchoredWhenPresent(CHILD_PAGE_GUIDE_SELECTORS.checklistPoints, hasItems),
						title: L.checklistPointsTitle,
						description: L.checklistPointsDesc,
						position: 'bottom',
					},
				];
	return [{ id: 1, title: L.checklistChapterTitle, icon: L.checklistChapterIcon, steps }];
}

/** ショップ (/<uiMode>/shop) の章。`hasRewards` = ごほうびが 1 つでもあるか。 */
function getChildShopGuideChapters(
	uiMode: string,
	hasRewards: boolean | undefined,
): TutorialChapter[] {
	const L = getChildPageGuideLabels(uiMode);
	const exchangeStep: TutorialStep =
		hasRewards === false
			? {
					id: 'child-shop-empty',
					chapterId: 1,
					title: L.shopEmptyTitle,
					description: L.shopEmptyDesc,
					position: 'bottom',
				}
			: {
					id: 'child-shop-exchange',
					chapterId: 1,
					...anchoredWhenPresent(CHILD_PAGE_GUIDE_SELECTORS.shopRewardCard, hasRewards),
					title: L.shopExchangeTitle,
					description: L.shopExchangeDesc,
					position: 'bottom',
				};
	return [
		{
			id: 1,
			title: L.shopChapterTitle,
			icon: L.shopChapterIcon,
			steps: [
				exchangeStep,
				{
					// 「交換の記録を見る」リンクはごほうびの有無によらず常に在る
					id: 'child-shop-history',
					chapterId: 1,
					selector: CHILD_PAGE_GUIDE_SELECTORS.shopHistory,
					title: L.shopHistoryTitle,
					description: L.shopHistoryDesc,
					position: 'bottom',
				},
			],
		},
	];
}

/** つよさ / ステータス (/<uiMode>/status) の章。`hasStatus` = ステータスを表示できているか。 */
function getChildStatusGuideChapters(
	uiMode: string,
	hasStatus: boolean | undefined,
): TutorialChapter[] {
	const L = getChildPageGuideLabels(uiMode);
	// どちらの文も「記録すると伸びる / たまると上がる」という画面の決まりで、表示の有無に依らず正しい。
	// ステータスが出ていないとき (取得失敗の fallback) は spotlight だけを外す。
	return [
		{
			id: 1,
			title: L.statusChapterTitle,
			icon: L.statusChapterIcon,
			steps: [
				{
					id: 'child-status-growth',
					chapterId: 1,
					...anchoredWhenPresent(CHILD_PAGE_GUIDE_SELECTORS.statusGrowth, hasStatus),
					title: L.statusGrowthTitle,
					description: L.statusGrowthDesc,
					position: 'bottom',
				},
				{
					id: 'child-status-level',
					chapterId: 1,
					...anchoredWhenPresent(CHILD_PAGE_GUIDE_SELECTORS.statusLevels, hasStatus),
					title: L.statusLevelTitle,
					description: L.statusLevelDesc,
					position: 'top',
				},
			],
		},
	];
}

/**
 * ホームの子供チュートリアル（#4652、EPIC #4650 判断 3 / 4 / 5）
 *
 * 「記録して閉じる」最短経路だけを 3 章 5 step で説明する（ADR-0012 anti-engagement）:
 *   1. きろくしよう: 活動カード（光る）→ とりけし（説明、中央）
 *   2. まいにち つづけよう: 💮 スタンプ（光る）
 *   3. ほかの がめん: 下ナビ つよさ / ステータス（光る）→ ショップ（光る）
 *
 * #4864 以降、本章は **ホームの ❓ だけ** が開く (他の画面は各画面の章を開く)。
 *
 * - selector を持つ step は**ホームに常在する UI** だけを指す（押す step は必ず光る）。
 *   コンボ / おみくじ（記録結果 dialog・スタンプ演出の中にしか無い）/ レーダーチャート（/status）は
 *   ホームに無い仕組みのため step を置かない。
 * - 文言は labels.ts `getChildTutorialLabels(uiMode)` の年齢帯 variant（preschool / elementary =
 *   ひらがな、junior / senior = 漢字）で、nav 名（つよさ / ステータス、ショップ）・とりけし秒数は
 *   画面と同じ定数を参照する。
 *
 * `hasActivities` は「活動カードが 1 枚でもあるか」。0 件のときに
 * `[data-tutorial="activity-card"]` を指して「カードをタップすると」と案内すると、
 * **光らせる先も押すものも無い**（初回演出 `AdventureStartOverlay` と同じクラスの欠陥）。
 * 0 件では selector を外して説明型 step に落とし、文言も「まだ届いていない」に差し替える。
 * 既定値は持たせない（渡し忘れが型で落ちるようにする）。
 */
export function getChildTutorialChapters(
	uiMode: string,
	options: { hasActivities: boolean | undefined },
): TutorialChapter[] {
	const L = getChildTutorialLabels(uiMode);
	// 3 状態を **別々の文言** にする (#4860)。2 状態に潰すと、どちらかが必ず嘘になる画面が出る:
	//
	//   true      ホームに活動カードがある      → spotlight して「タップすると」
	//   false     ホームに活動カードが無い      → 「まだ届いていません」(無いものを指さない)
	//   undefined 件数が分からない            → **あるとも無いとも言わない**
	//
	// `undefined` を `false` に倒すと、活動が 40 件ある子に「まだ届いていません」と嘘をつく
	// (adversarial 実測)。`true` に倒すと元の欠陥に戻る。件数を知っているのはホーム画面だけ。
	const recordCardStep =
		options.hasActivities === undefined
			? {
					// selector 無し = 説明型（中央表示）。カードの有無が分からないので指さない。
					id: 'child-record-card',
					chapterId: 1,
					...L.steps['child-record-card-elsewhere'],
					position: 'bottom' as const,
				}
			: options.hasActivities
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
 *
 * #4864: 画面ごとの章は store がこの scope の後ろに `:<page>` を足して分ける
 * (ホームだけは足さない = #4864 以前の進捗をそのまま使う)。
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
