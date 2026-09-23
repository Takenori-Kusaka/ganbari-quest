// labels 層 (ADR-0045 / #4965): 運営者画面 (src/routes/ops/)。置き場所の規則は docs/DESIGN.md §6
// #4505: プラン行ラベル表 (OPS_LABELS.planRowLabels) の網羅を型で強制するために型だけを引く
import type { SubscriptionPlan } from '../constants/subscription-plan';
import { CANCEL_TERMS, PLAN_TERMS, PRICE_TERMS } from '../terms';
import { ERROR_PAGE_LABELS } from './errors';
import { formatYearMonth } from './format';

export const OPS_LABELS = {
	// #4118 手 3: 契約状態監査 (contract-state-matrix.md §7 の 3 手目)。
	// 手 2 (webhook 適用後の行が S1-S6 に収まる) は「これから入る変更」を止めるが、
	// **すでに本番に存在する不正行**は検出しない。本セクションはその在庫を出す。
	contractStateTitle: '契約状態の監査',
	contractStateDesc:
		'契約 4 列 (状態 / プラン / 契約 ID / 期限) の組み合わせを分類し、表に無い状態の行を出します。',
	contractStateHealthy: (total: number) => `${total} 件すべて正常な状態です`,
	contractStateFound: (n: number) => `要確認 ${n} 件`,
	contractStateTruncated: (n: number) => `他 ${n} 件は表示を省略しています (集計には含みます)`,
	contractStateColTenant: 'テナント',
	contractStateColClassification: '分類',
	contractStateColStatus: '状態',
	contractStateColColumns: 'プラン / 契約 ID / 期限',
	contractStateHas: 'あり',
	contractStateNone: 'なし',

	// #4269 ①: 継続月キーの滞留在庫。prefix 無しの旧値が残っていると継続月数の加算が
	// 「基準不明」として skip され続けるため、その件数を同じ在庫に 1 行出す。
	// **0 件でも出す** (行が消えると「見ていない」と区別がつかない)。
	loyaltyMonthKeyLabel: '基準不明の継続月キー',
	loyaltyMonthKeyCount: (legacy: number, total: number) => `${legacy} 件 / 保存済み ${total} 件`,
	loyaltyMonthKeyDesc:
		'値の基準が判別できない古い保存値です。残っている間、その家族の継続月数の加算は安全側に見送られます。',

	// ページタイトル
	pageTitle: 'OPS - KPI サマリー',

	// フェッチ時刻
	fetchedAt: (dateStr: string) => `${dateStr} 時点`,

	// KPI カード
	kpiLabelTotal: '総テナント数',
	kpiLabelActive: 'アクティブ',
	kpiLabelGracePeriod: '猶予期間',
	kpiLabelSuspended: '停止中',
	kpiLabelTerminated: `${CANCEL_TERMS.account}済み`,
	kpiNewThisMonth: (n: number | string) => `+${n} 今月`,

	// プラン別内訳
	planBreakdownTitle: 'プラン別内訳（アクティブテナント）',
	planColPlan: 'プラン',
	planColTenants: 'テナント数',
	planColMrr: 'MRR 概算',
	/** プラン未設定の行 (#4505)。サインアップ直後 / トライアル中の**正常な**状態。 */
	planNone: '未設定（トライアル等）',
	/**
	 * プランは設定されているのにプラン集合に無い値だった行 (#4505)。
	 *
	 * 正常なら常に 0。1 以上ならプラン値の書き手がずれている合図なので、未設定と**同じ行に
	 * まとめない**（まとめると「トライアルが少し増えただけ」に見えて異常が埋もれる）。
	 */
	planUnknown: '不明なプラン値（要確認）',
	planTotalMrr: '合計 MRR',
	/** 月次経常収益を生まない行 (買い切り / プラン未設定) の MRR 欄。 */
	planMrrNone: '-',
	/**
	 * プラン値 → 行ラベル (#4505)。
	 *
	 * 画面はこの表を引いて行を組み立てるため、**プランが増えたら型で表の追加が要求される**
	 * (`Record<SubscriptionPlan, string>`)。旧実装のように行を手で並べると、追加したプランが
	 * 画面から抜けても誰も気づかない (プレミアムのテナントが不可視だった原因)。
	 * 行ごとの個別 key (旧 `planMonthly` / `planPremiumMonthly` 等) は本表に統合済み — key を
	 * 増やす形に戻すと、プラン追加時に型が何も要求しなくなる。
	 */
	planRowLabels: {
		monthly: `月額 (${PRICE_TERMS.standard}/月)`,
		yearly: `年額 (${PRICE_TERMS.standardYearly}/年)`,
		'family-monthly': `${PLAN_TERMS.premium}月額 (${PRICE_TERMS.family}/月)`,
		'family-yearly': `${PLAN_TERMS.premium}年額 (${PRICE_TERMS.familyYearly}/年)`,
		lifetime: 'ライフタイム',
	} satisfies Record<SubscriptionPlan, string>,

	// 価格見直しトリガー
	triggerTitle: '価格見直しトリガー',
	triggerFired: (n: number | string) => `${n}件発動中`,
	triggerSkipped: 'スキップ',
	triggerNormal: '正常',
	triggerFiredBadge: '発動',
	triggerCurrentValue: (val: string, threshold: string, months: string, required: string) =>
		`現在値: ${val}% / 閾値: ${threshold}% (${months}/${required}ヶ月)`,
	triggerRecommendation: (rec: string) => `推奨: ${rec}`,
	triggerEvaluatedAt: (dateStr: string, paidUsers: string) =>
		`評価日時: ${dateStr} | 有料ユーザー: ${paidUsers}人`,

	// admin bypass メトリクス
	bypassTitle: 'admin bypass merge メトリクス',
	bypassEvidenceMissing: (n: number | string) => `${n}件 証跡欠落`,
	bypassNormal: '正常',
	bypassUnavailable: 'データ未取得',
	bypassUnavailableReason: (reason: string | null | undefined) =>
		`${reason ?? 'GitHub API に接続できませんでした'}（GITHUB_TOKEN 未設定時は非表示。ADR-0044 参照）`,
	bypassEmpty: (months: number | string) =>
		`直近 ${months} ヶ月の admin bypass merge は 0 件です。`,
	bypassColMonth: '月',
	bypassColTotal: 'merge 総数',
	bypassColBypass: 'admin bypass',
	bypassColMissing: '証跡欠落',
	bypassSummaryTotal: '合計',
	bypassFetchedAt: (dateStr: string) => `取得日時: ${dateStr} | 運用ルール:`,
	bypassAdrLink: 'ADR-0044 (archive)',

	// plan 逆引き不能の滞留 (#4128)
	planDriftTitle: 'プラン判定できていない契約',
	planDriftDesc:
		'Stripe の Price と env / lookup_key が食い違うと、課金額と使える機能がずれたまま滞留します。',
	planDriftHealthy: (n: number | string) => `${n} 件の契約すべてでプランを判定できています。`,
	planDriftFound: (n: number | string) => `${n}件 要対応`,
	planDriftDisabled: 'Stripe 連携が無効な環境のため検査していません。',
	planDriftError: (name: string) =>
		`Stripe への照会に失敗したため確認できませんでした（${name}）。詳細は CloudWatch ログを参照してください。`,
	planDriftTruncated: (n: number | string) =>
		`取得上限 ${n} 件に達しました。表示は一部の可能性があります。`,
	planDriftColTenant: 'テナント',
	planDriftColSubscription: 'サブスクリプション',
	planDriftColStatus: '状態',
	planDriftColPrice: 'Price / lookup_key',
	planDriftColCurrentPlan: '保持中のプラン',
	planDriftUnknownTenant: '（テナント未特定）',
	planDriftUnknownValue: '—',
	planDriftMultiItem: (n: number | string) => `item ${n} 件`,

	// システム状態
	systemTitle: 'システム状態',
	stripeLabel: 'Stripe 連携:',
	stripeEnabled: '有効',
	stripeDisabled: '無効（ローカルモード）',
} as const;

