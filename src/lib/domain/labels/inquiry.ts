// labels 層 (ADR-0045 / #4965): 創業者への問い合わせ (src/routes/inquiry)。置き場所の規則は docs/DESIGN.md §6

// #1594 ADR-0023 I8 で導入された LP「開発者に直接相談」セクションは、
// ADR-0028 (#1713 R7) で LP セクション削除 → #1770 で空オブジェクト化 → #1772 で完全削除済み。
// 連絡導線は footer の mailto (`LP_FOOTER_LABELS.contactLink`) に集約済み。
// generate-lp-labels.mjs の parseBlock は当該定数不在時に空オブジェクトを返すよう修正されている。

/**
 * #1594 ADR-0023 I8: founder 1:1 ヒアリング動線
 * LP / admin に「開発者に直接相談」CTA を提供する。Pre-PMF "do things that don't scale"
 * 実践として、初期 ~10 親契約まで全員と直接対話する。
 */
export const FOUNDER_INQUIRY_LABELS = {
	// #support-unify: 旧「LP / admin 共通の CTA セクション」(ctaSectionHeading / Lead / Bullet1-3 /
	// ctaButton) は、admin/settings/support の founder CTA カードを統合サポートフォームへ集約した際に
	// 全参照が消えたため削除。/inquiry/founder ページ本体のラベルのみ存続させる。
	mailtoFallbackLabel: 'メールで送る',
	// /inquiry/founder ページ
	pageTitle: '開発者に直接相談',
	pageHeading: '👋 開発者に直接相談',
	pageLead:
		'個人開発のため、Pre-PMF 期はリード開発者本人が一人ひとりに直接お返事します。お気軽にご相談ください。',
	pageNote:
		'※ お返事は通常 2〜3 日以内にメールでお送りします。なるべく早くお返事しますが、個人運営のため遅れる場合がございます。',
	formNameLabel: 'お名前（ニックネーム可）',
	formNamePlaceholder: '例: 山田 太郎',
	formEmailLabel: 'メールアドレス',
	formEmailPlaceholder: '例: parent@example.com',
	formChildAgeLabel: 'お子さまの年齢（任意）',
	formChildAgePlaceholder: '例: 7 歳、3 歳と 6 歳など',
	formMessageLabel: 'ご相談内容',
	formMessagePlaceholder:
		'例:\n・ 6 歳の子に使わせたいが、ひらがなで操作できますか？\n・ 兄弟 2 人で使いたい、料金プランの選び方を教えてください\n・ 解約を考えていますが、データはどうなりますか？',
	formSubmitButton: '送信する',
	formSubmittingText: '送信中...',
	formCancelButton: 'キャンセル',
	successHeading: '受け付けました',
	successText:
		'ご相談を受け付けました。リード開発者から 2〜3 日以内にメールでお返事します。お待ちください。',
	successCloseButton: '閉じる',
	mailtoSectionHeading: 'メールで直接送る場合',
	mailtoSectionDesc:
		'フォームをお使いいただけない場合は、こちらのメールアドレス宛にお送りください。',
	errorRequiredFields: 'お名前・メールアドレス・ご相談内容は必須です',
	errorInvalidEmail: 'メールアドレスの形式が正しくありません',
	errorMessageTooLong: (max: number) => `ご相談内容は ${max} 文字以内にしてください`,
	errorRateLimit: (sec: number) => `送信間隔が短すぎます。${sec} 秒後に再送してください`,
	errorSendFailed: '送信に失敗しました。時間をおいて再度お試しください',
	// admin sidebar / footer link
	adminFooterLink: '👋 開発者に直接相談',
	adminFooterHint: '個人開発者にメッセージを送る（無料）',
} as const;
