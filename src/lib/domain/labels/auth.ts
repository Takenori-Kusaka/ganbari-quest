// labels 層 (ADR-0045 / #4965): ログイン・登録・同意・法務表示 (画面をまたぐ機能)。置き場所の規則は docs/DESIGN.md §6
import {
	ADMIN_VIEW_TERMS,
	CANCEL_TERMS,
	CHILD_TERMS,
	CROSS_BORDER_TERMS,
	LOGIN_TERMS,
	PLAN_FULL_TERMS,
	TRIAL_TERMS,
} from '../terms';

export const SIGNUP_LABELS = {
	// 確認コード入力ステップ
	confirmEmailSent: (email: string) => `${email} に確認コードを送信しました。`,
	confirmEmailNote: 'メールに記載された6桁のコードを入力してください。',
	confirmCodeExpiry: (minutes: number | string) => `確認コードは${minutes}分以内に入力してください`,
	confirmCodeLabel: '確認コード',
	confirmSubmitLoading: '確認中...',
	confirmSubmitButton: '確認する',
	resendSuccess: '確認コードを再送しました',
	resendLoading: '再送中...',
	resendCooldown: (seconds: number | string) => `コードを再送する（${seconds}秒後に再試行可能）`,
	resendButton: 'コードを再送する',

	// サインアップフォーム
	googleSignupLabel: 'Google で登録',
	dividerOr: 'または',
	emailLabel: 'メールアドレス',
	emailPlaceholder: 'example@email.com',
	passwordLabel: 'パスワード',
	passwordPlaceholder: '8文字以上（大小英字・数字を含む）',
	passwordHint: '8文字以上、大文字・小文字・数字を含む',
	passwordConfirmLabel: 'パスワード（確認）',
	passwordConfirmPlaceholder: 'パスワードを再入力',
	passwordMismatchError: 'パスワードが一致しません',
	passwordMatchHint: 'パスワードが一致しました',
	// 注: signup のライセンスキー入力欄 / ヘルプ / 同意 (licenseKey* / submitWithLicenseKey /
	//     licenseConfirm* / blockLicense*) は Epic #2525 Phase 7 PR-L1 (#2810) でキー入力経路を
	//     削除済 + PR-L4 (#2836) で残存 label を撤去。サインアップは無料 / トライアル経路のみ。
	termsAgreePrefix: '',
	termsAgreeLink: '利用規約',
	termsAgreeSuffix: 'に同意します',
	termsAgreeError: '利用規約への同意が必要です',
	privacyAgreePrefix: '',
	privacyAgreeLink: 'プライバシーポリシー',
	privacyAgreeSuffix: 'に同意します',
	privacyAgreeError: 'プライバシーポリシーへの同意が必要です',
	// #1638 / #4944: 個人情報保護法 §28 — 外国にある第三者への提供同意。
	// 第一層は「何が起きる / 起きない」だけを平易語で出し、事業者名・国名・制度・条番号は
	// 第二層 (privacy.html 第 10 条) に置いて crossBorderDetailLink から到達させる。
	// 施行規則 17 条 2 項の 3 情報は第二層で提供する (PPC A12-10: URL 提供可)。
	crossBorderSectionTitle: CROSS_BORDER_TERMS.sectionTitle,
	// 常時表示は summaryPositive / noNoUse の 2 行だけ。残りは crossBorderDetailsSummary の
	// 折りたたみに入れる（同意画面 3 ブロックの見た目の重さを揃える、#4944 PO 判断）
	crossBorderSummaryPositive: CROSS_BORDER_TERMS.summaryPositive,
	crossBorderNoNoUse: CROSS_BORDER_TERMS.noNoUse,
	crossBorderDetailsSummary: CROSS_BORDER_TERMS.detailsSummary,
	crossBorderWhatHappens: CROSS_BORDER_TERMS.whatHappens,
	crossBorderPaymentScope: CROSS_BORDER_TERMS.paymentScope,
	crossBorderDeletion: CROSS_BORDER_TERMS.deletion,
	crossBorderDetailLink: CROSS_BORDER_TERMS.detailLink,
	crossBorderAgreeLabel: CROSS_BORDER_TERMS.consentLabel,
	crossBorderAgreeError: 'サービス提供に必要なデータ保存・処理への同意が必要です',
	parentalConsentNote: `※ 本サービスは${CHILD_TERMS.honorific}のデータを扱います。保護者として上記に同意してください。`,
	submitLoading: '登録中...',
	submitWithTrial: `${TRIAL_TERMS.duration} 無料体験をはじめる`,
	submitFree: '無料ではじめる',
	// #4501: トライアルは常に premium tier (FR-2)。プラン名を差し込む形だと
	// 「standard のトライアル」と読めてしまい、実挙動 (全機能開放) と食い違う。
	trialPlanNote: `セットアップ後に${PLAN_FULL_TERMS.premium}のトライアルが開始され、${TRIAL_TERMS.duration}すべての有料機能をお試しいただけます`,
	loginLink: '既にアカウントをお持ちの方はこちら',
	legalNote: '有料プランをご利用の前に',
	legalTokushoho: '特定商取引法に基づく表記',
	legalSlaAnd: 'および',
	legalSla: 'SLA',
	legalNoteEnd: 'をご確認ください',

	// submitBlockReason (JS, shown in template)
	blockEmailRequired: 'メールアドレスを入力してください',
	blockPasswordRequired: 'パスワードを入力してください',
	blockPasswordConfirmRequired: 'パスワード（確認）を入力してください',
	blockPasswordMismatch: 'パスワードが一致しません',
	blockTermsRequired: '利用規約への同意が必要です',
	blockPrivacyRequired: 'プライバシーポリシーへの同意が必要です',
	blockCrossBorderRequired: '米国への個人データ移転への同意が必要です',

	// #4497 rider: signup server action のエラー文言。
	// 旧実装は +page.server.ts に直書きで、うち 1 件は上の passwordMismatchError と同一文言の
	// 重複定義だった。重複分はここに再定義せず、server 側から passwordMismatchError を参照する。
	errors: {
		consentRequired: '利用規約・プライバシーポリシー・データの保存/処理への同意が必要です',
		allFieldsRequired: '全ての項目を入力してください',
		passwordTooShort: 'パスワードは8文字以上で入力してください',
		emailMissing: 'メールアドレスが指定されていません',
		codeRequired: '確認コードを入力してください',
	},
} as const;

