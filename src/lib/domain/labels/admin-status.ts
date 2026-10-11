// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/status。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS, adminScreenHeading } from '../admin-screens';
import { CHILD_TERMS } from '../terms';

// ============================================================
// 注: OPS_LICENSE_KEY_LABELS (旧 /ops/license/[key] 詳細ページ) は Epic #2525 Phase 7 PR-L4
//     (#2836) license key 全廃に伴い撤去済 (route は PR-L3 #2818 で物理削除)。
// ============================================================

// ============================================================
// 成長レポートページ (#1452 Phase B / #4715 で「ベンチマーク管理」→ 画面名 registry へ)
// ============================================================

export const STATUS_LABELS = {
	// #4715: nav / title と同じ画面名を画面内見出しにも出す (registry SSOT)
	pageHeading: adminScreenHeading('status'),
	// Navigation link
	childrenEditLink: `${ADMIN_SCREENS.children.name}でステータス編集 →`,

	// Growth report
	growthReportTitle: (nickname: string) => `📊 ${nickname}の成長レポート`,
	radarChartNote: '※ 参考値です。お子さまの個性やペースを大切にしてください',
	analysisSummaryTitle: '📋 分析サマリー',
	monthlyChangeTitle: '📈 先月からの変化',
	comparisonLabel: '同年齢の平均',

	// Level title customization
	levelTitleSectionTitle: '🏷️ レベル称号カスタマイズ',
	levelTitleDesc:
		'各レベルの称号を家庭オリジナルに変更できます。空欄にするとデフォルトに戻ります。',
	levelTitleSaveButton: '保存',
	levelTitleResetButton: 'リセット',
	levelTitleResetTooltip: 'デフォルトに戻す',
	levelTitleResetAllButton: '全ての称号をデフォルトに戻す',
	levelTitleSaveSuccess: '称号を更新しました',
	levelTitleOpenLabel: '▼ 開く',
	levelTitleCloseLabel: '▲ 閉じる',

	// Benchmark info box
	benchmarkInfoTitle: 'ベンチマークとは？',
	benchmarkInfoDesc1: `${CHILD_TERMS.honorific}のステータスを「同じ年齢の目安値」と比べて偏差値を計算するためのデータです。`,
	benchmarkInfoDesc2: `設定すると、${CHILD_TERMS.honorific}の画面に「みんなよりすごい！」などの比較メッセージが表示されます。`,

	// #4669 F2: 表示対象のお子さま切替タブ (全保護者) / F1: 子供 0 人時の案内
	childTabsAriaLabel: '表示するお子さまを選ぶ',
	emptyNoChildren: 'お子さまが登録されると、ここに成長レポートが表示されます。',
	emptyNoChildrenLink: `${ADMIN_SCREENS.children.name}でお子さまを登録する →`,
	// #4669 F11: 分析サマリー 3 段階コメント (しきい値は validation/status.ts ANALYSIS_DEVIATION_*)
	analysisHigh: '同年齢の中でも特に活発です',
	analysisMid: '平均的なペースで成長しています',
	analysisLow: 'これから伸びる余地がたくさんあります',

	// Benchmark guide
	benchmarkGuide: (age: number, meanLow: number, meanHigh: number, sdLow: number, sdHigh: number) =>
		`${age}歳の目安: 平均 ${meanLow}〜${meanHigh} XP、SD ${sdLow}〜${sdHigh}（XPベース）`,
	benchmarkUnsetWarning: (age: number) =>
		`${age}歳のベンチマークが未設定のカテゴリがあります。設定すると${CHILD_TERMS.honorific}の画面の比較メッセージが正しく機能します。`,
	benchmarkSaveButton: '保存',
	benchmarkSaveSuccess: 'ベンチマークを更新しました',

	// Deviation preview
	deviationPreview: (nickname: string, deviation: number, emoji: string, text: string) =>
		`${nickname}: 偏差値 ${deviation}（${emoji} ${text}）`,

	// Form labels
	meanLabel: '平均（目安値）',
	sdLabel: 'SD（ばらつき）',

	// #4512: 偏差値帯 → 親向け自然言語 (旧: +page.svelte の getAnalysisText 内直書き) は
	// #4669 F11 が同一文言を analysisHigh / analysisMid / analysisLow として先に集約済みのため、
	// merge 時に重複定義を削除し #4669 側の命名に寄せた (二重定義を作り直さない)。

	// #4512: benchmark form action の validation メッセージ (旧: +page.server.ts 直書き)
	levelInvalid: 'レベルが不正です',
	titleLengthInvalid: '称号は1〜20文字で入力してください',
	benchmarkValueInvalid: '平均は0以上、標準偏差は0より大きい値を入力してください',
} as const;
