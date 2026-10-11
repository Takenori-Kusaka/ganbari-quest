// labels 層 (ADR-0045 / #4965): おやカギ・PIN (画面をまたぐ機能)。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS } from '../admin-screens';
import { ADMIN_VIEW_TERMS, CHILD_TERMS, LOGIN_TERMS, OYAKAGI_TERMS, PARENT_TERMS } from '../terms';

/**
 * ピン留め (おきにいり) 上限の **API 層 fallback 文言** (PO 回答 2026-09-03 §4 #2 follow-up)。
 *
 * `CHILD_ACTION_ERROR_LABELS.pinLimitExceeded` は子供画面の form action 用で年齢帯 variant を
 * 持つ。API (`apiError`) の `userMessage` は年齢帯を知らない汎用 fallback なので別に置く
 * (件数は `message` 側に service が入れる。ここに数値を直書きして SSOT を二重化しない)。
 */
export const ACTIVITY_PIN_ERROR_LABELS = {
	limitExceeded: 'お気に入りの上限に達しました。ほかのお気に入りを外してからお試しください。',
} as const;

export const OYAKAGI_LABELS = {
	name: `${OYAKAGI_TERMS.name}`,
	shortName: `${OYAKAGI_TERMS.shortName}`,
	setupStep: `${OYAKAGI_TERMS.name}を変更する`,
	changeAction: `${OYAKAGI_TERMS.shortName}を変更`,
	changeSuccess: `${OYAKAGI_TERMS.name}を変更しました`,
	sectionTitle: `🔒 ${OYAKAGI_TERMS.name}変更`,
	// #4866 系 / PO 決裁 2026-09-10 決定 4: PIN gate 不成立時の文言。
	// API の 403 と form action の `fail()` の**両方**がこれを使う (1 つにする)。
	gateRequired: `${OYAKAGI_TERMS.name}の確認が必要です`,
	// form action で使う形。**入力は保持されている**ことを伝える
	// (PO 決定 4(a):「保護者が書いた内容を黙って捨てるのは、gate が守るものより大きい損害」)。
	gateRequiredKeepInput: `${OYAKAGI_TERMS.name}の確認が必要です。入力内容はそのままにしてあります。`,
	// 再入力ダイアログの説明文。**この画面から離れなくてよい**ことを明示する
	// (離れると入力が消えるため、離れないで済むこと自体が案内の主眼)。
	gateReauthDescription: `この画面のまま${OYAKAGI_TERMS.name}を入力できます。入力内容は消えません。`,
	// 確認できた直後の案内。**保存の成否は一切述べない** (PO 決裁 2026-09-10b)。
	// 述べてよいのは「確認できたので、続きの操作ができます」まで。
	// 「確認しました」だけで止めると次にすることが分からず、「保存しました」と書くと
	// 保護者は「押したはずなのに入っていない」を経験する。確認と保存が**別の操作**である
	// ことが 1 回で分かる形にする。
	gateReauthSuccess: `${OYAKAGI_TERMS.name}を確認しました。もう一度「保存」を押してください。`,
	inputLabel: `${OYAKAGI_TERMS.name}（${OYAKAGI_TERMS.digitRange}）`,
	// #4661: 変更フォームの 3 入力欄。以前は account/+page.svelte に「（4〜8桁）」を
	// 直書きしており、`formatError` の「4〜6桁」と同一画面で矛盾していた。
	// 桁数の SSOT は constants/oyakagi.ts の PIN_LENGTH (= OYAKAGI_TERMS.digitRange)。
	currentInputLabel: `現在の${OYAKAGI_TERMS.name}`,
	newInputLabel: `新しい${OYAKAGI_TERMS.name}（${OYAKAGI_TERMS.digitRange}）`,
	confirmInputLabel: `新しい${OYAKAGI_TERMS.name}（確認）`,
	// #4716 item 15: 変更フォーム (server action) のエラー文言も画面直書きから SSOT へ移す
	mismatchError: `新しい${OYAKAGI_TERMS.name}が一致しません`,
	allFieldsRequiredError: 'すべての項目を入力してください',
	currentPinInvalidError: `現在の${OYAKAGI_TERMS.name}が正しくありません`,
	inputPlaceholder: `${OYAKAGI_TERMS.name}を入力`,
	// #4698: 忘れた場合の導線 (cognito = ゲートの「忘れた方」リンクからメール / パスワード確認で再設定、
	// self-host = サーバー管理者向け手順)。ゲート側 (gateForgotPinLink / gateOperatorResetNotice) と同じ 2 経路を案内する
	forgotHint: `${OYAKAGI_TERMS.name}は${OYAKAGI_TERMS.digitRange}の数字です。忘れた場合は、${ADMIN_VIEW_TERMS.canonical}に入るときの「${OYAKAGI_TERMS.name}を忘れた方」から再設定できます（セルフホスト環境ではサーバー管理者向けのリセット手順をご利用ください）`,
	invalidError: `${OYAKAGI_TERMS.name}が正しくありません`,
	lockedError: `${OYAKAGI_TERMS.name}の入力に連続して失敗したため、しばらく待ってから再度お試しください`,
	formatError: `${OYAKAGI_TERMS.name}は${OYAKAGI_TERMS.digitRange}の数字で入力してください`,
	numberOnlyError: `${OYAKAGI_TERMS.name}は数字のみです`,
	// #4512: 変更フォームのエラー (旧: settings/account の server 直書き)。
	// 入力欄ラベル 3 種は #4661 が currentInputLabel / newInputLabel / confirmInputLabel として
	// 先に集約済みのため、merge 時に重複定義を削除しそちらに寄せた。
	confirmMismatchError: `新しい${OYAKAGI_TERMS.name}が一致しません`,
	currentInvalidError: `現在の${OYAKAGI_TERMS.name}が正しくありません`,
	// EPIC #2310 子#2312: /switch PIN gate modal UI (Apple Screen Time 同設計)
	gateModalTitle: `${OYAKAGI_TERMS.name}を入力してください`,
	gateModalDescription: `${ADMIN_VIEW_TERMS.canonical}には${PARENT_TERMS.neutral}のみが入れます。${OYAKAGI_TERMS.name}を入力してください。`,
	gateModalSubmitting: 'かくにん中…',
	// #3089: PIN 認証成功後、親画面 (ハードナビ) 表示完了まで数秒かかる間の全画面 progress 文言。
	// 「認証は成功して読み込み中」を明示し、modal が閉じてから子供画面が静止して見える困惑を解消する
	// (NN/g heuristic #1 visibility of system status)。
	gateNavigating: `${ADMIN_VIEW_TERMS.canonical}をひらいています…`,
	// #3089: navigating overlay の timeout / error fallback 文言。ハードナビが unload しないまま
	// 一定時間 (CloudFront 429 / /admin 5xx / 通信断 / cookie 失効 等) 経過した際、spinner dead-end を
	// 解除して「読み込みに失敗した・再試行できる」ことを明示する (NN/g #1 visibility + #9 error recovery)。
	gateNavigatingError: `${ADMIN_VIEW_TERMS.canonical}の読み込みに時間がかかっています。もう一度お試しください。`,
	// #3089: navigating overlay error 状態の再試行ボタン文言。
	gateNavigatingRetry: 'もう一度ひらく',
	// #2991: ロック時は解除の絶対時刻を提示する (NIST SP 800-63B / iOS Security Lockout は残り時間明示、
	// NN/g heuristic #1 visibility)。秒カウントダウンは temporal vigilance で不安を増幅するため絶対時刻型を採用
	// (research: tmp/research/pin-gate-ux-ideal-state.md Q2)。timeStr は呼び出し側で「HH:MM」整形した文字列。
	gateLockedUntilNotice: (timeStr: string) =>
		`${OYAKAGI_TERMS.name}の入力に連続して失敗しました。${timeStr} まで待ってから再度お試しください`,
	gateFormatNotice: `${OYAKAGI_TERMS.name}は${OYAKAGI_TERMS.digitRange}の数字です`,
	gateGenericError: `${OYAKAGI_TERMS.name}の確認に失敗しました。もう一度お試しください`,
	// Issue #2353 Fix 5 (Phase A): gateDefaultHint (= '初期値は 5086（がんばり）です') は子供が見て即入れる脆弱性のため modal 用 atom を削除
	// (#2992 以降は初回作成フローのため既定 PIN ヒント自体が不要。#4698 で設定画面の defaultValueHint も撤去)
	gatePinRequiredBanner: `${ADMIN_VIEW_TERMS.canonical}に入るには${OYAKAGI_TERMS.name}が必要です`,
	// 親管理画面で一定時間操作がなく自動的に子供選択画面へ戻った旨の通知 (parent-gate inactivity redirect)
	gateTimedOutNotice: `しばらく操作がなかったため${ADMIN_VIEW_TERMS.canonical}を閉じました。もう一度入るには${OYAKAGI_TERMS.name}を入力してください`,
	// #2993: PIN 忘れ救済導線 (入力モード + cognito identity のみ表示、/auth/reset-pin = パスワード再入力方式へ遷移)
	gateForgotPinLink: `${OYAKAGI_TERMS.name}を忘れた方`,
	// #2994: local (self-host) では運用者向け reset 手順に誘導する (email/リンク導線なし)
	gateOperatorResetNotice: `${OYAKAGI_TERMS.name}を忘れた場合は、サーバー管理者向けのリセット手順で再設定できます`,
	// #2992 (EPIC #2990): 初回は「作る」フロー。PIN 未設定 tenant には login でなく
	// 新規作成 (入力→確認の 2 段) を表示する (Apple Screen Time / Google Family Link 同型)。
	// これにより既定 PIN を知らない保護者の初回 dead-end が構造的に解消する。
	gateCreateTitle: `${OYAKAGI_TERMS.name}をつくってください`,
	gateCreateDescription: `${ADMIN_VIEW_TERMS.canonical}に入るための${OYAKAGI_TERMS.name}（${OYAKAGI_TERMS.digitRange}の数字）を、${PARENT_TERMS.neutral}が決めて入力してください。`,
	gateCreateConfirmTitle: `もう一度入力してください`,
	gateCreateConfirmDescription: `確認のため、同じ${OYAKAGI_TERMS.name}をもう一度入力してください。`,
	gateCreateMismatch: `入力が一致しませんでした。最初からやり直してください`,
	gateCreateAlreadyConfigured: `${OYAKAGI_TERMS.name}は設定済みです。入力画面からやり直してください`,
	gateCreateGenericError: `${OYAKAGI_TERMS.name}の作成に失敗しました。もう一度お試しください`,
	gateCreateSubmitting: 'つくっています…',
} as const;