/** ops dashboard 卒業統計セクション (#1603) */
export const OPS_GRADUATION_LABELS = {
	sectionTitle: '卒業フロー集計（#1603）',
	sectionHint: '直近 90 日の卒業者数 / 卒業率 / 平均利用期間 / 公開可能な事例',
	colMetric: '指標',
	colValue: '値',
	metricTotalGraduations: '卒業者数',
	metricConsentedCount: '事例公開承諾数',
	metricAvgUsagePeriod: '平均利用期間（日）',
	metricGraduationRate: '卒業率（卒業 / 全解約）',
	metricTotalCancellations: '直近 90 日の全解約数',
	noData: '直近 90 日の卒業データはありません',
	publicSamplesTitle: '公開可能な卒業事例',
	publicSampleEmpty: '公開承諾された卒業事例はまだありません',
	publicSampleNickname: (nickname: string) => `${nickname} さん`,
	publicSampleUsagePeriod: (days: number) => `ご利用期間: ${days} 日`,
	publicSamplePoints: (pt: number) => `残ポイント: ${pt} pt`,
	graduationRateLabel: (rate: number) => `${(rate * 100).toFixed(1)}%`,
} as const satisfies Record<string, unknown>;

/** ops dashboard 解約理由集計セクション */
export const OPS_CANCELLATION_LABELS = {
	sectionTitle: '解約理由集計（#1596）',
	sectionHint: '直近 90 日の解約理由カテゴリ別比率と件数',
	colCategory: 'カテゴリ',
	colCount: '件数',
	colPercentage: '比率',
	noData: '直近 90 日の解約理由データはありません',
	totalLabel: (n: number) => `合計: ${n} 件`,
	freeTextSearchLabel: '自由記述検索',
	freeTextSearchPlaceholder: 'キーワードで自由記述を絞り込み（最低限機能）',
	freeTextEmpty: '自由記述はまだありません',
	freeTextDate: (date: string) => `${date} 投稿`,
	freeTextCategory: (category: string) => `カテゴリ: ${category}`,
} as const satisfies Record<string, unknown>;

