// labels 層 (ADR-0045 / #4965): src/lib/ui/ の共有部品 (primitives / components)。置き場所の規則は docs/DESIGN.md §6
import { PLAN_TERMS } from '../terms';
import { PLAN_GATE_LABELS } from './plan';

export const UI_PRIMITIVES_LABELS = {
	// BirthdayInput
	birthdayInputLabel: 'おたんじょうび',
	yearUnit: '年',
	monthUnit: '月',
	dayUnit: '日',
	birthYearAriaLabel: '生まれた年',
	birthMonthAriaLabel: '生まれた月',
	birthDayAriaLabel: '生まれた日',
	birthYearPlaceholder: '----年',
	birthMonthPlaceholder: '--月',
	birthDayPlaceholder: '--日',
	// Dialog / Toast（子供向け UI のため「とじる」表記）
	closeAriaLabel: 'とじる',
	/* #4645: title / ariaLabel がどちらも空のまま開かれた Dialog の最終手段の名前。
	   role="dialog" は accessible name が必須 (WCAG 4.1.2 / axe aria-dialog-name) で、
	   名前が無いとスクリーンリーダーが「何のダイアログか」を読み上げられない。 */
	dialogFallbackAriaLabel: 'ダイアログ',
	// FormField（パスワードトグル）
	passwordHide: 'パスワードを非表示',
	passwordShow: 'パスワードを表示',
	// PinInput（スクリーンリーダー向け）
	pinCodeLabel: 'PINコード',
	// Select
	selectPlaceholder: '選択してください',
	// Menu (#2254 / EPIC #2253)
	menuOpenAriaLabel: 'メニューを開く',
	// Button loading spinner (#2632 CX-DoR #9 NN/G #1、スクリーンリーダー向け)
	loadingAriaLabel: '処理中',
} as const;

