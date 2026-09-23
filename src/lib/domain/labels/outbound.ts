// labels 層 (ADR-0045 / #4965): アプリの画面の外に届く文面 (メール / Push 通知 / リリース通知)。置き場所の規則は docs/DESIGN.md §6
// #4482: 保持日数の「整形」も SSOT を経由する。表示側で `${days}日` と独自整形すると、
// 保持日数を 365 の倍数に変えたときにここだけ「365日」と述べ、料金表の「1年」と食い違う。
import { formatRetentionPeriod } from '../constants/plan-retention';
import { ADMIN_VIEW_TERMS, CANCEL_TERMS, CHILD_TERMS, OYAKAGI_TERMS } from '../terms';

// ============================================================
// リリース通知（Discord 📢 アップデート情報、#4883）
// ============================================================
// 顧客へ配信される「枠」の文言。項目本文そのものはここに持たず、merge 済み PR の
// `## 顧客価値・目的` 第 1 文（または PR body の `<!-- release-note: -->` 宣言）を
// 出典として `scripts/build-release-notes.mjs` が組み立てる。
//
// 旧実装はコミット件名を顧客向け本文に流用していたため、`approve gate` /
// `孤立 childId` といった開発者語彙がそのまま配信された（#4883）。文面の出典を
// 「開発者が開発者向けに書いた文」から切り離すのが本 namespace の前提である。
export const RELEASE_NOTES_LABELS = {
	title: '🎉 アップデートのお知らせ',
	sectionFeature: '🆕 新しくなったところ',
	sectionFix: '🐛 直したところ',
	// フィードバック導線は 設定 > サポート の単独 SSOT（docs/DESIGN.md §10 / #2904）
	feedbackGuide: 'ご意見・ご要望は **設定 > サポート** からどうぞ！',
	bullet: '• ',
	// 上限を超えた分。`N` を件数で置換する（無言で切り捨てない）。
	// 本 namespace には値にもコメントにも波括弧を書かないこと — build-time パーサ
	// (scripts/lib/parse-labels-ts.mjs) が namespace ブロックを最初の閉じ波括弧で切るため、
	// そこから下の行が丸ごと読めなくなる（欠落は build-release-notes.mjs が例外で止める）
	moreItems: 'ほか N 件の改善をしました。',
} as const;

// ============================================================
// トライアル終了予告メール用ラベル（#4482）
// ============================================================
//
// トライアル終了後に移行する無料プランの制限を述べる行。
// 保持期間の整形は formatRetentionPeriod (constants/plan-retention.ts) が SSOT。
// service 側で `${days}日` と独自整形すると、保持日数を 365 の倍数に変えたときに
// このメールだけ「365日」と述べ、料金表・LP の「1年」と食い違う。

// #4507 (GAMMA 監査 R2 #1): 旧文面は 1 日前 / 当日メールで「データは削除されません」
// 「アップグレードすればいつでも復元できます」と**無条件に**約束していた。無料プラン復帰後の
// 記録は `retention-cleanup-service` が保持期間を過ぎた分を**物理削除**するため、これは虚偽である。
// アーカイブ (上限超過分の非表示化 — 復元可能) と 保持期間切れ (物理削除 — 復元不能) は
// 別事象なので、両方を同じ 1 通の中で言い分ける。
//
// 「復元できません（再契約でも戻りません）」まで述べ切るのは #4496 の解約 / 保持期間文言と
// 同一基準（「閲覧不可」等への弱化は禁止 — 実装は物理削除であり閲覧の可否の話ではない）。

export const TRIAL_EMAIL_LABELS = {
	/**
	 * 無料プランの履歴保持期間を述べる行。
	 *
	 * 「データ保持期間」ではなく「履歴（記録）の保持期間」と呼ぶ (#4507 AC1)。
	 * アカウントやお子さまの登録そのものが期限で消えると読めてしまうため
	 * (実際に期限で消えるのは活動記録などの履歴だけ)。
	 *
	 * @param days 無料プランの保持日数 (null = 無期限)
	 */
	freeRetentionLine: (days: number | null) =>
		`履歴（記録）の保持期間: ${formatRetentionPeriod(days)}`,
	/**
	 * 上限超過リソースのアーカイブについて述べる行。**こちらは復元できる**。
	 * 保持期間切れの物理削除 (retentionIrreversibleLine) と必ず対で使う。
	 */
	archiveRestorableLine: (planLabel: string) =>
		`${planLabel}の上限を超えるお子さま・活動・チェックリストは一時的に非表示（アーカイブ）になります（データは残っており、有料プランにアップグレードすると自動で元に戻ります）。`,
	/**
	 * 保持期間を過ぎた履歴が**物理削除され復元できない**ことを述べる行 (#4507 AC1)。
	 *
	 * @param days 無料プランの保持日数 (null = 無期限)
	 */
	retentionIrreversibleLine: (days: number | null) =>
		days === null
			? '履歴（記録）の保持期間に上限はありません。'
			: `${formatRetentionPeriod(days)}を超えた履歴（記録）は削除され、復元できません（再契約でも戻りません）。`,
} as const;

