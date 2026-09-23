// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/reports。置き場所の規則は docs/DESIGN.md §6
import { adminScreenHeading } from '../admin-screens';
import { CHILD_TERMS, WEEKDAY_TERMS } from '../terms';

export const REPORTS_LABELS = {
	// #4512: カテゴリ名は categories.ts (SSOT) から引く。ここに持つのは
	//   「SSOT に無い id が来たとき」の表示だけ (旧実装は 5 カテゴリを漢字で並行実装していた)
	categoryUnknown: 'その他',
	// ページヘッダー
	pageTitle: adminScreenHeading('reports'),
	// #4715: 着地先の画面名 (registry SSOT) をそのまま出す。旧「証明書」「記録ブック」は
	//   同じ画面の短縮別名で、着地先の title / 見出しと一致していなかった。
	certificatesLink: adminScreenHeading('certificates'),
	growthBookLink: adminScreenHeading('growthBook'),

	// 設定更新完了
	settingsUpdated: '設定を更新しました',

	// アップセルバナー
	weeklyEmailUpsellTitle: '✉️ 週次メールレポートはスタンダードプラン以上の特典です',
	weeklyEmailUpsellDesc:
		'毎週設定した曜日に、お子さまのがんばりをまとめたレポートがメールで届きます。週次レポートタブでプレビューはいつでもご覧いただけます。',
	weeklyEmailUpsellLink: 'プランを見る →',

	// タブ
	tabMonthly: '月次レポート',
	tabWeekly: '週次レポート',

	// 月次レポート
	monthlyEmpty: (monthLabel: string) => `${monthLabel}のレポートがありません`,
	monthlyEmptyNote: '活動を記録すると、月次レポートが生成されます',
	monthlyChildReport: (childName: string) => `${childName}の がんばりレポート`,
	monthlyActivityLabel: '活動',
	monthlyActivityUnit: '回',
	// #4697: 月次の「ポイント」は台帳のその月の獲得合計 (子供画面の所持ポイントと同じ単位)。
	// 旧実装は XP 累計を出しており、どの月でも同じ数 = 先月比が常に ±0 だった。
	monthlyPointsLabel: 'ポイント',
	monthlyPointsUnit: 'pt',
	monthlyPointsHint: '今月ためた分',
	// #4697: XP は「ポイント」と別の量 (消費されない成長の累計)。名前を分けて併記する。
	monthlyXpLabel: 'つよさ (XP)',
	monthlyXpUnit: 'XP',
	monthlyXpHint: 'これまでの合計',
	monthlyLevelLabel: 'レベル',
	monthlyStreakLabel: '連続',
	monthlyStreakUnit: '日',
	monthlyAchievementsLabel: '実績',
	monthlyAchievementsUnit: '獲得',
	monthlyActiveDaysLabel: '活動日数',
	monthlyActiveDaysOf: (total: number | string) => `/ ${total}日`,
	monthlyAvgLabel: '1日平均',
	monthlyAvgUnit: '回',
	monthlyPrevMonth: '先月比',
	monthlyCategoryTitle: '📈 カテゴリ別の様子',
	monthlyCategoryCount: (count: number | string) => `${count}回`,

	// 週次レポート - 設定セクション
	weeklySettingsTitle: '⚙️ レポート設定',
	weeklySettingsUpgradeNote: 'スタンダードプラン以上でメール配信設定を変更できます',
	weeklySettingsEnableLabel: '週次レポートを有効にする',
	weeklySettingsDayLabel: '配信曜日',
	// #4512: 配信曜日セレクトの表示名。旧実装は +page.svelte で 7 曜日を別に列挙していた
	// (WEEKDAY_TERMS atom の直書き複製、ADR-0045 §3.3)。
	weeklySettingsDayNames: WEEKDAY_TERMS as Record<string, string>,
	weeklySettingsDayInvalid: '無効な曜日です',
	weeklySettingsSave: '保存',

	// 週次レポート - 空状態
	weeklyEmpty: 'レポートがありません',
	weeklyEmptyNote: `${CHILD_TERMS.honorific}を登録すると、毎週レポートが生成されます`,

	// 週次レポート - カード
	weeklyChildReport: (childName: string) => `${childName}の 週間レポート`,
	weeklyActivityLabel: '活動',
	weeklyActivityUnit: '回',
	weeklyPointsLabel: 'ポイント',
	weeklyPointsUnit: 'pt',
	weeklyAchievementsLabel: '実績',
	weeklyAchievementsUnit: '獲得',
	weeklyHighlightsTitle: '🏆 今週のハイライト',
	weeklyCategoryTitle: '📈 カテゴリ別の様子',
	weeklyAchievementsTitle: '🎖️ 獲得した実績',
	weeklyAdviceTitle: '💡 アドバイス',
	weeklyCategoryCount: (count: number | string) => `${count}回`,

	// きょうだいランキング
	rankingTitle: '👫 きょうだいランキング',
	rankingWeekSummaryTitle: '📊 今週のまとめ',
	rankingMostActive: (childName: string, count: number | string) =>
		`🏆 もっとも活発: ${childName}（${count}回）`,
	rankingWeekTrendTitle: '📈 週別 活動数のうつりかわり',
	rankingWeekCategoryTitle: '📊 今週のカテゴリ別くらべっこ',
	rankingMonthCategoryTitle: '📊 今月のカテゴリ別くらべっこ',
	rankingMonthMostActive: (childName: string, count: number | string) =>
		`🏆 今月もっとも活発: ${childName}（${count}回）`,
} as const;