// ============================================================
// auth/login ページ (#1452 Phase B)
// ============================================================

/**
 * 認証フォームの共通ラベル (#4716 item 15)。
 *
 * ログイン / パスワード再設定 / サインアップで同じ項目名を各画面が直書きしていたため、
 * 同じ入力欄が画面ごとに別名になりうる状態だった。
 */
export const AUTH_FORM_LABELS = {
	emailLabel: 'メールアドレス',
	passwordLabel: 'パスワード',
	verificationCodeLabel: '確認コード',
	newPasswordLabel: '新しいパスワード',
	newPasswordConfirmLabel: '新しいパスワード（確認）',
	newPasswordPlaceholder: '8文字以上（大小英字・数字を含む）',
	newPasswordHint: '8文字以上、大文字・小文字・数字を含む',
	newPasswordConfirmPlaceholder: 'パスワードを再入力',
	passwordMismatch: 'パスワードが一致しません',
	passwordMatched: 'パスワードが一致しました',
} as const;

export const LOGIN_LABELS = {
	mfaBadge: 'MFA認証',
	passwordResetSuccess: 'パスワードがリセットされました。新しいパスワードでログインしてください。',
	// #4701: ログイン画面に戻された理由 (query → 文言)。mapping は $lib/domain/validation/login-redirect.ts
	noticeRegistered:
		'アカウントの登録が完了しました。登録したメールアドレスとパスワードでログインしてください。',
	noticeConfirmed: 'メールアドレスの確認が完了しました。ログインして始めましょう。',
	noticeAccountDeleted: `このアカウントは${CANCEL_TERMS.account}（削除）済みのためログインできません。もう一度ご利用になる場合は、新しいアカウントを登録してください。`,
	// #4699: 退会 (アカウント削除) を申請した直後の着地。受付と、猶予中は取り消せることを伝える
	noticeDeletionPending: `アカウント削除のお申し込みを受け付けました。猶予期間中にもう一度ログインすると、${ADMIN_VIEW_TERMS.canonical}から取り消し（復元）できます。`,
	noticeOauthFailed:
		'Google でのログインを完了できませんでした。もう一度お試しいただくか、メールアドレスとパスワードでログインしてください。',
	noticeOauthStateLost:
		'ログインの途中で情報が失われました（時間切れ、または別のタブやブラウザで開いた可能性があります）。もう一度「Google でログイン」からやり直してください。',
	noticeOauthTokenExchangeFailed:
		'Google アカウントの確認に失敗しました。時間をおいてもう一度お試しください。続く場合はメールアドレスとパスワードでログインしてください。',
	noticeLoginFailedGeneric: 'ログインを完了できませんでした。もう一度お試しください。',
	// #4701: ?next= 付きでログイン画面に来たとき、ログイン後に元の画面へ戻ることを予告する
	nextReturnNotice: 'ログインすると、見ていた画面に戻ります。',

	// Confirm code step
	confirmBadge: 'メール認証',
	confirmDesc1Suffix: ' に確認コードを送信しました。',
	confirmDesc2: 'メールに記載された6桁のコードを入力してください。',
	confirmCodeLabel: '確認コード',
	confirmLoading: '確認中...',
	confirmButton: '確認する',
	confirmResendSuccess: '確認コードを再送しました',
	confirmResendLoading: '再送中...',
	confirmResendCooldown: (seconds: number) => `コードを再送する（${seconds}秒後に再試行可能）`,
	confirmResendButton: 'コードを再送する',

	// MFA step
	mfaDesc: '認証アプリに表示されている6桁のコードを入力してください。',
	mfaCodeLabel: '認証コード',
	mfaLoading: '認証中...',
	mfaButton: '認証する',

	// Login form
	dividerLabel: 'または',
	emailLabel: 'メールアドレス',
	emailPlaceholder: 'example@email.com',
	passwordLabel: 'パスワード',
	passwordPlaceholder: '8文字以上',
	forgotPasswordLink: 'パスワードを忘れた方はこちら',
	loginLoading: 'ログイン中...',
	loginButton: 'ログイン',
	signupLink: 'アカウントをお持ちでない方はこちら',

	// Dev mode test accounts
	devAccountsSummary: 'テスト用アカウント',
	/** dev 案内の role 表示 (login/+page.svelte が DEV_USERS 由来の role から引く) */
	devAccountRoles: {
		owner: '(管理者)',
		parent: '(親)',
		child: `(${CHILD_TERMS.honorific})`,
	} as Record<'owner' | 'parent' | 'child', string>,
} as const;

