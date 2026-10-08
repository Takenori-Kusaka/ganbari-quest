// labels 層 (ADR-0045 / #4965): 2 つ以上の画面に出る src/lib/features/ の部品 (既存の FEATURES_LABELS。新しい部品は FEATURES_<X>_LABELS を作り FEATURES_LABELS には足さない) と AI 入力・PWA 案内。1 つの画面にだけ出る部品の文言はその画面のファイルに置く。置き場所の規則は docs/DESIGN.md §6
// #4482: 保持日数の「整形」も SSOT を経由する。表示側で `${days}日` と独自整形すると、
// 保持日数を 365 の倍数に変えたときにここだけ「365日」と述べ、料金表の「1年」と食い違う。
import { formatRetentionPeriod } from '../constants/plan-retention';
import {
	ACTIVITY_ADMIN_TERMS,
	ADD_MENU_TERMS,
	ADMIN_HOME_TERMS,
	AI_TRANSFER_TERMS,
	BACKUP_TERMS,
	CHILD_TERMS,
	CONCEPT_ICONS,
	OVERFLOW_MENU_TERMS,
	PARENT_TERMS,
	PLAN_FULL_TERMS,
	PLAN_TERMS,
	PWA_TERMS,
	TEMPLATE_TERMS,
} from '../terms';
import { COPY_FROM_CHILD_LABELS } from './admin-shared';
import { FEATURES_BATTLE_LABELS } from './child-battle';
import { NAV_ITEM_LABELS } from './nav';

// ============================================================
// AI 送信の注意書き (#4599)
// ============================================================
//
// AI 提案 3 種 (活動 / チェックリスト / ごほうび) と領収書 OCR の 4 経路で共有する
// 唯一の定義。4 経路にコピペせず、`AiInputNotice.svelte` 経由で参照する。
//
// プライバシーポリシー第9条④ (#4583 / PR #4598) と同じ事実を、入力する瞬間に短く述べる。
// ADR-0012 (anti-engagement) 整合で警告は積み上げない。
//
// **送信先の別は画面でも述べる (#4598 QM レビュー指摘で方針変更)**。`getAiProvider()` は
// `AI_PROVIDER` で送信先を切り替え、領収書 OCR も AI 提案も同じ factory を通るため、
// **同じ画面文言のまま送信先だけが配布形態で変わる**。条文が書き分けている 2 ケース
// (運営者が管理する環境内 / 設定により運営者の環境外) を画面が丸めてしまうと、
// 氏名・住所が写った画像がどちらへ行くのかを顧客が画面から判断できない。
// 旧方針 (「送信先の詳細は条文リンクに委ねる」) は本指摘で置き換える。条文への導線は維持する。
// 生成 AI の製品名・モデル名はここにも UI にも書かない (#4370 / #4583 と同一規律)。

/** 送信先の別 (第9条④ と同じ粒度)。text / image の両経路で同一文を共有する。 */
const AI_DESTINATION_NOTICE = `送信先は${AI_TRANSFER_TERMS.destinationCloud}、${AI_TRANSFER_TERMS.destinationSelfHosted}です。`;

export const AI_INPUT_NOTICE_LABELS = {
	/** 送信先の別 (第9条④ と同じ 2 ケース)。text / image が共有する */
	destination: AI_DESTINATION_NOTICE,
	/** テキスト入力経路 (AI 提案 3 種) */
	text: `入力した文章は${AI_TRANSFER_TERMS.genAi}に送信されます。${AI_DESTINATION_NOTICE}${CHILD_TERMS.honorific}の${AI_TRANSFER_TERMS.identifyingInfo}は書かないでください。`,
	/**
	 * 画像アップロード経路 (領収書 OCR)。
	 * #4598 PO 回答 (2026-09-03): 領収書には宛名 (氏名・住所) が印字されていることがあり、
	 * 第9条④ の注意喚起を法務文書だけに置いて画面に出さないのは届いていないのと同じ。
	 * 送信される画像に何が写りうるか (宛名の氏名・住所 / お子さまの特定情報) を入力の瞬間に述べる。
	 * 送信先の別 (AI_DESTINATION_NOTICE) も同じ hint で述べる (QM レビュー指摘、上記コメント)。
	 */
	image: `アップロードした領収書画像は${AI_TRANSFER_TERMS.genAi}に送信されます。${AI_DESTINATION_NOTICE}${AI_TRANSFER_TERMS.receiptPrintedInfo}や${CHILD_TERMS.honorific}の${AI_TRANSFER_TERMS.identifyingInfo}が写らないようご注意ください。`,
	/** 送信先の詳細 (条文) への導線 */
	linkLabel: '送信先とあつかい',
	linkHref: 'https://www.ganbari-quest.com/privacy.html#under-age',
} as const;