// 注: OPS_LICENSE_ISSUE_LABELS (旧 /ops/license/issue キャンペーンキー発行) は Epic #2525 Phase 7
//     PR-L4 (#2836) license key 全廃に伴い撤去済 (route は PR-L3 #2818 で物理削除)。割引配布は
//     Stripe Dashboard の Coupon / Promotion Code 運用に代替 (Phase 1 補強 3 #2788 §3.6 OQ-2)。

export const OPS_REVENUE_LABELS = {
	pageTitle: 'OPS - 収益',
	mockModeBadge: 'MOCK MODE: ダミーデータを表示中 (STRIPE_MOCK=true)',

	// Stripe KPI section
	stripeKpiTitle: 'Stripe 収益指標',
	kpiLabelPaidUsers: '有料ユーザー数',
	kpiLabelConversionRate: '転換率 (90日)',
	kpiLabelChurnRate: '月次解約率',

	// Trend chart
	trendTitle: '(過去6か月)',
	trendChartAriaLabel: 'MRR トレンドグラフ',
	kpiTrendTitle: 'KPI トレンド',
	tableColMonth: '月',
	tableColPaidCount: '有料数',
	tableColChurnRate: '解約率',

	// DB-based revenue section
	dbRevenueTitle: 'Stripe 請求書ベース収益',
	kpiLabelMrrDb: 'MRR (DB)',
	kpiLabelArrDb: 'ARR (DB)',
	kpiLabelPeriodRevenue: '期間売上合計',
	kpiLabelStripeFeeTotal: 'Stripe手数料合計',

	// Monthly breakdown
	monthlyBreakdownTitle: '月次推移',
	monthlyBreakdownSuffix: (months: number | string) => `(過去${months}か月)`,
	tableColRevenue: '売上',
	tableColCount: '件数',
	tableColFee: '手数料',
	tableColNetIncome: '純収入',

	// Invoices
	invoicesTitle: '請求書一覧',
	invoicesTitleSuffix: '直近',
	invoicesTitleSuffix2: '件',
	invoicesEmpty: '請求書データがありません (Stripe未設定 or 期間内に決済なし)',
	tableColPaidAt: '支払日',
	tableColCustomer: '顧客',
	tableColContent: '内容',
	tableColAmount: '金額',
	tableColFeeLabel: '手数料',

	// Footer
	fetchedAt: (dateStr: string) => `最終取得: ${dateStr}`,
	cacheNote: '(1時間キャッシュ)',
} as const;