/**
 * PIN reset 画面文言 SSOT (#2993、EPIC #2990)
 *
 * /auth/reset-pin (cognito 専用): アカウントパスワード再入力で本人確認し、その場で
 * 新しい PIN を設定する (Apple Screen Time 同型)。email はセッション既知のため手入力なし。
 */
export const PIN_RESET_LABELS = {
	resetPageTitle: `${OYAKAGI_TERMS.name}の再設定`,
	resetHeading: `${OYAKAGI_TERMS.name}を忘れた場合`,
	resetDescription: `ご本人確認のため、ログイン中のアカウントのパスワードを入力してください。そのまま新しい${OYAKAGI_TERMS.name}を設定できます。`,
	resetAccountLabel: 'ログイン中のアカウント',
	resetPasswordLabel: 'アカウントのパスワード',
	resetPasswordHint: `${LOGIN_TERMS.canonical}時に使っているパスワードです`,
	// #3070: federated (Google) ユーザ向け — Cognito パスワードを持たず、共有端末で silent SSO により
	// recent-login が無入力で通過し得るため、登録メールへ 6 桁コードを送る email-OTP で本人確認する。
	resetFederatedDescription: `ご本人確認のため、ログイン中のアカウントのメールに確認コードをお送りします。コードを入力すると新しい${OYAKAGI_TERMS.name}を設定できます。`,
	resetFederatedSendCodeButton: '確認コードを送る',
	resetFederatedSendingCode: '送信中…',
	resetFederatedCodeSent:
		'確認コードをメールにお送りしました。メールに記載の6桁のコードを入力してください。',
	resetFederatedCodeLabel: '確認コード（6桁の数字）',
	resetFederatedResendButton: 'コードを再送する',
	// エラー文言
	resetPinLabel: `新しい${OYAKAGI_TERMS.name}（${OYAKAGI_TERMS.digitRange}の数字）`,
	resetSubmit: `${OYAKAGI_TERMS.name}を再設定する`,
	resetSubmitting: '設定中…',
	resetSuccessHeading: '再設定が完了しました',
	resetSuccessBody: `新しい${OYAKAGI_TERMS.name}で${ADMIN_VIEW_TERMS.canonical}に入れます。`,
	resetSuccessCta: `${ADMIN_VIEW_TERMS.canonical}へ`,
	resetBackToSwitch: `${ADMIN_VIEW_TERMS.canonical}に戻る`,
	// エラー文言
	errorInvalidPassword: 'パスワードが正しくありません',
	errorPasswordRequired: 'パスワードを入力してください',
	errorPinFormat: `${OYAKAGI_TERMS.name}は${OYAKAGI_TERMS.digitRange}の数字で入力してください`,
	errorRateLimited: '試行回数が上限に達しました。しばらく時間をおいてからお試しください',
	errorNotSupported: 'この環境では本画面から再設定できません。管理者向け手順で再設定してください',
	errorGeneric: '再設定に失敗しました。時間をおいてもう一度お試しください',
	// #3070: federated email-OTP のエラー文言
	errorCodeRequired: '先に「確認コードを送る」からコードを受け取ってください',
	errorInvalidCode: '確認コードが正しくありません。メールに記載のコードをご確認ください',
	errorCodeExpired:
		'確認コードの有効期限が切れました。もう一度「コードを再送する」からやり直してください',
	errorTooManyAttempts:
		'確認コードの入力回数が上限に達しました。もう一度「コードを再送する」からやり直してください',
	errorCodeSendFailed: '確認コードの送信に失敗しました。時間をおいてもう一度お試しください',
} as const;