export const FEATURES_LABELS = {
	// ---- features/battle/ ----
	battle: FEATURES_BATTLE_LABELS,

	// ---- features/birthday/ ----
	birthday: {
		// BirthdayBanner
		bannerTitle: 'おたんじょうびボーナスがとどいているよ！',
		bannerSub: (name: string, age: number) => `${name}${age}さいおめでとう！ タップしてうけとろう`,
		bannerPoints: (totalPoints: number) => `⭐${totalPoints}pt`,
		// BirthdayModal
		modalMainPreClaimed: 'おたんじょうび おめでとう！',
		modalAgeText: (name: string, age: number) => `${name}${age}さい になったね！`,
		modalRewardLabel: '🎁 おたんじょうびボーナス',
		modalRewardPoints: (points: number) => `⭐ ${points} ポイント！`,
		modalClaiming: 'もらっています...',
		modalClaimBtn: '🎉 うけとる！',
		modalConfirmYounger: 'やったー！',
		modalConfirmOlder: 'ありがとう！',
		modalSubBaby: 'これからも いっぱい がんばろうね！',
		modalSubElementary: 'これからもたくさんチャレンジしよう！',
		modalSubOlder: 'これからもチャレンジを続けよう！',
		modalMainBaby: (name: string, age: number) => `${name}${age}さい\nおめでとう！`,
		modalMainOlder: (name: string, age: number) => `${name}${age}歳\nおめでとう！`,
	},

	// ---- features/certificate/ ----
	certificate: {
		// CertificateTemplate
		title: 'がんばり証明書',
		quote: (title: string) => `「${title}」`,
		issuer: 'がんばりクエスト',
		watermarkText: 'SAMPLE',
		// ShareCard
		branding: 'がんばりクエスト',
	},

	// ---- features/character/ ----
	character: {
		// CharacterTabs — 短縮タブラベル
		tabStatusYoung: 'つよさ',
		tabStatusOlder: 'ステータス',
		tabChallenge: 'チャレンジ',
		tabHistoryYoung: 'きろく',
		tabHistoryOlder: '記録',
		// #4681: バトル入口 (elementary / junior / senior のみ。LP「ボスバトル」訴求の到達経路)
		tabBattle: 'バトル',
	},

	// ---- features/challenge/ ----
	challenge: {
		// SiblingCelebration
		celebrationTitle: 'みんなクリア！',
		/**
		 * #4689: 自分だけのチャレンジ (兄弟が同じ内容を持たない = group が自分 1 人) を達成したときの見出し。
		 * 週次自動生成は子供ごとに内容が違うため、この形が既定になる。
		 */
		celebrationTitleSolo: 'チャレンジ クリア！',
		celebrationClaimBtn: `${CONCEPT_ICONS.reward} ごほうびをうけとる！`,
		celebrationCloseBtn: 'とじる',
		// #4410 AC4: 閉じたあとどこで受け取るのかをダイアログ内で示す。claim ボタン自体は
		// 戻さない (#3333 の二重導線排除を壊さない) — 場所の案内だけを置く。
		celebrationClaimHint: `ごほうびは とじたあと したの「${CONCEPT_ICONS.reward} ごほうびをうけとる！」ボタンから うけとれるよ`,
		// #3361 (ux-4): claim 失敗時の可視フィードバック (dead-end 回避、NN/G #1)
		claimErrorTitle: 'うけとれなかったよ',
		claimErrorFallback: 'もういちど ためしてね',
	},

	// ---- features/child/ ----
	child: {
		// TutorialHintBanner
		hintTitle: 'つかいかた ガイド あるよ！',
		hintSub: 'いつでも ❓ ボタンで みれるよ',
		hintCloseAriaLabel: '閉じる',
		// #4690 F5: junior / senior (13-18 歳) 向けの漢字表記 (docs/DESIGN.md §8)。
		hintTitleKanji: '使い方ガイドがあります',
		hintSubKanji: 'いつでも ❓ ボタンから見られます',
	},

	// ---- features/loyalty/ ----
	loyalty: {
		// ChurnPreventionModal
		churnListBullet: '・',
		churnTitle: '解約する前に...',
		churnContinuingMonths: (months: number) => `あなたは ${months}ヶ月 継続中です`,
		churnLostHeading: '解約すると失われるもの:',
		churnInsightCount: (name: string, count: number) =>
			`💡 ${name}は 今月 ${count}回 がんばりました`,
		churnNote: '※ 解約しても基本データは残ります。再開すれば継続月数も引き継がれます。',
		churnKeepBtn: 'やっぱり続ける',
		churnCancelBtn: '解約手続きへ',
		// LoyaltyBadge
		badgeTitle: 'サポーターバッジ',
		badgeSub: (months: number) => `サポーター継続: ${months}ヶ月目`,
		badgeMonths: (months: number) => `${months}ヶ月`,
		badgeNextLabel: (remaining: number) => `次のバッジまで: あと${remaining}ヶ月`,
		badgeAllReached: '🏆 全ティア到達！',
		badgeMemoryTickets: (count: number) => `思い出チケット: ${count}枚`,
		badgeLoginBonus: (multiplier: number) => `ログインボーナス ×${multiplier}`,
	},

	// ---- features/admin/components/ AI suggest 共通 ----
	// Phase 7 PR-L4 (#2836): 顧客可視の AI suggest gate 文言を premium atom 参照化 (ADR-0058)。
	aiSuggestCommon: {
		familyOnlyBadge: `${PLAN_TERMS.premium}限定`,
		familyOnlyError: (kind: string) => `${kind}は${PLAN_FULL_TERMS.premium}でご利用いただけます`,
		familyOnlyDescription: (kind: string) => `${kind}は${PLAN_FULL_TERMS.premium}で解放されます。`,
		familyUpgradeBtn: `${PLAN_FULL_TERMS.premium}にアップグレード`,
		thinkingLabel: '考え中...',
		suggestBtn: '提案する',
		retryBtn: 'やり直す',
		fallbackNote: 'AIが利用できなかったため、入力内容から推定しました',
		errorEstimate: '推定に失敗しました',
		errorNetwork: 'ネットワークエラーが発生しました',
		progressBaseAi: 'AIに聞いています...',
		progressBaseWait: 'もうちょっと待ってね...',
		progressBaseFinal: 'あとすこし...',
		progressChecklistThinking: 'もちものを考え中...',
	},

	// ---- features/admin/components/AiSuggestPanel ----
	aiSuggestActivity: {
		title: '✨ やりたいことを教えてください',
		kind: 'AI 活動提案',
		description: 'やりたい活動を自由に入力すると、カテゴリ・ポイント・アイコンを自動で提案します',
		placeholder: '例: ピアノの練習をした、公園で走った、折り紙を作った',
		acceptBtn: 'この内容で追加フォームを開く',
		previewKana: (kana: string) => `ひらがな: ${kana}`,
		previewKanji: (kanji: string) => `漢字: ${kanji}`,
	},

	// ---- features/admin/components/AiSuggestChecklistPanel ----
	aiSuggestChecklist: {
		title: '✨ どんなもちものが必要？',
		kind: 'AI チェックリスト提案',
		description: `シーンや学年を入力すると、${NAV_ITEM_LABELS.checklists}を自動で提案します`,
		placeholder: '例: 小学3年生の月曜日の持ち物、えんそく、プール',
		acceptBtn: 'この内容でテンプレートを作成',
		itemCount: (count: number) => `(${count}個)`,
		freqDaily: 'まいにち',
		dirBring: '持参',
		dirReturn: '持帰',
		dirBoth: '往復',
	},

	// ---- features/admin/components/AiSuggestRewardPanel ----
	aiSuggestReward: {
		title: '✨ どんなごほうびがいい？',
		kind: 'AI ごほうび提案',
		description: 'ごほうびの内容を自由に入力すると、カテゴリ・ポイント・アイコンを自動で提案します',
		placeholder: '例: おもちゃ、外食、ゲーム時間+30分、おこづかい500円',
		acceptBtn: 'この内容で入力する',
	},

	// ---- features/admin/components/PremiumWelcome ----
	premiumWelcome: {
		dialogAriaLabel: (planLabel: string) => `${planLabel}へようこそ`,
		titleLine1: (planIcon: string, planLabel: string) =>
			`がんばりクエスト ${planIcon} ${planLabel} へ`,
		titleLine2: 'ようこそ！',
		dividerLabel: '解放された機能',
		message: 'お子さまの「がんばり」を\nもっと楽しく応援しましょう！',
		ctaBtn: 'さっそく始める →',
	},

	// ---- features/admin/components/AdminLayout ----
	adminLayout: {
		demoBadge: 'デモ',
		upgradeBtn: 'アップグレード',
		pageGuideTitle: 'このページの使い方',
		tutorialRestartTitle: 'チュートリアルを開始',
		demoTopLink: 'デモトップ',
		// #4653: ページガイドと同じ atom を参照する / #4716: 呼称は honorific (atom 側で統一)
		switchToChild: ADMIN_HOME_TERMS.switchToChild,
		desktopNavAriaLabel: '管理メニュー',
		mobileNavAriaLabel: 'メインナビゲーション',
		mobileMenuCloseAriaLabel: 'メニューを閉じる',
	},

	// ---- features/admin/components/AddActivityModeSelector ----
	// ---- features/admin/components/HiddenActivitiesSection ----
	hiddenActivities: {
		toggleLabel: (count: number) => `${ACTIVITY_ADMIN_TERMS.hiddenSection} (${count}件)`,
		closeIcon: '▲ 閉じる',
		openIcon: '▼ 開く',
		recordCount: (count: number) => `/ 記録 ${count}件`,
		restoreBtn: ACTIVITY_ADMIN_TERMS.restore,
		permanentDeleteBtn: ACTIVITY_ADMIN_TERMS.permanentDelete,
	},

	// ---- features/admin/components/TrialEndedDialog ----
	trialEndedDialog: {
		title: '無料体験が終了しました',
		message: '無料体験期間が終了しました。\nフリープランの範囲内で引き続きご利用いただけます。',
		messageLine1: '無料体験期間が終了しました。',
		messageLine2: 'フリープランの範囲内で引き続きご利用いただけます。',
		note1: `${PLAN_FULL_TERMS.free}の上限を超えるお子さま・活動・チェックリストは一時的に非表示（アーカイブ）になります`,
		note2: 'データは削除されません — 有料プランにすると自動で元に戻ります',
		ctaBtn: '⭐ プランを見る',
		dismissBtn: 'あとで',
	},

	// ---- features/admin/components/ActivitiesHeader ----
	// EPIC #2253 / #2255 / #2257: + dropdown menu + ︙ overflow menu に再構成
	// #2260 Fix-2: +page.svelte L167 hardcode の Dialog title 3 件を SSOT 化 (ADR-0045 / ADR-0009)
	activitiesHeader: {
		// #4655 F10: 概念アイコンは CONCEPT_ICONS.activity (📝) に統一 (旧 📋 は checklist と同一)
		title: `${CONCEPT_ICONS.activity} ${NAV_ITEM_LABELS.activities}`,
		exportAriaLabel: 'エクスポート',
		introduceAriaLabel: '活動の紹介',
		clearAllAriaLabel: '全クリア',
		// + dropdown menu に統合 (EPIC #2253 / #2255 / #2558 段階2)
		// #2558 段階2 (PO 方針: マーケットプレイス一本化): 「追加」と「一括追加」を 1 つの
		// 「+ 追加」メニューに統合。`import` 項目は admin 内ブラウズ UI を撤去し /marketplace へ画面遷移する。
		addButtonLabel: ADD_MENU_TERMS.trigger,
		addMenuAriaLabel: '活動を追加するメニューを開く',
		addManualLabel: ADD_MENU_TERMS.manual,
		addManualIcon: '✏️',
		addAiLabel: ADD_MENU_TERMS.ai,
		addAiIcon: '✨',
		// #2558 段階2 (bug-3 / bug-4 根治): 内部語彙「パック」を排し、admin 内ブラウズ UI でなく
		// みんなのテンプレート (/marketplace) への画面遷移を表す文言に統一。
		addBrowseTemplatesLabel: ADD_MENU_TERMS.browse,
		addBrowseTemplatesIcon: '🔍',
		// #2558 段階2: copy / bulk を + 追加メニューに統合 (トップレベル独立ボタンを撤去)
		addCopyFromChildLabel: COPY_FROM_CHILD_LABELS.action,
		addCopyFromChildIcon: '📋',
		addBulkLabel: ADD_MENU_TERMS.bulk,
		addBulkIcon: '👨‍👩‍👧‍👦',
		// Add Dialog title (mode 別、#2260 Fix-2 で +page.svelte hardcode を SSOT 化)
		addDialogTitleManual: '+ 手動で追加',
		addDialogTitleAi: '✨ AI で活動を追加',
		// ︙ overflow menu (restore / export / clear-all、EPIC #2253 / #2257 + #2558 段階2)
		// #2371 (EPIC #2362 PO 指摘 ③): introduce 撤去 (PR #2388 で PageGuideOverlay v2 + PageGuideRegistry 経由 `?` ボタンに統一済)
		// #2558 段階2: マーケットプレイスとは別概念の「バックアップから復元」をブラウズ UI 撤去に伴い overflow menu に独立配置
		overflowMenuAriaLabel: 'その他の操作',
		overflowTriggerLabel: '︙',
		restoreLabel: OVERFLOW_MENU_TERMS.itemRestore,
		restoreIcon: OVERFLOW_MENU_TERMS.itemRestoreIcon,
		exportLabel: OVERFLOW_MENU_TERMS.itemExport,
		exportIcon: '📤',
		clearAllLabel: OVERFLOW_MENU_TERMS.itemClearAll,
		clearAllIcon: '🗑',
		// #2558 段階2: バックアップから復元ダイアログ (旧 UnifiedImportHub file セクションの独立化)
		restoreDialogTitle: `📥 ${OVERFLOW_MENU_TERMS.itemRestore}`,
		// #backup-terms: 活動取込は JSON バックアップに加え CSV (自作表計算) も読み込めるため CSV を露出する (ADR-0013 truth、#3079 AC4)
		// #3201: 2 つの入力源 (書き出したバックアップ / 自作 CSV) を平易に並記 + 家族全体 (画像・音声含む)
		// の復元先は 設定 > データ である旨を誘導 (受理 format が画面ごとに異なる混乱の予防)
		restoreDialogDesc: `以前書き出した活動の${BACKUP_TERMS.file}か、表計算ソフトで作った${BACKUP_TERMS.csvFile}を読み込んで取り込みます。みんなのテンプレートの取り込みとは別の機能です。家族全体のデータ（画像・音声を含む）の${BACKUP_TERMS.restoreVerb}は「設定 > データ」から行えます。`,
		restoreSubmitBtn: '読み込む',
		restoreProcessing: '読み込み中…',
		restoreSuccess: (name: string, imported: number, skipped: number) =>
			skipped > 0
				? `✨ 「${name}」から ${imported} 件を復元しました (${skipped} 件は既存のためスキップ)`
				: `✨ 「${name}」から ${imported} 件を復元しました`,
		restoreAllDuplicates: (name: string) => `「${name}」の活動はすべて既に登録済みです`,
		restoreFailed: '復元に失敗しました',
		restoreDemo: 'デモではお試し用です（実際の復元は行われません）',
		restoreFileRequired: 'ファイルを選択してください',
		restoreFileFallbackName: 'ファイル',
	},

	// ---- features/admin/components/NotificationPermissionBanner ----
	// #2115 (Bug fix: loading / try-catch / Toast / fallback)
	// #2116 (透明性 UX: 2 段階開示 informed consent)
	notificationBanner: {
		title: '通知でもっと便利に',
		desc: '毎日のリマインダーで お子さまの がんばりを サポートしましょう',
		// #2116 AC1: 第 1 段階 (頻度 / 内容 / 送信先 / quiet hours が一目で把握可能)
		descCompact:
			'毎日 1 回まで、お子さまのがんばりリマインダーを親端末にお届けします（21:00-07:00 はお休み）',
		ctaBtn: '通知を受け取る',
		dismissBtn: 'あとで',
		// #2115 AC2: loading 中表示
		loadingLabel: '設定中…',
		// #2115 AC3: 成功 Toast
		toastSuccessTitle: '通知を有効化しました',
		toastSuccessDesc: '次回から大事なリマインダーをお届けします',
		// #2115 AC4: 失敗 fallback UI
		errorTitle: '通知を有効にできませんでした',
		errorDescDenied: 'ブラウザの設定で通知が拒否されている可能性があります。',
		errorDescGeneric: '通知の設定中にエラーが発生しました。時間をおいて再度お試しください。',
		errorSettingsLinkLabel: 'ブラウザの通知設定を確認する方法',
		// #2116 AC3-4: 2 段階開示 disclosure
		disclosureLabel: '📖 通知について詳しく',
		disclosureContent: {
			reminderTitle: 'がんばりリマインダー（毎日 1 回まで）',
			reminderExample: '例:「きょうも がんばろう！」「○○さんの がんばりを きろくしよう！」',
			streakWarningTitle: '連続記録のお知らせ',
			streakWarningExample: 'がんばりの連続記録が途切れそうなときにお知らせします',
			achievementTitle: '達成のお祝い',
			achievementExample: 'お子さまが新しいバッジや称号を獲得したときにお知らせします',
		},
		disclosureParentOnly: '通知はすべて親端末にのみ送られます。お子さまの端末には届きません。',
		disclosureQuietHours: '21:00〜07:00 はおやすみ時間で通知を送りません。',
		disclosureOffNote: '通知はあとから設定画面でいつでも OFF にできます。',
		disclosureSettingsLinkLabel: '通知の設定画面を開く',
	},

	// ---- features/admin/components/OnboardingChecklist ----
	onboardingChecklist: {
		progressAriaLabel: (pct: number) => `セットアップ進捗 ${pct}%`,
		nextRecLabel: '次のおすすめ:',
		dismissBtn: '非表示にする',
	},

	// ---- features/admin/components/PlanStatusCard ----
	planStatusCard: {
		freePlan: `${PLAN_FULL_TERMS.free}`,
		// Phase 7 PR-L4 (#2836): /admin/subscription の現在プランカードを premium atom 参照化 (ADR-0058)。
		// 旧「スタンダード プラン」「ファミリー プラン」直書きは family→premium rename 漏れだった。
		// 短縮 atom + 「 プラン」(空白付き) で従来の表示文字列を維持する。
		standardPlan: `${PLAN_TERMS.standard} プラン`,
		familyPlan: `${PLAN_TERMS.premium} プラン`,
		unlimited: '無制限',
		// #4482: 整形は formatRetentionPeriod が SSOT（365 の倍数なら「1年間」と述べる）。
		retentionDays: (days: number) => `${formatRetentionPeriod(days)}間`,
		trialBadge: (days: number) => `トライアル中（残り${days}日）`,
		statCustomActivity: 'カスタム活動',
		statChildren: `${CHILD_TERMS.honorific}`,
		statRetention: 'データ保持',
		trialNote: (tierLabel: string) =>
			`${tierLabel}の全機能を体験中です。トライアル終了後もこのまま使うには本契約が必要です。`,
		processingText: '処理中...',
		makeContractBtn: '本契約する',
		upgradeBtn: '⭐ スタンダードにアップグレード',
		planDetailLink: 'プランの詳細',
		// Phase 7 PR-L4 (#2836): premium atom 参照化 (ADR-0058、family→premium rename 漏れ)。
		familyUpgradeBtn: `⭐⭐ ${PLAN_TERMS.premium}へ`,
	},

	// ---- features/admin/components/ActivityImportPanel (#2391 で物理削除済) ----
	// 旧 ActivityImportPanel.svelte は UnifiedImportHub.svelte に統合された。
	// UNIFIED_IMPORT_HUB_LABELS が後継 SSOT。

	// ---- features/admin/components/ActivityLimitBanner ----
	activityLimitBanner: {
		title: (current: number, max: number | null) =>
			`登録上限に達しています（${current}/${max ?? '無制限'}）`,
		linkLabel: 'プランをアップグレード →',
	},

	// ---- features/admin/components/ActivityClearAllConfirm ----
	activityClearAllConfirm: {
		// #4692 F3: 対象範囲を書かない「本当に全削除しますか？」は撤去。
		// 確認文は ADMIN_CHILD_SCOPE_LABELS.clearAllScopedConfirm(子の名前, 件数) を使う。
		processingText: '処理中...',
		executeBtn: '実行',
		cancelBtn: 'やめる',
		resultMessage: (deleted: number, hidden: number) =>
			`🗑 ${deleted}件削除、${hidden}件非表示にしました`,
	},

	// ---- features/admin/components/ActivityListItem ----
	activityListItem: {
		mainQuestBadge: '⚔️ メインクエスト ×2',
		closeBtn: '閉じる',
		editBtn: ACTIVITY_ADMIN_TERMS.edit,
		visibleBtn: ACTIVITY_ADMIN_TERMS.visible,
		hiddenBtn: ACTIVITY_ADMIN_TERMS.hidden,
		mainQuestEnable: ACTIVITY_ADMIN_TERMS.mainQuestEnable,
		mainQuestDisable: ACTIVITY_ADMIN_TERMS.mainQuestDisable,
		dailyLimitDefault: '1回/日',
		dailyLimitUnlimited: '無制限',
		dailyLimitN: (n: number) => `${n}回/日`,
		ageRange: (min: number, max: number) => `${min}-${max}歳`,
	},

	// ---- features/admin/components/ActivityEmptyState ----
	// EPIC #2253 / #2256: primary CTA + secondary import link の 2 段構成 (bulk import bridge)
	activityEmptyState: {
		filteredText: 'この条件に一致する活動はありません',
		noActivities: '活動がまだ登録されていません',
		addBtn: '+ 最初の活動を追加',
		// #2558 段階2 (bug-3 / bug-4 根治): admin 内ブラウズ UI でなく /marketplace への遷移を表す文言に統一
		secondaryImportLink: `または、${TEMPLATE_TERMS.userFacing}から探す`,
	},

	// ---- features/admin/components/ChildListCard ----
	childListCard: {
		meta: (age: number, tierLabel: string, themeLabel: string) =>
			`${age}歳 / ${tierLabel} / ${themeLabel}`,
	},
} as const;