// ============================================================
// 同意ページ (#1452 Phase B)
// ============================================================

export const CONSENT_LABELS = {
	// Page titles
	titleUpdated: '規約に変更がありました',
	titleNew: '規約への同意',

	// Section headings
	headingUpdated: '規約が更新されました',
	descUpdated: 'サービスの利用を続けるには、更新された規約への同意が必要です。',
	headingNew: '規約への同意',
	descNew: 'サービスの利用を開始するには、規約への同意が必要です。',

	// Previous consent info
	// #4497: 旧実装は「前回同意 → 最新」を利用規約の version 固定で描画していたため、
	// プライバシーポリシーだけを改定すると「2026-04-28 → 2026-04-28」と嘘を表示した。
	// 文書ごとに 1 行ずつ、その文書自身の前回 / 最新を出す。
	previousConsentHeading: '前回同意したバージョン',
	previousConsentArrow: ' → ',
	previousConsentNone: '未同意',
	previousConsentLine: (docName: string, previous: string, latest: string) =>
		`${docName}: ${previous} → ${latest}`,

	// Terms
	termsSectionTitle: '利用規約',
	termsVersionPrefix: 'バージョン: ',
	termsReadLink: '利用規約を確認する ↗',
	termsCheckLabel: '利用規約に同意します',

	// Privacy
	privacySectionTitle: 'プライバシーポリシー',
	privacyVersionPrefix: 'バージョン: ',
	privacyReadLink: 'プライバシーポリシーを確認する ↗',
	privacyCheckLabel: 'プライバシーポリシーに同意します',

	// Cross-border transfer (#4497 / 個人情報保護法 §28)
	// Google OAuth 経由の登録では signup フォームを通らないため、越境移転同意は
	// この画面が唯一の取得点になる（全サインアップ経路で証跡を残す）。
	//
	// #4944: 見出しと本文を第一層 (何が起きる / 起きない) に置き換えた。
	// 事業者名・国名・制度・条番号は第二層 = privacy.html 第 10 条にあり
	// crossBorderReadLink から到達する。旧見出しは条項名 (CROSS_BORDER_TERMS.transfer) を
	// そのまま出していたため、読み手が「自分に何が起きるのか」を判断できなかった。
	crossBorderSectionTitle: CROSS_BORDER_TERMS.sectionTitle,
	crossBorderVersionPrefix: 'バージョン: ',
	crossBorderReadLink: `${CROSS_BORDER_TERMS.detailLink} ↗`,
	// 常時表示は summaryPositive / noNoUse の 2 行だけ（#4944 PO 判断）
	crossBorderSummaryPositive: CROSS_BORDER_TERMS.summaryPositive,
	crossBorderNoNoUse: CROSS_BORDER_TERMS.noNoUse,
	// 以下 3 行は crossBorderDetailsSummary の折りたたみ内
	crossBorderDetailsSummary: CROSS_BORDER_TERMS.detailsSummary,
	crossBorderWhatHappens: CROSS_BORDER_TERMS.whatHappens,
	crossBorderPaymentScope: CROSS_BORDER_TERMS.paymentScope,
	crossBorderDeletion: CROSS_BORDER_TERMS.deletion,
	crossBorderCheckLabel: CROSS_BORDER_TERMS.consentLabel,

	// Submit button
	submitLoading: '同意中...',
	submitButton: '同意して続ける',

	// Exit (#4497): 同意しない選択肢が画面から到達できないと「同意するしかない」状態になる。
	// /auth/logout は実在するので、そこへの導線を明示する。
	declineHeading: '同意しない場合',
	declineDescription:
		'同意されない場合、本サービスをご利用いただけません。ログアウトのうえ、ご利用の継続をご検討ください。データは削除されません。',
	declineLogoutLink: '同意せずログアウト',

	// Error messages (used in +page.svelte and +page.server.ts)
	errors: {
		loginRequired: 'ログインが必要です',
		bothRequired: '表示されている項目すべてに同意してください',
		recordFailed: '同意の記録に失敗しました。もう一度お試しください。',
		termsRequired: '利用規約への同意が必要です',
		privacyRequired: 'プライバシーポリシーへの同意が必要です',
		crossBorderRequired: 'サービス提供に必要なデータ保存・処理への同意が必要です',
	},
} as const;