/**
 * PIN gate 初心者導線 ダイアログ文言 SSOT (#2353 設計欠陥 6)
 *
 * setup 完了後の子供画面初回遷移時に 1 回だけ表示する onboarding dialog。
 * 「以降表示しない」checkbox で settings.pin_gate_onboarding_seen を 'true' に persist。
 */
export const PIN_GATE_ONBOARDING_LABELS = {
	dialogTitle: `${ADMIN_VIEW_TERMS.canonical}に入る方法`,
	dialogIntro: `${CHILD_TERMS.honorific}の画面から${ADMIN_VIEW_TERMS.canonical}に戻るには、トップの「だれがつかう？」画面で 🔒 ${ADMIN_SCREENS.home.name} のリンクをタップしてください。`,
	// #2992: 初回は既定 PIN の入力でなく新規作成 (入力→確認) フローになるため、
	// 旧「初回ログイン時の○○は 初期 5086…」の既定値案内から作成フロー案内に変更。
	dialogPinHint: `初めて${ADMIN_VIEW_TERMS.canonical}に入るときに、${PARENT_TERMS.neutral}が${OYAKAGI_TERMS.name}（${OYAKAGI_TERMS.digitRange}の数字）を作成します。`,
	dialogChangePinHint: `${OYAKAGI_TERMS.name}は${ADMIN_VIEW_TERMS.canonical}の「せってい」 → 「${OYAKAGI_TERMS.name}」からいつでも変更できます。`,
	dontShowAgain: '今後表示しない',
	// Issue #2353 Phase D / E2E 衝突対策: 子供向け Dialog の「とじる」と strict mode 衝突するため
	// 親向け onboarding 文言として「わかった」を採用 (UI 上は unique、意味 = 「理解した、閉じる」)
	close: 'わかった',
} as const;