// ============================================================
// 支払い失敗のお知らせメール用ラベル（#4507 GAMMA 監査 R2 #2）
// ============================================================
//
// dunning (支払い失敗 → 7 日猶予 → suspended) の**唯一の顧客向け通知**。
//
// 旧実装はこの期間の連絡を期限前リマインド (LIFECYCLE_EMAIL_LABELS.renewalSubject
// 「次回更新予定日のお知らせ」) が兼ねており、(a) 件名が支払い失敗の事実を述べず
// (b) marketing 便として配信停止 / 年 6 回上限に抑止されるため、配信停止済みの顧客は
// **1 通も受け取らないまま 7 日後に suspended** になっていた。
//
// 本メールはトランザクション便 (削除予告メールと同区分 — List-Unsubscribe を付けず
// 年 6 回上限も消費しない)。ADR-0012 整合で煽らず、事実と復旧導線だけを述べる。

export const PAYMENT_FAILED_EMAIL_LABELS = {
	subject: (daysRemaining: number) => `お支払いを確認できませんでした（残り${daysRemaining}日）`,
	heading: 'お支払いを確認できませんでした',
	greeting: (ownerName: string) => `${ownerName} 様`,
	intro:
		'ご登録のお支払い方法で、有料プランの更新料をお引き落としできませんでした。カードの有効期限切れや限度額超過が主な原因です。',
	planLine: (planLabel: string) => `ご契約プラン: ${planLabel}`,
	graceLine: (deadline: string, daysRemaining: number) =>
		`${deadline}（残り${daysRemaining}日）までにお支払い方法を更新いただければ、これまでどおりご利用いただけます。`,
	consequenceLine: (freePlanLabel: string) =>
		`更新がないまま期限を過ぎると、有料プランの機能は停止し、${freePlanLabel}のご利用に切り替わります。`,
	ctaLabel: 'お支払い方法を更新する',
	transactionalNote:
		'本メールはご契約に関する重要なご連絡のため、メールの配信設定にかかわらずお送りしています。',
} as const;

// ============================================================
// 退会（アカウント削除）通知メール用ラベル（#4507 GAMMA 監査 R2 #3）
// ============================================================
//
// 旧実装は退会の両端が未配線だった: 予約 route はメールを 1 通も送らず、
// 削除完了メール (sendDeletionCompleteEmail) は production 呼び出しゼロの dead code。
// 無料プランの退会は即時物理削除のため、**通知 0 通でデータが消えていた**。
//
// 削除予告メール (DELETION_WARNING_EMAIL_LABELS) と同じくトランザクション便。

export const DELETION_RESERVED_EMAIL_LABELS = {
	subject: '退会（アカウント削除）のお申し込みを受け付けました',
	heading: '退会のお申し込みを受け付けました',
	greeting: (ownerName: string) => `${ownerName} 様`,
	intro: '退会（アカウント削除）のお申し込みを受け付けました。',
	scheduleLine: (deletionDate: string, graceDays: number) =>
		`お申し込みから${graceDays}日後の${deletionDate}に、すべてのデータを削除します。`,
	/**
	 * 物理削除が停止中の配備で使う版 (#4721)。**削除を断定しない。**
	 *
	 * 削除が走らない状態で「この日にすべてのデータを削除します」と書くのは事実に反する。
	 * 一方で**その日を過ぎるとご自身での取り消しができなくなるのは事実**
	 * (`restoreSoftDeletedTenant` が `isExpired` で拒否する) なので、期限そのものは伝える。
	 */
	scheduleLineRetentionOnly: (deletionDate: string, graceDays: number) =>
		`お申し込みから${graceDays}日後の${deletionDate}を過ぎると、ご自身でのお取り消しができなくなります。`,
	restoreLine: (adminViewLabel: string) =>
		`削除日までは${adminViewLabel}からお取り消しいただけます。削除後のデータは復元できません。`,
	/** 削除を断定しない版 (#4721)。取り消し期限だけを述べる。 */
	restoreLineRetentionOnly: (adminViewLabel: string) =>
		`期限までは${adminViewLabel}からお取り消しいただけます。`,
	exportLine: '記録を手元に残される場合は、削除日までに書き出しをお願いいたします。',
	/** 削除を断定しない版 (#4721)。 */
	exportLineRetentionOnly: '記録を手元に残される場合は、期限までに書き出しをお願いいたします。',
	ctaLabel: 'アカウント設定を開く',
	transactionalNote:
		'本メールはお手続きに関する重要なご連絡のため、メールの配信設定にかかわらずお送りしています。',
} as const;