export const OPS_BUSINESS_LABELS = {
	pageTitle: 'OPS - 事業採算性',
	mockModeBadge: 'MOCK MODE: ダミーデータを表示中 (STRIPE_MOCK=true)',

	// Breakeven progress card
	breakevenProgressTitle: '損益分岐点 進捗',
	breakevenUsersUnit: (current: number | string, target: number | string) =>
		`${current} / ${target} 名`,
	breakevenUsersUnitSuffix: '名',
	breakevenAchievedBadge: '黒字達成',
	breakevenRemainingUsers: (n: number | string) => `あと ${n} 名`,
	breakevenProgressLabel: '損益分岐点達成率',

	// KPI cards
	kpiLabelRevenue: '今月の収益',
	kpiLabelAwsCost: 'AWS 原価',
	kpiAwsCostUsdSuffix: (usd: string) => `(${usd} USD)`,
	kpiLabelStripeFee: 'Stripe 手数料',
	kpiStripeFeeNote: '(売上 x 3.6%)',
	kpiLabelFixedCosts: '固定費',
	kpiLabelMonthlyProfit: '月間利益',
	kpiProfitLoss: '赤字',

	// Warning card
	warningTitle: '月間利益がマイナスです',
	warningDesc: (n: number | string) => `損益分岐点達成まで有料ユーザー ${n} 名の追加が必要です。`,

	// Breakdown table
	breakdownTitle: '損益内訳',
	tableColItem: '項目',
	tableColAmount: '金額',
	tableRowRevenue: '売上 (Stripe)',
	tableRowAwsCost: '- AWS 原価',
	tableRowStripeFee: '- Stripe 手数料 (3.6%)',
	tableRowMonthlyProfit: '月間利益',

	// Scale tiers
	scaleTiersTitle: '規模帯比較',
	scaleTiersCurrentBadge: '現在',
	scaleTiersUsersRange: (min: number | string, max: string) => `${min}${max} 名`,
	scaleTiersMonthlyRevenue: (yen: string) => `¥${yen}/月`,
	scaleTiersMonthlyRevenueSuffix: '/月',

	// KPI summary
	kpiSummaryTitle: 'Stripe KPI',
	kpiLabelMrr: 'MRR',
	kpiLabelArr: 'ARR',
	kpiLabelArpu: 'ARPU',
	kpiLabelConversionRate: '転換率',
	kpiLabelChurnRate: '解約率',

	// Footer
	fetchedAt: (dateStr: string) => `最終取得: ${dateStr}`,
} as const;

// ============================================================
// ops/analytics ページ (#1452 Phase B)
// ============================================================

export const OPS_ANALYTICS_LABELS = {
	pageTitle: 'OPS - 分析基盤',
	fetchedAt: (dateStr: string) => `${dateStr} 時点`,

	// LTV section
	ltvSectionTitle: 'LTV 推計',
	ltvEstimatedLabel: '推定 LTV',
	ltvEstimatedNote: '= ARPU x 平均継続月',
	ltvArpuLabel: '月次 ARPU',
	ltvArpuNote: (count: number) => `有料会員 ${count} 名`,
	ltvAvgMonthsLabel: '平均継続月数',
	ltvAvgMonthsUnit: 'ヶ月',
	ltvChurnRateLabel: 'チャーンレート',
	ltvChurnedNote: (count: number) => `解約 ${count} 件`,

	// Plan breakdown section
	planBreakdownTitle: 'プラン別 MRR 内訳',
	planColPlan: 'プラン',
	planColTenants: 'テナント数',
	planColMrr: 'MRR',
	planColShare: '割合',
	planNone: '未設定（トライアル等）',

	// Monthly acquisitions section
	acquisitionTitle: '月次ユーザー獲得数（過去 12 ヶ月）',
	acquisitionColMonth: '月',
	acquisitionColNew: '新規登録',

	// Cohort section
	cohortTitle: 'コホート残存分析（入会月別）',
	cohortColMonth: '入会月',
	cohortColSignups: '登録数',
	cohortNote: 'M0 = 入会月、M1 = 1ヶ月後の残存数（残存率%）。現時点のステータスベースの簡易推計。',

	// Data source section
	dataSourceTitle: 'データソース',
	stripeLabel: 'Stripe 連携:',
	stripeEnabled: '有効',
	stripeDisabled: '無効（ローカルモード）',
	pipelineLabel: 'データパイプライン:',
	pipelineDesc: 'DB 直接集計（リアルタイム、追加コストなし）',
	costNote:
		'コスト試算: DB 直接クエリのため追加 AWS コストは $0。DynamoDB Streams + Athena への移行はユーザー数 1,000+ で検討（推定 $5-10/月）。',

	// Activation Funnel section (#2285 EPIC #2283: /admin/analytics 撤去で消失する機能を ops 側へ移動)
	// 内部基盤名 (DynamoDB / Pre-PMF Bucket A) UI 露出禁止 (AN-5 #2180 整合)、「テナント」→「家庭」置換
	activationFunnelTitle: 'Activation Funnel (直近 30 日)',
	activationFunnelDesc: 'signup から 7 日継続までの家庭単位ユニーク件数と遷移率。',
	activationFunnelStepCol: 'ステップ',
	activationFunnelCountCol: '件数',
	activationFunnelConversionCol: '遷移率',
	activationFunnelStepLabels: {
		activation_signup_completed: '① signup',
		activation_first_child_added: '② 初回家庭メンバー登録',
		activation_first_activity_completed: '③ 初回活動完了',
		activation_retained_7d: '④ 7日継続',
	},
	activationFunnelEmpty: 'データがありません',
	activationFunnelHouseholdSuffix: '世帯',
} as const;

