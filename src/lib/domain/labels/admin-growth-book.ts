// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/growth-book。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS, adminScreenHeading } from '../admin-screens';
import { CHILD_TERMS, POINT_TERMS } from '../terms';

// ============================================================
// demo/+page.svelte (#1452 Phase B)
// ============================================================

// ============================================================
// admin/growth-book ページ (#1452 Phase B)
// ============================================================

export const GROWTH_BOOK_LABELS = {
	pageHeading: adminScreenHeading('growthBook'),
	backToReports: '← レポートへ',
	// #4716 item 12: 「395pt」が .svelte に直書きされ、単位が POINT_TERMS を経由していなかった。
	monthlyTotalPoints: (points: number) => `${points.toLocaleString()}${POINT_TERMS.unit}`,
	printButton: '🖨️ 印刷 / PDF',
	premiumNotePrefix: 'PDF保存は',
	premiumNoteLink: 'スタンダードプラン以上',
	premiumNoteSuffix: 'で利用できます。',

	// Cover
	titleSuffix: 'がんばり記録',
	fiscalYearRange: (year: number) => `${year}年度（${year}年4月〜${year + 1}年3月）`,
	currentLevel: (level: number, title: string) => `現在レベル: ${level}（${title}）`,

	// Annual summary
	annualSummaryTitle: '📊 年間サマリー',
	statActivities: '活動回数',
	statPoints: '獲得ポイント',
	// #4716: 同じ表の中で「活動回数 / 獲得ポイント」(漢字) と混在していた
	statMaxStreak: '最長連続日数',
	statCertificates: `${ADMIN_SCREENS.certificates.name}`,
	bestMonthLabel: 'いちばんがんばった月: ',
	bestCategoryLabel: 'とくいなカテゴリ: ',

	// Monthly pages
	monthlyTitle: '📅 月別の記録',
	monthlyActivities: (count: number) => `${count}回`,
	monthlyDays: (days: number) => `${days}日活動`,
	monthlyStreak: (days: number) => `🔥 ${days}日連続`,
	// #4697: 年度は 4 月〜翌 3 月を必ず 12 行並べるため未来月の枠ができる。
	// 旧実装はそこにも累計値を出しており、まだ来ていない月に記録があるように見えた。
	monthlyFutureNote: 'これからの月',
	valueNotYet: '—',

	// Certificate link
	certificateLink: `${adminScreenHeading('certificates')}を見る →`,

	// Empty states
	noChildrenEmoji: '👧',
	noChildrenText: `${CHILD_TERMS.honorific}が登録されていません`,
	noDataEmoji: '📖',
	noDataText: 'データがありません',

	// Activity category names
	categoryUndou: 'うんどう',
	categoryBenkyou: 'べんきょう',
	categorySeikatsu: 'せいかつ',
	categoryKouryuu: 'こうりゅう',
	categorySouzou: 'そうぞう',
} as const;