export const DELETION_COMPLETE_EMAIL_LABELS = {
	subject: 'データの削除が完了しました',
	heading: 'データの削除が完了しました',
	intro: 'がんばりクエストにお預かりしていたデータの削除が完了しました。',
	irreversibleNote: '削除したデータは復元できません。',
	thanks: 'ご利用いただきありがとうございました。',
	signupAgainNote: '再びご利用いただく場合は、新しいアカウントとしてお申し込みください。',
} as const;

// ============================================================
// オーナー権限移譲の通知メール用ラベル（#4507 GAMMA 監査 R2 #6）
// ============================================================
//
// 旧実装は sendMemberJoinedEmail を流用しており、(a) 件名・本文が
// 「新しいメンバーが参加しました」という別事象の説明で (b) 差し込む role に
// 内部コード 'owner' が生のまま渡っていた（内部コード UI 露出禁止、DESIGN.md §6）。

export const OWNERSHIP_TRANSFER_EMAIL_LABELS = {
	subject: 'オーナー権限が移譲されました',
	heading: 'オーナー権限が移譲されました',
	// 宛先は**新オーナー本人**なので二人称で書く (第三者の話として読ませない)。
	greeting: (memberName: string) => `${memberName} 様`,
	body: (roleLabel: string) =>
		`家族グループの「${roleLabel}」権限があなたに移譲されました。メンバーの招待・削除や、プラン・お支払いのお手続きが行えます。`,
	ctaLabel: 'メンバー管理を開く',
} as const;

// ============================================================
// ライフサイクルメール用ラベル（#1601 / ADR-0023 §3.2 §3.3 §5 I11）
//
// 期限切れ前リマインド (renewal) + 休眠復帰 (dormant) + 配信停止 (unsubscribe) の
// メール文言 SSOT。Anti-engagement 原則（ADR-0012）に従い、煽り表現
// （「今すぐアップグレード」「失効します」等）を含めない中立的トーンとする。
//
// 親宛のみ送信されるため、敬語ベース（「ご利用ありがとうございます」「ご確認ください」）。
//
// #1961 (Phase 7 H4) atom 直書き監査:
//   - planLabel は呼び出し側 (renewal-reminder service) から引数注入され、PLAN_LABELS / PLAN_FULL_TERMS
//     経由で解決済みの compound を渡す設計のため本 namespace に直書きしない。
//   - daysRemaining / days / expiresAt も全て引数注入で計算ロジック側の責務。
//   - 件名・heading・本文は「次回更新予定日」「お元気でいらっしゃいますか」等の独自用語のみで
//     構成され、プラン名・価格・トライアル日数・解約期間の atom には依存しない。
//   - 検証: 範囲内に '無料' / 'スタンダード' / 'ファミリー' / '7日間' / '7 日間' / '¥\d+' /
//     '無料プラン' / 'スタンダードプラン' / 'ファミリープラン' リテラル 0 件。
// ============================================================