// ============================================================
// ops/analytics — setup プリセット選択分布 (#1602, ADR-0023 I13)
// ============================================================

/**
 * #1602: setup challenges (3 軸プリセット) 選択分布セクションのラベル。
 * 内部運営（PO / 運営）が四半期見直し時にプリセット改良の判断に使う。
 */
export const OPS_PRESET_DISTRIBUTION_LABELS = {
	sectionTitle: 'setup チャレンジ選択分布',
	sectionDesc:
		'#1592 で 3 軸に簡素化した setup challenges のうち、各プリセットがどの程度選ばれているかの分布。偏りがあれば残り 2 軸の改良余地を示すサイン。',
	colKey: 'プリセット',
	colCount: '選択数',
	colShare: '割合',
	colBar: '分布',
	totalsLabel: (answered: number, total: number) => `回答 ${answered} 名 / 全テナント ${total} 名`,
	emptyMessage:
		'回答テナントがまだいません。setup を完了したテナントが増えるとここに表示されます。',

	// Bucket labels (#1743: 内部キー露出を排除し顧客語彙に完結)
	bucketHomeworkDaily: '宿題ルーティン',
	bucketChores: '家事のお手伝い',
	bucketBeyondGames: 'ゲーム以外のチャレンジ（読書 / 外遊び / 工作 / 音楽）',
	bucketOther: 'その他（旧キー後方互換）',
	bucketNone: '未回答（setup 未到達 / skip）',

	// Note for ratio interpretation
	ratioNote:
		'割合は「回答テナント数」ベース（複数選択あり、合計 100% を超える）。「未回答」のみ全テナント数ベース。',
} as const;

/**
 * #4282 AC5: `/ops` が MFA 未設定で拒否されたときに出す復旧導線の文言。
 *
 * 運営者専用画面のため顧客には出ない。ここで手順まで出し切るのは、
 * 「拒否されたが何をすれば入れるのか分からない」状態を作らないため
 * (リンク先を読まないと復旧できない導線は導線として成立しない)。
 */
export const OPS_MFA_SETUP_LABELS = {
	title: '多要素認証（MFA）の設定が必要です',
	description:
		'運営ダッシュボードは、ログイン時に多要素認証を通ったセッションだけが利用できます。認証アプリ（TOTP）の設定が済んでいないか、設定後にログインし直していない状態です。',
	stepsTitle: '入れるようにする手順',
	steps: [
		'スマートフォンに認証アプリ（TOTP 対応のもの）を用意する',
		'運営管理者が Cognito ユーザープールで、このアカウントの認証アプリ（TOTP）を有効にする',
		'いったんログアウトし、認証アプリのコードを入力してログインし直す',
	],
	/** 再ログインは MFA チャレンジを経て `amr` を載せ直す唯一の出口。汎用 403 と同じ文言を再利用する */
	loginAgainLabel: ERROR_PAGE_LABELS.btnLoginAgain,
	/**
	 * #4335 follow-up: 旧文言はリポジトリ内ファイルパス（`docs/runbooks/ops-mfa-setup.md`）を
	 * そのまま出しており、403 画面を見ている運営者がその場で開けなかった（クローンを持たない
	 * 環境 / スマートフォンからの閲覧では特に）。依頼先を画面内で完結させる（runbook の詳細手順
	 * は変えず、画面には「自分でできない場合に誰に頼むか」だけを直接書く）。
	 */
	runbookHint: '自分で設定できない場合は、AWS アカウントのオーナーに設定を依頼してください。',
} as const;