// #4644: ホーム画面への追加 (インストール) ガイドの文言。
//
// 親向けの案内。ADR-0012 整合で「押し付けない」— バナーは閉じたら二度と出さず、
// 恒久導線は 設定 > サポート に置く (フィードバック導線と同じ SSOT、DESIGN.md §10)。
export const PWA_INSTALL_LABELS = {
	/** 案内バナーの見出し */
	bannerTitle: `${PARENT_TERMS.honorific}の方へ: ${PWA_TERMS.installAction}できます`,
	/** 案内バナーの本文 (メリットを 1 文で) */
	bannerBody: `${PWA_TERMS.installAction}すると${PWA_TERMS.standalone}で起動し、${CHILD_TERMS.honorific}がブラウザのタブや URL 欄を誤って操作することなく使えます。`,
	/** Android / Chrome: ブラウザ標準のインストールダイアログを起動する */
	bannerInstallAction: PWA_TERMS.installAction,
	/** iOS Safari 等、beforeinstallprompt が無い環境で手順を開く */
	bannerHowToAction: '追加方法をみる',
	/** バナーを閉じる (以後表示しない) */
	bannerDismiss: '閉じる',
	/** 閉じるボタンの aria-label (「以後出ない」ことを読み上げでも伝える) */
	bannerDismissAria: '追加の案内を閉じる（次回から表示しません）',
	/** 手順ダイアログ / 設定内カードの見出し */
	guideTitle: `${PWA_TERMS.installAction}する方法`,
	/** 手順ダイアログの導入文 */
	guideIntro: `お使いの端末に合わせて操作してください。追加しても${PWA_TERMS.standalone}で開くだけで、アプリを別途インストールするわけではありません。`,
	/** Android / Chrome 手順の見出し */
	androidTitle: 'Android / Chrome の場合',
	androidStep1: '画面右上の「⋮」（メニュー）をひらく',
	androidStep2: `「${PWA_TERMS.installAction}」または「アプリをインストール」をえらぶ（Chrome の版によっては「インストール」を含む別の名前です）`,
	androidStep3: '確認画面で「追加」をおす',
	/**
	 * Android で項目が見つからないとき (#4979)。タブレットの Chrome は子メニューの中に入っており、
	 * 管理された端末のランチャー等では項目自体が出ない (アプリ側では直せない) ことを正直に伝える。
	 */
	androidHint: `見当たらないときは、メニューの「${PWA_TERMS.chromeSaveShareMenu}」の中も確認してください。会社や学校で管理されている端末などでは項目自体が出ないことがあり、その場合もブラウザのままお使いいただけます。`,
	/** iOS / Safari 手順の見出し */
	iosTitle: 'iPhone / iPad（Safari）の場合',
	iosStep1: `画面下の「${PWA_TERMS.iosShareButton}」ボタン（□に↑）をおす。見当たらないときは「${PWA_TERMS.iosMoreButton}」ボタンをおすと出てきます`,
	iosStep2: `メニューを下にスクロールして「${PWA_TERMS.installAction}」をえらぶ`,
	iosStep3: `「${PWA_TERMS.iosWebAppToggle}」が出たらオンのまま、右上の「追加」をおす`,
	/** 追加後に何が起きるか */
	afterNote: `追加すると、ホーム画面のアイコンから${PWA_TERMS.standalone}で開けるようになります。`,
	/** 設定 > サポート のカード見出し */
	settingsCardTitle: PWA_TERMS.installAction,
	/** 設定 > サポート のカード説明 */
	settingsCardDesc: `${CHILD_TERMS.honorific}が安全に使えるよう、ホーム画面にアイコンを置く手順をいつでも確認できます。`,
	/** 設定 > サポート の展開ボタン */
	settingsCardAction: '手順をみる',
	/** ダイアログを閉じる */
	close: '閉じる',
} as const;