export const LIFECYCLE_EMAIL_LABELS = {
	// ---- 期限切れ前リマインド（renewal-reminder） ----
	renewalSubject: (daysRemaining: number) => `次回更新予定日のお知らせ（残り${daysRemaining}日）`,
	renewalHeading: '次回更新予定日のお知らせ',
	renewalGreeting: (ownerName: string) => `${ownerName} 様`,
	renewalIntro: 'いつも がんばりクエスト をご利用いただきありがとうございます。',
	renewalPlanLine: (planLabel: string) => `ご契約プラン: ${planLabel}`,
	renewalDateLine: (expiresAt: string, daysRemaining: number) =>
		`次回更新予定日: ${expiresAt}（残り ${daysRemaining} 日）`,
	renewalContinue: 'サービスを継続される場合は、お支払い情報をご確認ください。',
	renewalGraduate: `卒業（解約）をご希望の場合は、${ADMIN_VIEW_TERMS.canonical}から手続きできます。`,
	renewalCtaLabel: 'プラン管理ページを開く',

	// ---- 休眠復帰（dormant-reactivation） ----
	dormantSubject: 'お元気でいらっしゃいますか',
	dormantHeading: 'お元気でいらっしゃいますか',
	dormantGreeting: (ownerName: string) => `${ownerName} 様`,
	dormantIntro: 'がんばりクエスト の運営です。',
	dormantSinceLastActive: (days: number) => `最後にログインされてから ${days} 日が経過しました。`,
	dormantGraduationNote: 'お子さまが卒業されたなら、何よりの成果です。',
	dormantReturnNote: 'もし戻りたい場合は、いつでもログインできます。',
	dormantPasswordNote: 'お忘れの場合は、パスワードリセットも可能です。',
	dormantCtaLabel: 'ログイン画面を開く',

	// ---- 配信停止 (unsubscribe) ----
	unsubscribeFooter: '配信停止',
	unsubscribePageTitle: 'メール配信停止',
	unsubscribeHeading: 'メール配信を停止しました',
	unsubscribeIntro:
		'今後、期限切れ前リマインド・休眠復帰メールはお送りしません。トランザクションメール（解約受付など）は引き続き送信されます。',
	unsubscribeAlreadyTitle: 'メール配信停止について',
	unsubscribeAlreadyIntro:
		'このリンクはメール配信停止用のリンクです。下のボタンを押すと、ご登録メールアドレスへのマーケティングメール配信が停止されます。',
	unsubscribeConfirmCta: '配信を停止する',
	unsubscribeReturnCta: 'トップに戻る',
	unsubscribeInvalidTitle: '無効なリンクです',
	unsubscribeInvalidIntro:
		'このリンクは無効か、すでに使用済みです。メール本文に記載されたリンクを再度ご確認ください。',

	// ---- フッター ----
	footerNote: 'このメールは「がんばりクエスト」から自動送信されています。',
	footerCopyright: '© 2026 がんばりクエスト',
} as const;

// ============================================================
// アカウント削除予告メール（#2399）
// ============================================================

// 猶予期間中のテナントに送る「このままだとデータが消えます」の予告文言 SSOT。
//
// トーン方針:
//   - Anti-engagement (ADR-0012): 「今すぐ復元!」等の煽りを置かない。事実 (予定日 / 残日数) と
//     取れる行動 (復元 / 何もしない) だけを並べる
//   - 子供の名前・活動内容は載せない (runbook §2 中立トーン原則)。宛先は保護者であり、
//     削除予告に子供の記録内容を差し込むのは引き止め目的の情報利用になる
//   - 「配信停止しても届く」ことを本文で明示する。法務通知であり購読設定の対象外であるため
export const DELETION_WARNING_EMAIL_LABELS = {
	subject: (daysRemaining: number) => `データ削除予定日のお知らせ（あと ${daysRemaining} 日）`,
	heading: 'データ削除予定日のお知らせ',
	greeting: (ownerName: string) => `${ownerName} 様`,
	intro: `お申し出いただいたアカウント${CANCEL_TERMS.account}の手続きについてお知らせします。`,
	deletionDateLine: (deletionDate: string, daysRemaining: number) =>
		`データの削除予定日: ${deletionDate}（あと ${daysRemaining} 日）`,
	irreversibleNote: '削除予定日を過ぎるとデータは元に戻せません。',
	restoreNote: (adminView: string) =>
		`削除予定日までは、${adminView}の「アカウント」から取り消し（復元）ができます。`,
	noActionNote: 'このまま削除をご希望の場合、お手続きは不要です。',
	/**
	 * 物理削除が停止中の配備で使う版 (#4721)。**削除の断定をやめ、取り消し期限だけを述べる。**
	 *
	 * 送信自体は止めない — 猶予中に「まだ戻せる」ことを思い出す接点がこのメールしかなく、
	 * 止めると復元できるのに戻らない顧客を作る。嘘をやめるのに便を止める必要はない。
	 */
	subjectRetentionOnly: (daysRemaining: number) =>
		`お取り消し期限のお知らせ（あと ${daysRemaining} 日）`,
	headingRetentionOnly: 'お取り消し期限のお知らせ',
	deadlineDateLine: (deadlineDate: string, daysRemaining: number) =>
		`お取り消しができる期限: ${deadlineDate}（あと ${daysRemaining} 日）`,
	irreversibleNoteRetentionOnly: '期限を過ぎると、ご自身でのお取り消しはできなくなります。',
	restoreNoteRetentionOnly: (adminView: string) =>
		`期限までは、${adminView}の「アカウント」から取り消し（復元）ができます。`,
	noActionNoteRetentionOnly: 'このままお手続きを進める場合、操作は不要です。',
	ctaLabel: 'アカウント設定を開く',
	transactionalNote:
		'このお知らせはお手続きに関する大切なご連絡のため、メール配信設定にかかわらずお送りしています。',
} as const;