export const UI_COMPONENTS_LABELS = {
	// ---- ActivityCard ----
	activityCardFrozenToast: 'おうちのひとに おねがいしてね',
	activityCardCompleted: '（きろくずみ）',
	activityCardMainQuest: '（メインクエスト×2）',
	activityCardMission: '（ミッション）',
	activityCardPinned: '（ピンどめ）',
	activityCardFrozen: '（ロックちゅう）',
	activityCardCountAriaLabel: (count: number) => `${count}かいきろくずみ`,
	activityCardMainQuestBadge: '⚔️ 2ばい!',
	activityCardStreakAriaLabel: (days: number) => `${days}にちれんぞく`,
	// #2146: priority='must' (今日のおやくそく) のカード演出統合用ラベル
	// 旧 MustProgressBar 専用セクションを廃止し、ActivityCard 自身に ribbon badge を付ける
	activityCardMustBadge: '⭐ おやくそく',
	// #4690 F6: junior / senior (13-18 歳) 向けの漢字表記 (docs/DESIGN.md §8)。
	activityCardMustBadgeKanji: '⭐ 今日の約束',
	activityCardMust: '（今日のおやくそく）',

	// ---- ActivityEmptyState / AdventureStartOverlay ----
	// 年齢帯 variant を持つため CHILD_ACTIVITY_EMPTY_LABELS /
	// CHILD_ADVENTURE_START_LABELS (getChildActivityEmptyLabels /
	// getChildAdventureStartLabels) へ移動した。ここに戻さない。

	// ---- BottomNav ----
	bottomNavHome: 'ホーム',
	bottomNavStrength: 'つよさ',
	bottomNavFamily: 'かぞく',
	bottomNavAriaLabel: 'メインナビゲーション',

	// ---- CategorySection ----
	categorySectionCollapse: '▲ たたむ',
	categorySectionExpand: (remaining: number) => `▼ もっとみる（のこり ${remaining}こ）`,

	// ---- Challenge target (#3333: 旧 ChallengeBanner 横長バナーを撤去し、対象カテゴリの
	// CategorySection ヘッダーへ静的バッジ + インライン進捗で統合。#2146/#2168 のカード演出統合
	// 思想に整合。ごほうび受取は SiblingCelebration が担う) ----
	challengeTargetRemaining: (count: number) => `のこり${count}かい`,
	challengeTargetComplete: 'クリア！',
	challengeTargetAria: (categoryName: string, remaining: number) =>
		`${categoryName}は今週のチャレンジ対象です。のこり${remaining}かい。`,
	challengeTargetAriaComplete: (categoryName: string) =>
		`${categoryName}の今週のチャレンジはクリアしました。`,

	// ---- ErrorAlert ----
	errorAlertRetry: 'しばらくしてからもう一度お試しください。',
	errorAlertFixInput: '入力内容をご確認ください。',
	errorAlertContactAdmin: '管理者にお問い合わせください。',
	errorAlertRetryBtn: 'もう一度試す',

	// ---- EventBanner ----
	eventBannerReceived: '✅ うけとりずみ',
	eventBannerReceive: '🎁 うけとる',

	// ---- FeatureGate ----
	featureGateFree: '無料',
	featureGateStandard: `${PLAN_TERMS.standard}`,
	featureGateFamily: `${PLAN_TERMS.premium}`,
	featureGateLockTitle: (plan: string) => `${plan}プラン以上で利用可能`,
	featureGateLockText: (plan: string) => `${plan}プラン以上で利用可能`,
	featureGateUpgrade: 'アップグレード',
	// EPIC #3533 §10.2.1: disabled 要素 tap→popover の 3 要素文言 (P2/P5)。
	// planFull は PLAN_FULL_TERMS 値 (例「スタンダードプラン」) を受ける。
	featureGatePopoverUnavailable: '現在のプランでは利用できません',
	featureGatePopoverRequirement: (planFull: string) => `${planFull}以上でご利用いただけます`,
	featureGatePopoverLink: 'プランを見る',

	// ---- GoogleSignInButton ----
	googleSignInLabel: 'Google でログイン',

	// ---- Header ----
	headerPremiumTitle: PLAN_GATE_LABELS.standardOrAboveBadge,
	headerHelpAriaLabel: 'つかいかたガイド',
	/* #4645: ボタンの可視テキストは「<たまった数>/<全体>」。aria-label がそれを含まないと
	   音声操作 (「『スタンプカードを見る』をクリック」) と画面上の文字が一致せず、
	   axe label-content-name-mismatch (WCAG 2.5.3 Label in Name) に抵触する。 */
	headerStampAriaLabel: (filled: number, total: number): string =>
		`スタンプカード ${filled}/${total} を見る`,

	// ---- LevelUpOverlay ----
	levelUpMessages: {
		1: 'ぼうけんがはじまるよ！',
		2: 'がんばってるね！',
		3: 'つよくなってきたよ！',
		4: 'すごいぞ！どんどんいこう！',
		5: 'もうたいしたものだ！',
		6: 'きみはもうベテランだ！',
		7: 'そらもとべそうだね！',
		8: 'すばらしい！マスターめざそう！',
		9: 'ほぼさいきょう！あとすこし！',
		10: 'かみさまレベルだ！おめでとう！',
	} as Record<number, string>,
	levelUpLabel: (categoryName: string | undefined) =>
		`${categoryName ? `${categoryName} ` : ''}レベルアップ！`,
	levelUpDefaultMessage: 'すごい！がんばったね！',
	levelUpSpLabel: (sp: number) => `+${sp} SP ゲット！`,
	levelUpConfirmBtn: 'やったー！',

	// ---- LoadingButton ----
	loadingButtonDefault: '処理中...',

	// ---- Logo ----
	logoAlt: 'がんばりクエスト',
	logoPlanStandard: `⭐ ${PLAN_TERMS.standard}`,
	// Phase 7 PR-L4 (#2836): 顧客可視の header plan badge を premium atom 参照化 (ADR-0058)。
	logoPlanFamily: `⭐⭐ ${PLAN_TERMS.premium}`,

	// #2295 (EPIC #2294 ①): MonthlyRewardDialog 関連ラベル削除済 (2026-05-19)

	// ---- NumPad ----
	numPadAriaLabel: 'すうじパッド',
	numPadDeleteAriaLabel: 'けす',
	numPadOkAriaLabel: 'けってい',

	// ---- PageGuideOverlay ----
	pageGuideTabWhat: 'なにができる？',
	pageGuideTabHow: 'やりかた',
	pageGuideTabGoal: 'つかうと？',
	pageGuideTipsLabel: '💡 ポイント',
	pageGuideCloseBtn: 'とじる',
	pageGuideBackBtn: 'もどる',
	pageGuideNextBtn: (isLast: boolean) => (isLast ? 'かんりょう！' : 'つぎへ'),

	// ---- ParentMessageOverlay ----
	// 文言は年齢帯 variant を持つため `getChildParentMessageLabels(uiMode)` が SSOT (本 namespace には置かない)

	// ---- PremiumBadge ----
	premiumBadgeTitle: 'スタンダードプラン以上で利用可能',

	// ---- RadarChart ----
	radarChartAriaLabel: 'ステータスレーダーチャート',
	radarChartNow: 'いま',
	radarChartDefaultComparisonLabel: 'せんげつ',

	// ---- SiblingRanking ----
	siblingRankingMe: 'じぶん',
	siblingRankingCount: (count: number) => `${count}かい`,
	siblingRankingPeriod: '（こんしゅう）',

	// ---- SiblingTrendChart ----
	siblingTrendChartAriaLabel: 'きょうだい週次トレンドグラフ',
	siblingTrendChartTitle: 'きょうだい週次トレンドグラフ',

	// ---- SpecialRewardOverlay ----
	specialRewardTitle: '🎁 とくべつごほうび！',
	specialRewardPoints: (points: number) => `+${points} ポイント！`,
	specialRewardConfirmBtn: 'やったー！',

	// ---- StampCard / StampPressOverlay ----
	// 文言は年齢帯 variant を持つため `getChildStampLabels(uiMode)` が SSOT (本 namespace には置かない)

	// ---- TutorialBubble ----
	tutorialBubbleEnd: (isYoung: boolean) => (isYoung ? 'おわり' : '終了'),
	tutorialBubblePrev: (isYoung: boolean) => (isYoung ? 'もどる' : '戻る'),
	tutorialBubbleNext: (isYoung: boolean, isLast: boolean) =>
		isYoung ? (isLast ? 'おしまい！' : 'つぎへ') : isLast ? '完了！' : '次へ',
} as const;
