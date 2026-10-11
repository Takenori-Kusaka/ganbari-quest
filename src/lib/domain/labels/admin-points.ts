// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/points。置き場所の規則は docs/DESIGN.md §6
import { adminScreenHeading } from '../admin-screens';
import { CHILD_TERMS, POINT_TERMS, POINTS_ADMIN_TERMS } from '../terms';

export const POINTS_LABELS = {
	// ページヘッダー
	pageTitle: adminScreenHeading('points'),
	displaySetting: (isCurrencyMode: boolean, currency: string) =>
		`表示: ${isCurrencyMode ? currency : 'ポイント（P）'}`,

	// 残高カード
	// #4716: 旧「変換可能: 0P」は「かんたん」タブ (単位切り上げ) だけの値なのに、
	//   同じ画面の「自由入力」タブでは 1P から変換できるため矛盾して読めた。
	//   どちらのタブの話かを名前に入れる (語自体は POINTS_ADMIN_TERMS.convertable が SSOT。
	//   #4658 のページガイドも同じ atom を読むので、カードとガイドの呼称が割れない)。
	convertableLabel: (amount: string) => `${POINTS_ADMIN_TERMS.convertable}: ${amount}`,

	// 変換フォーム
	// #4716: 同じ画面に「変換可能」「変換P数」(漢字) が並ぶのに見出しだけひらがなだった。
	//   ここは保護者しか見ない画面なので漢字に揃える。
	convertFormTitle: (childName: string) => `${childName}のおこづかいに変換する`,
	currencyModeHint: '💡 変換した金額を実際にお子さまへお渡しください',

	// モードタブ
	tabPreset: POINTS_ADMIN_TERMS.tabPreset,
	tabManual: POINTS_ADMIN_TERMS.tabManual,
	tabReceipt: POINTS_ADMIN_TERMS.tabReceipt,

	// プリセットモード
	presetLabel: (unit: string, minAmount: string) => `変換${unit}数（${minAmount}単位）`,
	presetMinAmountNote: (minAmount: string, current: string) =>
		`${minAmount}以上で変換できます（現在 ${current}）`,

	// 手動モード
	manualLabel: (unit: string) => `変換${unit}数（自由入力）`,
	manualOverBalanceError: '残高を超えています',
	manualMinError: '1P以上を入力してください',
	manualHintCurrency: (current: string) => `残高: ${current}`,
	manualHintPoints: (current: string) => `1P = 1円 / 残高: ${current}`,
	manualPlaceholder: '金額を入力',
	manualMaxButton: POINTS_ADMIN_TERMS.maxButton,

	// 領収書モード
	// #3694: OCR 画像は base64 JSON body で送るため、AWS 本番は Function URL 6MB request cap に
	// 整合した実効上限をサーバが返す (デコード後上限は runtime で下方整合される)。
	receiptImageTooLarge: (maxMb: string) => `画像サイズは${maxMb}MB以下にしてください`,
	receiptLabel: '領収書を撮影して金額を読み取り',
	receiptCaptureButtonTitle: '領収書を撮影 / 画像を選択',
	// #3775 ②: 表示上限 (MB) は実行環境で異なる (aws-prod ~4.1MB / NUC・local 5MB)。静的 5MB 表記は
	// aws-prod の実効 reject 閾値と乖離し「5MB と書いてあるのに 4.5MB が弾かれる」UX 齟齬を生むため、
	// server が実際に reject する実効値 (resolveMaxBase64DecodedBytes → toDisplayMb) を load で解決して渡す。
	receiptCaptureButtonNote: (maxMb: string) => `JPEG, PNG, WebP（${maxMb}MB以下）`,
	receiptPreviewAlt: '領収書プレビュー',
	receiptPreviewClose: 'プレビューを閉じる',
	receiptScanningText: '金額を読み取り中...',
	receiptRetakeButton: '再撮影する',
	receiptResultLabel: '読み取り結果',
	receiptAmountHint: '金額が違う場合は修正できます',
	receiptCurrencyUnit: '円',
	receiptOverBalance: (balance: string) => `残高（${balance}）を超えています`,
	receiptConfirmButton: 'この金額で変換する',
	receiptConfirmedLabel: '金額確定済み',
	receiptRetakeOtherButton: '別の領収書を撮影する',
	// #4512: OCR 呼び出しの失敗表示 (旧: +page.svelte 直書き)。
	// receiptScanFailed は API が error.message を返さなかったときの fallback。
	// PO 決裁 2026-09-10 決定 5: 1 世帯あたりの読み取り回数の上限に達したときの文言。
	// **アップグレード導線を出さない** — 上限は売った機能の制限ではなく、連打・誤操作で
	// ベンダーコストが青天井になるのを止める線なので、上位プランでも外れない。
	receiptQuotaExceeded: '今日はここまでです。明日またお使いいただけます',
	receiptScanFailed: '読み取りに失敗しました',
	receiptNetworkError: '通信エラーが発生しました',
	// #4512: convert action の validation / service エラー表示 (旧: +page.server.ts 直書き)
	convertInputInvalid: '入力が不正です',
	convertAmountNotInteger: `${POINT_TERMS.unitFull}は整数で入力してください`,
	convertPresetUnit: `${POINT_TERMS.unitFull}は500単位で変換できます`,
	convertChildNotFound: `${CHILD_TERMS.honorific}が見つかりません`,
	convertInsufficientPoints: `${POINT_TERMS.unitFull}が足りません`,
	convertInvalidAmount: '金額が不正です',
	// #4366: AI 側の事情 (未設定 / 権限なし) と画像が読めなかったことを言い分ける。前者で撮り直しを
	// 促すと顧客は自分の写真が悪いと誤解する。どちらも次アクション (手入力) を必ず示す (ADR-0062)。
	//
	// オーナー決裁 2026-08-07 (PO 提示の文言は「例示」であり、そのまま採用しない): 出すのは
	// (1) 顧客のせいではないこと (2) 運営が把握していること (3) いま何ができるか の 3 点。
	// (1) を先頭に置くのは、#4366 の実害が「自分の写真が悪い」と誤解して撮り直すことだから。
	//
	// (2) は事実として書ける — 観測経路 (`[ai-alert] ai-provider-unavailable` log → alarm
	// `ganbari-quest-ai-provider-unavailable`) が `ALARM_NOTIFY_POLICY` で `notify: true` =
	// Discord の障害通知に届く (同決裁「アラートは Discord の障害通知へ webhook で飛ばす」)。
	//
	// 復旧を待たせる一文は置かない。手入力で今すぐ進めるので、待機を要求する理由がない。
	// 文言と通知方針の整合は `tests/unit/domain/receipt-ai-unavailable-message.test.ts` が固定する。
	//
	// **配備で 2 本に分ける。** (2) が成り立つのは運営が運用しているクラウド配備だけで、
	// alarm は AWS の `OpsStack` にしか無い。自宅 NUC のセルフホスト家庭に「運営が検知済み」と
	// 出すのは事実として嘘であり、しかも本当に直せるのは目の前の親自身なのに「誰かが対応中」と
	// 告げて設定を直す動機を奪う。`not-configured` (env が配られていない) は、まさにその家庭が
	// 最も踏みやすい経路。選択は `src/lib/server/ai/unavailable-message.ts` が実行モードから行う。
	receiptAiUnavailableManaged:
		'写真ではなくシステム側の不具合で、運営が検知済みです。金額を手入力してください。',
	// セルフホスト (NUC / ローカル) 版。実体は設定・資格情報の欠落なので「システム障害」とは
	// 書かない (過剰な障害宣言は親の不安と問い合わせを不必要に増やす)。直せる場所
	// (サーバーの AI 設定) を示しつつ、いま手入力で完了できることを併記する。
	receiptAiUnavailableSelfHosted:
		'写真ではなくサーバーのAI設定が原因です。設定を直すか金額を手入力してください。',
	receiptOcrFailed: '画像から金額を読み取れませんでした。撮り直すか、金額を手入力してください。',
	receiptAmountNotFound: '金額を読み取れませんでした',

	// 変換プレビュー
	convertPreviewBalance: (current: string, after: string) => `残高: ${current} → ${after}`,
	convertPreviewMonthTotal: (current: string, after: string) =>
		`／今月の合計: ${current} → ${after}`,
	convertPreviewYenUnit: '円',
	convertPreviewSuffix: '分のおこづかい',
	convertSubmitLoading: '変換中...',
	convertSubmitCurrency: (amount: string) => `${amount} を渡す`,
	convertSubmitPoints: (amount: string) => `${amount} を変換する`,

	// 空状態
	noConvertable: (unit: string) => `変換可能な${unit}がありません`,

	// 変換結果
	resultBalance: (balance: string) => `残高: ${balance}`,

	// 変換履歴
	historyTitle: POINTS_ADMIN_TERMS.historyTitle,
	historySummaryThisMonth: '今月の合計',
	historySummaryAllTime: '累計',
	historyFilterThisMonth: POINTS_ADMIN_TERMS.historyFilterThisMonth,
	historyFilterLastMonth: POINTS_ADMIN_TERMS.historyFilterLastMonth,
	historyFilterAll: POINTS_ADMIN_TERMS.historyFilterAll,
	historyEmpty: 'この期間の変換履歴はありません',
} as const;

// #3593 ④: system 生成 ポイント台帳 (point_ledger) description の SSOT。
// これらは DB に data 値として保存されると同時に、ポイント履歴 UI に表示される system 文言。
// ADR-0045 に従い service 層のコード直書きを避け、labels compound に集約する
// (「ポイント」は POINT_TERMS.unitFull atom を参照)。
export const POINT_LEDGER_LABELS = {
	/** baby モード初期ポイント付与 (親設定) の ledger description */
	initialSetup: '親による初期ポイント設定',
	/** ポイント → おこづかい変換の ledger description (変換モード別サフィックス付き) */
	convert(amount: number, mode: 'preset' | 'manual' | 'receipt'): string {
		const base = `${amount}${POINT_TERMS.unitFull}をおこづかいにかえました`;
		if (mode === 'manual') return `${base}（手動入力）`;
		if (mode === 'receipt') return `${base}（領収書読み取り）`;
		return base;
	},
} as const;