// ============================================================
// 削除前エクスポート JSON の但し書き（#4470 / #4450 follow-up）
// ============================================================

/**
 * 退会時に顧客へ手渡す JSON (`generateMinimalExport`) の `notes` 文言 SSOT。
 *
 * トーン方針:
 *   - 事実のみを書く。法務的主張 (「○○ 法に準拠しています」等) や弁明は書かない
 *   - 読み手は開発者ではない保護者。フィールド名は識別のため原文のまま出す
 */
export const DELETION_EXPORT_NOTE_LABELS = {
	/** 日付が JST 暦日であること (ISO の UTC 表記と 9 時間ずれるため明記する) */
	jstCalendarDate: 'firstRecordDate / lastRecordDate は日本標準時（JST）の暦日です（YYYY-MM-DD）。',
	/** null の意味 (記録 0 件のみ) */
	nullMeansNoRecord: '記録が 1 件もない場合、firstRecordDate / lastRecordDate は null になります。',
	/**
	 * retention 削除済みデータは開示対象外であること + 保存期間の実日数 (#4473)。
	 *
	 * 「上限を過ぎた記録は含まれない」だけでは、読み手は「いつまで遡って含まれているか」を
	 * 確定できない。日数は `PlanLimits.historyRetentionDays` が SSOT のため、
	 * ここでは **値を持たず引数で受ける** (labels 側に 90 / 365 を複製しない)。
	 */
	// #4482: 整形は formatRetentionPeriod が SSOT（365 の倍数なら「1年間」と述べる）。
	retentionLimited: (days: number) =>
		`記録の保存期間は${formatRetentionPeriod(days)}間です。それより古い記録は削除済みのため、この期間には含まれません。`,
	/**
	 * `historyRetentionDays: null` (保存期間の上限なし) のプラン向け。
	 * 「null日間」のような値の穴埋めにせず、上限がないという事実を別文で述べる。
	 */
	retentionUnlimited: '記録の保存期間に上限はないため、期間の上限による削除は行っていません。',
	/**
	 * 登録日の在り処。
	 * `children[].createdAt` は JST 暦日ではなく ISO 8601 の UTC 日時をそのまま出しているため、
	 * 形式を併記する (併記しないと上の JST 暦日と混同され、JST 00:00〜09:00 登録が前日に見える)。
	 */
	createdAtPointer: `${CHILD_TERMS.honorific}の登録日は children[].createdAt（協定世界時 UTC の日時）をご覧ください。`,
} as const;

/**
 * #3070: federated PIN reset の確認コードメール文言 SSOT。
 * Anti-engagement (ADR-0012) 整合: 煽らず中立トーン。「心当たりがなければ無視してください」で
 * 不正送信時の安全側案内も含める。
 */
export const PIN_RESET_EMAIL_LABELS = {
	subject: `【がんばりクエスト】${OYAKAGI_TERMS.name}再設定の確認コード`,
	heading: `${OYAKAGI_TERMS.name}再設定の確認コード`,
	intro: `${OYAKAGI_TERMS.name}の再設定をご希望の場合は、以下の確認コードを入力してください。`,
	codeNote: 'このコードは10分間有効です。',
	ignoreNote: 'このメールに心当たりがない場合は、操作せずにこのまま無視してください。',
} as const;

// ============================================================
// Push Notification 関連 (#1593 ADR-0023 I6)
// 子端末への push 通知は構造的禁止 (Anti-engagement ADR-0012 + COPPA 改正)
// ============================================================
export const PUSH_NOTIFICATION_LABELS = {
	/** child role が subscribe を試みた際の API エラーメッセージ */
	childSubscribeForbidden:
		'お子さま用アカウントでは通知を受け取れません。保護者アカウントで設定してください。',
	/** 監査ログ用: child 端末への通知送信を skip した際のメッセージ */
	childSendSkipped: 'child role の subscription への push 送信をスキップしました',
	/** 既存レコードに不正な role が混入していた場合の警告 */
	unknownRoleSkipped: '不明な subscriber_role の subscription への送信をスキップしました',
} as const;