// ============================================================
// デモメッセージページ (#1452 Phase B)
// ============================================================

// DEMO_MESSAGES_LABELS: #2270 (EPIC #2266) で /demo/admin/messages dir 削除 (PR-B3 #2188 で既に削除済) +
// /admin/messages 廃止に伴い、demo 専用 messages ラベルも参照ゼロのため削除。応援機能 (/admin/cheer) に統合。

// #2295 (EPIC #2294 ①): EVENTS_LABELS 削除済 (2026-05-19) — シーズンイベント機構撤去

// ============================================================
// パスワードリセットページ (#1452 Phase B)
// ============================================================

export const FORGOT_PASSWORD_LABELS = {
	pageSubtitle: 'パスワードリセット',
	step2ConfirmSentPrefix: 'に確認コードを送信しました。',
	step2ConfirmEnterInstruction: 'メールに記載されたコードと新しいパスワードを入力してください。',
	step2CodeExpiryPrefix: '確認コードは',
	// #4702: 旧文言は「届かない場合は再送してください」だが画面に再送ボタンが無く dead-end だった。
	// 再送ボタン (step2ResendButton) を追加したうえで文言を操作と一致させる
	step2CodeExpirySuffix: '分間有効です。届かない場合は下の「コードを再送する」からやり直せます',
	step2ResendButton: 'コードを再送する',
	step2ResendLoading: '再送中...',
	step2ResendCooldown: (seconds: number) => `コードを再送する（${seconds}秒後に再試行可能）`,
	step2ResendSuccess: '確認コードを再送しました',
	// #4702: Google (federated) で登録した顧客は Cognito にパスワードが無く、リセットコードも届かない。
	// Cognito はアカウントの存在を伏せる (UserNotFound も成功扱い) ため、全員に常時案内する
	googleUserNotice: `Google で${LOGIN_TERMS.canonical}した方はパスワードがありません。${LOGIN_TERMS.canonical}画面の「Google」ボタンからお進みください。`,
	googleUserNoticeLink: `${LOGIN_TERMS.canonical}画面へ`,
	resettingLabel: 'リセット中...',
	resetButton: 'パスワードをリセット',
	step1Instruction1: '登録済みのメールアドレスを入力してください。',
	step1Instruction2: 'パスワードリセット用の確認コードを送信します。',
	sendingLabel: '送信中...',
	sendButton: '確認コードを送信',
	backToLoginLink: 'ログインに戻る',
} as const;