// ============================================================
// デモ版 成長レポートページ (#1452 Phase B)
// ============================================================

// ============================================================
// Ops AWS費用ページ (#1452 Phase B)
// ============================================================

export const OPS_COSTS_LABELS = {
	pageTitle: 'OPS - AWS費用',
	prevMonthLink: '← 前月',
	nextMonthLink: '翌月 →',
	yearMonthDisplay: (year: number, month: number) => formatYearMonth(year, month),
	currentCostLabel: '当月 AWS 費用',
	prevMonthDiffLabel: '前月比',
	serviceCountLabel: 'サービス数',
	serviceBreakdownTitle: 'サービス別費用内訳',
	noCostData: '費用データがありません（AWS Cost Explorer API が利用不可、またはデータなし）',
	colService: 'サービス',
	colCostUsd: '費用 (USD)',
	colCostJpy: '概算 (JPY)',
	colRatio: '割合',
	totalRow: '合計',
	lastFetchedPrefix: '最終取得: ',
	cacheNote: '（24時間キャッシュ、API費用: $0.01/リクエスト）',
} as const;

// ============================================================
// デモメンバー管理ページ (#1452 Phase B)
// ============================================================

// ============================================================
// OPS エクスポートページ (#1452 Phase B)
// ============================================================

export const OPS_EXPORT_LABELS = {
	pageTitle: 'OPS - エクスポート',
	exportTitle: '確定申告用CSVエクスポート',
	salesTitle: '売上台帳',
	salesDesc: 'Stripe 請求書ベースの収入記録。青色申告決算書 第1面「収入金額」に対応。',
	salesDownload: 'CSV ダウンロード',
	expensesTitle: '経費台帳',
	expensesDesc: 'AWS 費用 + Stripe 手数料。勘定科目付き。青色申告決算書「必要経費」に対応。',
	expensesDownload: 'CSV ダウンロード',
	summaryTitle: '収支サマリー',
	summaryDesc: '売上・経費・差引利益の一覧。確定申告前の概要確認用。',
	summaryDownload: 'テキスト ダウンロード',
	notesTitle: '注意事項',
	note1: 'AWS 費用は Cost Explorer API から取得（USD→JPY はレート ¥150/$ で概算）',
	note2: 'Stripe 手数料は 3.6% + ¥40/件 の概算値です',
	note3: '消費税区分はインボイス登録状況に応じて調整が必要です',
	note4: '本データは概算値です。正式な申告は税理士に相談してください',
} as const;

// ============================================================
// OPS コホート分析ページ (#1452 Phase B)
// ============================================================

export const OPS_COHORT_LABELS = {
	pageTitle: 'OPS - コホート分析',
	monthlyChurnRateLabel: '月次解約率',
	theoreticalLtvLabel: '理論値 LTV',
	theoreticalLtvNote: 'ARPU / 月次解約率',
	retentionTableTitle: (monthsBack: number) =>
		`月次コホート別リテンション（過去${monthsBack}ヶ月）`,
	noDataMessage: 'コホートデータがありません',
	colCohort: 'コホート',
	colTenantCount: 'テナント数',
	colPaid: '有料',
	insufficientSampleBadge: 'サンプル不足',
	ltvCompareTitle: 'コホート別 LTV 比較',
	theoreticalLtvSummary: (ltv: number) => `理論値 LTV (ARPU/月次解約率): ¥${ltv.toLocaleString()}`,
	lastFetchedPrefix: '最終取得: ',
} as const;

export const OPS_LAYOUT_LABELS = {
	headerTitle: 'がんばりクエスト 運営ダッシュボード',
	navKpi: 'KPI',
	navRevenue: '収益',
	navBusiness: '採算性',
	navCosts: '費用',
	navLicense: 'ライセンス',
	navAnalytics: '分析',
	navCohort: 'コホート',
	navPmfSurvey: 'PMF',
	navExport: 'エクスポート',
} as const;
