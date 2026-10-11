// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin (ホーム。月次の価値プレビューを含む)。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS } from '../admin-screens';
import { jstDayOfWeek } from '../date-utils';
import {
	ADMIN_HOME_TERMS,
	ADMIN_VIEW_TERMS,
	CHILD_TERMS,
	REWARD_TERMS,
	USAGE_SUMMARY_TERMS,
} from '../terms';
import { formatYearMonth } from './format';

/**
 * AdminHome ダッシュボード用ラベル (#1465 Phase D)
 */
export const ADMIN_HOME_LABELS = {
	pageTitle: `${ADMIN_VIEW_TERMS.canonical} - がんばりクエスト`,
	pageTitleDemoSuffix: ' デモ',
	// #3144: ごほうび交換の承認待ち導線バナー (pending > 0 のときのみ表示)
	pendingRedemptionBanner: (count: number) =>
		`${REWARD_TERMS.canonical}の交換申請が ${count} 件 ${ADMIN_HOME_TERMS.pendingApproval}です。確認して受け渡しましょう`,
	// #3148: 承認待ち件数の取得に失敗したときの導線 (silent 非表示で見落とすのを防ぐ)
	pendingRedemptionLoadFailed: `${REWARD_TERMS.canonical}の承認待ち件数を取得できませんでした。交換申請の確認ページを開いてください`,
	// #4653 F6 / #4715: 旧「管理ダッシュボード」は画面上のどこにも無い語で title と別名だった。
	// 画面名の SSOT は ADMIN_SCREENS (nav / title / 見出しを同じ registry から引く)。
	heading: ADMIN_SCREENS.home.name,
	headingDemoSuffix: '（デモ）',
	onboardingCompleteText: 'すべてのセットアップが完了しました！',
	onboardingDismissButton: '非表示にする',
	tutorialBannerTitle: '初めてご利用ですか？',
	tutorialBannerHint: 'チュートリアルで使い方を確認しましょう（約3分）',
	tutorialStartButton: '開始',
	tutorialLaterButton: 'あとで',
	// #3033: freePlanQuick* 削除済 (plan-quick-link 撤去、プラン導線は header upgrade-btn に一本化)
	// #2295 (EPIC #2294 ①): seasonalSectionTitle / memoryTicket* 削除済 (2026-05-19)
	summaryChildrenAria: `登録${CHILD_TERMS.honorific}数`,
	// #4653: カード名はページガイドと同じ atom を参照する / #4716: 呼称は honorific (atom 側で統一)
	summaryChildrenLabel: ADMIN_HOME_TERMS.childrenCountCard,
	summaryPointsAria: '全ポイント合計',
	summaryPointsTotalPrefix: ADMIN_HOME_TERMS.totalCard,
	monthLabel: (year: string, month: string) => formatYearMonth(year, month),
	monthlyHeadingPrefix: '📊 ',
	monthlyHeadingSuffix: ADMIN_HOME_TERMS.monthlySuffix,
	monthlyDetailsLink: ADMIN_HOME_TERMS.monthlyDetailsLink,
	monthlyChildActivitiesAria: (name: string) => `${name}の活動回数`,
	monthlyChildLevelAria: (name: string) => `${name}のレベル`,
	monthlyChildAchievementsAria: (name: string) => `${name}の実績`,
	monthlyActivitiesHeading: '活動回数',
	monthlyActivitiesUnit: '回',
	monthlyLevelHeading: 'レベル',
	monthlyAchievementsHeading: '実績',
	monthlyAchievementsUnit: '獲得',
	todayUsageHeading: '⏱️ ',
	weeklyUsageHeading: '📈 ',
	// #4653: セクション名はページガイドと同じ atom を参照する / #4716: 呼称は honorific (atom 側で統一)
	childrenSectionTitle: ADMIN_HOME_TERMS.childrenSection,
	childrenEmpty: `まだ${CHILD_TERMS.honorific}が登録されていません`,
	demoCtaTitle: 'いかがでしたか？',
	demoCtaHint: 'お子さまの「がんばり」を冒険に変えませんか？',
	demoCtaButton: '無料で はじめる →',
} as const;

// ============================================================
// 本日の使用時間 (#1292: 自動スリープ + 使用時間可視化)
// AdminHome の使用時間セクションで利用
// ============================================================

export const USAGE_TIME_LABELS = {
	// #4713: LP 料金比較表の行名と同じ atom から引く (旧「日次サマリー」行が指す画面を一致させる)
	todayUsage: `${USAGE_SUMMARY_TERMS.today}`,
	todayUsageOf: (childName: string) => `${childName}の本日使用時間`,
	minutesUsed: (min: number) => `${min}分使用`,
	minutesOf15: (min: number) => `${min}分 / 15分`,
	// Phase 2: 週次 bar chart (#1576)
	weeklyUsage: `${USAGE_SUMMARY_TERMS.weekly}`,
	weeklyUsageOf: (childName: string) => `${childName}の今週使用時間`,
	noData: 'まだデータがありません',
	minutesUnit: '分',
	minutesUnitDisplay: '（分）',
	dayOfWeek: (date: string) => {
		const days = ['日', '月', '火', '水', '木', '金', '土'] as const;
		// 曜日は JST SSOT 経由 (#4015)。旧実装は +9h の手組みオフセット後に
		// ローカル TZ getter を読む形で、date-utils と同じ計算を二重に持っていた。
		return days[jstDayOfWeek(new Date(date))];
	},
	chartBarAriaLabel: (childName: string, date: string, min: number) => {
		const days = ['日', '月', '火', '水', '木', '金', '土'] as const;
		return `${childName} ${days[jstDayOfWeek(new Date(date))]}曜日 ${min}分`;
	},
} as const;

export const VALUE_PREVIEW_LABELS = {
	/** dashboard セクションタイトル */
	sectionTitleFirstMonth: 'はじめての 30 日',
	sectionTitle30DayPreview: '1 か月の歩み',
	sectionHintFirstMonth: (daysSince: number) =>
		`登録から ${daysSince} 日目です。あと ${Math.max(0, 30 - daysSince)} 日で 1 か月の節目になります`,
	sectionHint30DayPreview: '1 か月のお子さまのがんばりをまとめました',
	totalActivitiesLabel: '記録した活動',
	totalActivitiesUnit: '回',
	currentStreakLabel: '現在の連続記録',
	currentStreakUnit: '日',
	longestStreakLabel: '最長連続記録',
	totalPointsLabel: 'ためたポイント',
	totalPointsUnit: 'pt',
	achievedMilestonesHeading: '達成したマイルストーン',
	noMilestonesYet: 'まだマイルストーン未達成です。最初の記録から始めましょう',
	categoryBreakdownHeading: 'カテゴリ別の活動回数',
	noCategoryData: 'まだ記録がありません',
	emptyState: 'まだお子さまの活動記録がありません',
	previewBannerHint: '続けて記録するほど、このグラフが充実していきます',
	categoryCountAria: (categoryName: string, count: number): string => `${categoryName} ${count} 回`,
} as const;