export const PARENT_LOGIN_LABELS = {
	backLink: 'もどる',
	pageTitle: 'おとうさん・おかあさんの',
	pageTitleLine2: 'ページだよ',
	pageDescLine1: 'ここから先はおとうさん・おかあさんに',
	pageDescLine2: 'ひみつのばんごうを入れてもらってね',
	pinInputAriaLabel: 'おやカギコード入力状態',
} as const;

/**
 * 法的文書 SSOT (#1638 / #1590)
 *
 * site/privacy.html / site/terms.html / signup フォームで横断的に使う
 * 法律用語のキー語彙。各 value が site/privacy.html / site/terms.html に出現することを
 * 検証する CI は無い（専用 lint は #4322 で撤去済。機械強制は無く、HTML との文言整合は
 * レビューで担保する、#4482）。key の存在は tests/unit/domain/legal-labels.test.ts が検証する。
 *
 * 注: site/*.html は SEO meta 等の例外を含むため、キー用語の存在確認のみで
 * data-label 等の SSOT 注入は要求しない（ADR-0009 例外）。
 */
export const LEGAL_LABELS = {
	graduation: '卒業',
	graduationDef: 'ポジティブな解約',
	externalTransmission: '外部送信規律',
	externalTransmissionLaw: '電気通信事業法第27条の12',
	familyUniqueId: '家族内一意 ID',
	underAge: '未成年者',
	crossBorderTransfer: CROSS_BORDER_TERMS.transfer,
	crossBorderLaw: CROSS_BORDER_TERMS.law,
	scc: CROSS_BORDER_TERMS.scc,
	dpa: CROSS_BORDER_TERMS.dpa,
	signupCrossBorderConsent: CROSS_BORDER_TERMS.consentLabel,
} as const;
