// labels 層 (ADR-0045 / #4965): 契約の手続き (/admin/subscription/**・/pricing・checkout・解約・ダウングレード) と、そこから LP が引く共有文 (画面をまたぐ機能)。置き場所の規則は docs/DESIGN.md §6
// #4482: 保持日数の「整形」も SSOT を経由する。表示側で `${days}日` と独自整形すると、
// 保持日数を 365 の倍数に変えたときにここだけ「365日」と述べ、料金表の「1年」と食い違う。
import { formatRetentionPeriod } from '../constants/plan-retention';
import {
	ADMIN_SCREEN_TERMS,
	ADMIN_VIEW_TERMS,
	CANCEL_TERMS,
	CHECKOUT_TERMS,
	CHILD_TERMS,
	DELETION_EXPORT_TERMS,
	DELETION_GRACE_TERMS,
	FREE_TERMS,
	LP_FAQ_TERMS,
	NUC_EDITION_TERMS,
	PLAN_CHANGE_TERMS,
	PLAN_FULL_TERMS,
	PLAN_RETENTION_TERMS,
	PLAN_TERMS,
	PRICE_TERMS,
	SIGNUP_TERMS,
	STRIPE_PORTAL_TERMS,
	TOKUSHOHO_TERMS,
	TRIAL_TERMS,
} from '../terms';
import { ACTION_LABELS } from './common';

// ============================================================
// SUBSCRIPTION_PAGE_LABELS — /admin/subscription プランページ (旧 LICENSE_PAGE_LABELS)
// ============================================================
//
// Phase 7 PR-2c (#2699): 旧 LICENSE_PAGE_LABELS を本 namespace に rename + Phase 3 #2567
// §文言 atom 確定済 9 key を統合 (105 key)。Phase 5 SSOT §4.1 整合。
// rename 後の正本として `SaasLicensePanel.svelte` 等 96 件から参照される。
// 旧 LICENSE_PAGE_LABELS は本ファイル末尾で alias export として残存 (共存期間)。

// #4540 Q4 (#4619): 解約導線で「記録は残ります」だけを述べると、**無料プランの保持期間を超えた
// 記録が物理削除される**事実が解約を決める瞬間に見えない (PO 決裁: 顧客に有利に見える方向の
// 不正確さ)。特商法「解約とデータの取扱い」(LP_LEGAL_TOKUSHOHO_LABELS.tableContent) と同じ 2 文
// をここで 1 度だけ組み立て、解約導線の各文言が共有する。
//
// 数値の SSOT は `constants/plan-retention.ts` の PLAN_HISTORY_RETENTION_DAYS ただ 1 箇所。
// 本文言は PLAN_RETENTION_TERMS (terms.ts atom) 経由でしか参照せず、日数を直書きしない。
export const FREE_PLAN_RETENTION_NOTICE = `${PLAN_FULL_TERMS.free}の履歴保持期間は ${PLAN_RETENTION_TERMS.freeSpaced}です。${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）。`;

// #4156: 書き込みが許可されている契約状態 (猶予 / 停止 / 解約済み) の告知に必ず添える保証文。
// 3 つの告知が同じ事実を語るため、文言をここで 1 度だけ組み立てて共有する
// (`SUBSCRIPTION_PAGE_LABELS.writesContinueAssurance` として export もする)。
export const WRITES_CONTINUE_ASSURANCE = `お子さまの記録はそのまま残り、${PLAN_FULL_TERMS.free}の範囲で記録・ポイント付与を続けられます。`;

// #4585-4: アーカイブされたものが「消えた」のか「戻せる」のかを述べる保証文。
// `restoreArchivedResources` は 3 reason (体験終了 / 顧客の選択 / 支払い失敗) すべてを復元する
// (#4585-3) ため、**どの経路でアーカイブされても再契約で戻る**。これを書かないと、実際には
// 戻せるのに諦める顧客が出る (PO 決裁 4 本目)。解約画面 (`CANCELLATION_LABELS`) と
// 契約終了の告知 (`SUBSCRIPTION_PAGE_LABELS.cancelledDesc`) で**同一の文**を共有する。
const ARCHIVE_RESTORE_ASSURANCE = `アーカイブしたデータは削除しません。再度${SIGNUP_TERMS.canonical}いただくと元に戻せます。`;

export const SUBSCRIPTION_PAGE_LABELS = {
	// Phase 3 #2567 §文言 atom 確定 9 key (PR-2b で先行配備、本 PR で統合)
	pageTitle: 'ご家族のプラン管理',
	currentPlan: '現在のプラン',
	// アップグレード CTA (Kinde 「what happens when clicked」原則、Phase 4 #2624 §2.1 整合)
	upgradeCta: `${PLAN_FULL_TERMS.premium}にする`,
	// CTA 直下「いつでも解約」併記 (frictionless、Kinde 整合)
	cancelAnytime: CANCEL_TERMS.anytimeOk,
	// trial CTA 直下「クレカ登録不要」(Phase 3 #2571 整合)
	noCreditCard: TRIAL_TERMS.noCreditCardMid,
	// 請求情報リンク (BILLING_LABELS と隣接)
	billingLink: 'ご請求情報を確認',
	// 解約リンク (frictionless 控えめ表示、Kinde 整合)
	cancelLink: `${CANCEL_TERMS.canonical}をご検討の方`,
	// V4 framing 軸 decoy bait (standard 推奨バッジ、Phase 1 補強 2 F9 解消)
	standardRecommendBadge: '✓ お勧め',

	// === 旧 LICENSE_PAGE_LABELS 統合 (96 key) ===
	// 現在のプラン
	currentPlanTitle: '現在のプラン',
	currentPlanLabel: 'プラン',
	currentPlanStatus: 'ステータス',
	currentPlanExpiry: '有効期限',
	currentPlanFamilyName: '家族名',
	currentPlanCreatedAt: '登録日',

	// 注: ライセンスキー適用 / 確認ダイアログ系 key (licenseKey* / currentPlanLicenseKey) は
	//     Epic #2525 Phase 7 PR-L4 (#2836) license key 全廃に伴い撤去済。entitlement は Stripe
	//     Subscription (tenant.status=ACTIVE) が唯一 SSOT で、キー入力 UI / 適用ダイアログは存在しない。

	// プランラベル
	// #1963: atom (PLAN_TERMS / PRICE_TERMS) を terms.ts から参照
	planLabelMonthly: `${PLAN_TERMS.standard}月額（${PRICE_TERMS.standard}/月）`,
	planLabelYearly: `${PLAN_TERMS.standard}年額（${PRICE_TERMS.standardYearly}/年）`,
	planLabelFamilyMonthly: `${PLAN_TERMS.premium}月額（${PRICE_TERMS.family}/月）`,
	planLabelFamilyYearly: `${PLAN_TERMS.premium}年額（${PRICE_TERMS.familyYearly}/年）`,
	planLabelLifetime: '永久ライセンス',
	planLabelFree: `${PLAN_FULL_TERMS.free}`,

	// ステータスラベル
	statusActive: '有効',
	statusGracePeriod: '猶予期間',
	statusSuspended: '停止中',
	/** S5 契約終了 (#4156)。S6 `terminated` (退会) を表す statusTerminated とは別状態 */
	statusCancelled: `${CANCEL_TERMS.canonical}済み`,
	// #4496: S6 は退会 (アカウント削除) 済みの状態。S5 (解約済み) と同じ「解約済み」を出すと
	//   2 状態が区別できず、CANCEL_TERMS.account ('退会') の使い分けにも反する。
	statusTerminated: `${CANCEL_TERMS.account}済み`,

	// 無料トライアル
	// #1963: atom (PLAN_FULL_TERMS / TRIAL_TERMS) を terms.ts から参照
	trialActiveTitle: `${PLAN_FULL_TERMS.premium} トライアル中`,
	trialActiveDays: (days: number | string) => `残り ${days}日`,
	// #4628: トライアル中にしか出ない文なので期限は必ず具体値。旧 `date ?? ''` は
	// null のとき日付の無い「 まで」を出す band-aid だった (#4622 の `?? 0` と同一 class)。
	trialActiveUntil: (date: string) => `${date} まで`,
	trialStartTitle: `${TRIAL_TERMS.duration} 無料でお試し`,
	// #4578: トライアルは premium 固定。#4668: ボタン名は TRIAL_TERMS.startButton (atom) が SSOT
	trialStartDesc: `${PLAN_FULL_TERMS.premium}の全機能を体験できます`,
	trialStartButton: TRIAL_TERMS.startButton,
	trialStartNote: 'クレジットカード不要 — 自動で課金されることはありません',
	trialUsed: '無料トライアルは使用済みです',

	// #3991: 期末解約 (cancel_at_period_end) の予約中バナー。
	// 「解約申請中か」「いつまで使えるか」は Stripe が SSOT のため、load で都度取得した値を表示する。
	cancelPendingTitle: `${CANCEL_TERMS.canonical}手続き中です`,
	cancelPendingDesc: (date: string) =>
		`${date} まで現在のプランをそのままご利用いただけます。この日を過ぎると${PLAN_FULL_TERMS.free}に切り替わります（お子さまの記録は残ります）。${FREE_PLAN_RETENTION_NOTICE}`,
	cancelPendingDescUnknownDate: `現在の請求期間の終了日まで現在のプランをそのままご利用いただけます。その後は${PLAN_FULL_TERMS.free}に切り替わります（お子さまの記録は残ります）。${FREE_PLAN_RETENTION_NOTICE}`,
	cancelPendingRevertAction: `${CANCEL_TERMS.canonical}を取り消して継続する`,
	cancelPendingRevertSubmitting: '取り消しています…',
	cancelPendingRevertError: `${CANCEL_TERMS.canonical}の取り消しに失敗しました。時間をおいて再度お試しください`,
	cancelPendingExpiryLabel: 'ご利用いただける最終日',

	// ステータス別メッセージ
	//
	// #4156: 文言は認可の実挙動 (`authorization.ts`) を SSOT とする (ADR-0013)。
	// #3993 の PO 判断により、支払い停止中も解約後も**無料プラン相当で書き込みは許可される**
	// (上限は free tier の plan limit が担う)。したがって「記録やポイントの付与はできません」
	// と書いてはならない。対応表と検証は `contract-state-view.ts` / 同名 test にある。
	/** 書き込みが許可されている契約状態の告知に必ず添える保証文 */
	writesContinueAssurance: WRITES_CONTINUE_ASSURANCE,
	/**
	 * 無料プランの保持期間 (特商法と同一の 2 文)。#4540 Q4 の PO 回答 (2026-09-03) により、
	 * 解約導線の**全状態 (S3 猶予 / S4 停止 / S5 契約終了)** で述べる。「解約したら履歴がいつまで
	 * 残るか」は解約を決める瞬間に効く情報で、契約が生きているかどうかで出し分ける理由がない。
	 * 出さないと「消えると思わなかった / 消えると思った」の両方が起きる (#4507 系の齟齬)。
	 */
	freePlanRetentionNotice: FREE_PLAN_RETENTION_NOTICE,
	gracePeriodTitle: '⚠️ 猶予期間中',
	gracePeriodDesc: `お支払いの確認が取れていません。猶予期間内にお支払いを完了してください。期間を過ぎると有料プランの機能が止まります。${WRITES_CONTINUE_ASSURANCE}${FREE_PLAN_RETENTION_NOTICE}`,
	/** S4 停止 (契約は残り復帰しうる) — 旧 suspendedTitle / suspendedDesc */
	paymentSuspendedTitle: '⏸️ 有料プランの機能を止めています',
	// S4 の文言は 3 つの事実を落とさない:
	//   (a) 保持期間の 2 文は**必ず末尾**。復旧の案内の直前に置くと
	//       「再契約でも戻りません」→「元に戻ります」が隣り合い、顧客には矛盾に読める
	//   (b) **S4 では削除は起きていない** (PO 決定 2026-09-04)。`retention-cleanup-service` は
	//       `isRetainedSuspendedContract` (S4 = suspended かつ subscription あり) のテナントを
	//       skip する。物理削除が走るのは S5 (契約終了) 以降だけ。よってここを現在形
	//       (「すでに削除されています」) で書くと、実装が行っていないことを述べることになる
	//   (c) ただし**表示は絞られる**。`resolvePlanTier` は変えていないので S4 の planTier は
	//       `free` のままで (`contract-state-matrix.md` §4 の S4 行)、`applyRetentionFilter(free)`
	//       により無料プランの期間を超えた記録は一覧に出ない。「消えた」と読ませないため、
	//       見えなくなるだけで削除はされず、復帰すれば再び見えることをここで述べる
	//   (d) 契約が終了したときに起きることを**猶予があるように書かない**。保持期間の起算は
	//       レコードの日付であって契約終了日ではない (PO 決定 2026-09-04:「起算を S5 到達日に
	//       付け替える必要はない」/ `getHistoryCutoffDate` は今日からの相対日数)。したがって
	//       長く停止していた世帯は、契約終了後**最初の削除処理で、期間を過ぎた分をまとめて**失う。
	//       「終了したあとは次の保持期間が適用されます」と書くと「終了日から数え直す猶予がある」と
	//       読ませてしまうため、崖であることをそのまま書く。
	// 順序: いま何が起きているか → 復旧の案内 → 契約が終わったときに起きること → 保持期間 (末尾)。
	// S3 (grace_period) は licenseStatus=ACTIVE のまま有料 tier が維持され、表示も絞られないので
	// (c) の注記は S4 だけに置く。
	paymentSuspendedDesc: `お支払いを確認できないため、有料プランの機能を止めています。${WRITES_CONTINUE_ASSURANCE}ご契約が残っているあいだ、これまでの記録を削除することはありません。ただし${PLAN_FULL_TERMS.free}と同じ範囲でしか表示されないため、その期間を超えた記録は一時的に見えなくなります。お支払い方法を更新すると有料プランの機能に戻り、見えなくなっていた記録もまた表示されます。ご契約が終了して${PLAN_FULL_TERMS.free}に移ると、そこから数え直すのではなく、すでに保持期間を過ぎている記録は最初の削除処理でまとめて削除されます。${FREE_PLAN_RETENTION_NOTICE}`,
	/** S5 契約終了 (解約確定) */
	cancelledTitle: `✅ ${CANCEL_TERMS.canonical}が完了しました`,
	// #4585-4: S5 は**支払い失敗で契約が終わった顧客が着く唯一の画面**でもある。この経路は
	// 顧客本人が操作していないため解約画面 (#4585-1 の fallback 提示 + 選択 UI) を一度も通らず、
	// 上限超過分がアーカイブされること (#4585-3 で dunning にも適用) をここでしか知れない。
	// 「記録はそのまま残り」だけで止めると、超過分が見えなくなった顧客に対して事実と食い違う。
	// #4540 Q4 (#4621): 移行先 (無料プラン) の保持期間も同じ告知で述べる。アーカイブ (戻せる) と
	// 保持期間超過による物理削除 (戻せない) は別の事象なので、両方を落とさず並べる。
	cancelledDesc: `有料プランは終了しました。${WRITES_CONTINUE_ASSURANCE}${PLAN_FULL_TERMS.free}の上限を超える分はアーカイブします。${ARCHIVE_RESTORE_ASSURANCE}${FREE_PLAN_RETENTION_NOTICE}`,
	terminatedTitle: `❌ ${CANCEL_TERMS.account}のお手続きが完了しています`,
	terminatedDesc: `このアカウントはアカウント${CANCEL_TERMS.account}（アカウント削除）のお手続きが済んでいます。データはご利用プランに応じた猶予期間（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free}削除 / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standardSpaced}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premiumSpaced}間）のあいだ保持され、その経過後にすべて削除されます。`,

	// 請求履歴 (#4156)
	//
	// 契約が終わっても**過去の取引**は残る。請求書・領収書は特商法の表示義務に接続するため、
	// 契約の有無ではなく `stripeCustomerId` の有無で到達可能にする。解約理由の送信を
	// 経由させて領収書に辿り着かせる導線 (統合直後の唯一の退路) は取らない。
	billingHistoryTitle: STRIPE_PORTAL_TERMS.history,
	billingHistoryDesc: `契約は終了していますが、これまでのお支払いの記録は残っています。Stripe の${STRIPE_PORTAL_TERMS.short}でご確認いただけます。`,
	billingHistoryFeatureInvoices: '過去の請求書・領収書の確認とダウンロード',
	billingHistoryFeatureReceipts: 'お支払い履歴の確認',
	billingHistoryButton: (loading: boolean) => (loading ? '読み込み中...' : '請求履歴を確認する'),
	billingHistoryNote: `Stripe の安全な${STRIPE_PORTAL_TERMS.short}に移動します`,
	billingHistoryPinNote: (usesPin: boolean) =>
		`⚠️ お支払い情報を開くには${usesPin ? '親 PIN' : '確認フレーズ'}の入力が必要です`,
	/** 請求履歴から開くときの確認ダイアログ (操作の目的がプラン変更ではないため文言を分ける) */
	portalConfirmTitleBillingHistory: '請求履歴を開く確認',
	portalConfirmDescBillingHistory: `Stripeの${STRIPE_PORTAL_TERMS.short}に移動します。過去の請求書・領収書をご確認いただけます。`,
	portalConfirmSubmitBillingHistory: `${STRIPE_PORTAL_TERMS.short}へ`,

	// プラン管理
	planManagementTitle: 'プラン管理',
	planManagementUnavailable: '決済機能は現在準備中です',
	// #4257 / #4166 AC5: 着地 (portal トップ = 支払い方法・請求履歴) と名前を一致させる。
	// 「プラン変更・支払い管理」はプラン変更画面へ直行するように読めるが、実際に開くのは
	// portal トップであり、名前と着地がずれていた。プラン変更の直行導線は
	// PlanStatusCard のアップグレード CTA が、解約は下の解約リンクが担う (入口は増やさない)。
	portalButton: (loading: boolean) =>
		loading ? '読み込み中...' : `${STRIPE_PORTAL_TERMS.short}を開く`,
	portalNote: `Stripeの${STRIPE_PORTAL_TERMS.short}でプラン変更・支払い方法の更新・解約ができます`,
	// #4270: portal の flow が Stripe に拒否されて home に倒れたときの案内。
	// 原因 (Dashboard 設定 / Stripe の拒否) は顧客に説明せず、次の操作だけを示す (ADR-0062)。
	portalFallbackCancel: `${CANCEL_TERMS.canonical}のお手続きは、この画面の「${STRIPE_PORTAL_TERMS.short}を開く」から続けてください。`,
	portalFallbackPlanChange: `${PLAN_CHANGE_TERMS.changeNoun}のお手続きは、${STRIPE_PORTAL_TERMS.short}から続けてください。`,
	// #4548: 上の 2 つは「時間をおけば直りうる」一時障害 (#4270) 用。ご契約情報が確認できない
	// 状態 (#4537) は**何度押しても同じ結果**になるため、同じ文言で再試行させると顧客は
	// 出口の無いループに入る (特商法上の解約導線の実効性)。できないことを正直に伝え、
	// こちらで手続きを承ると約束する。原因の内部詳細は出さない (ADR-0062)。
	portalFallbackCancelUnavailable: `ご契約情報を確認できないため、この画面から${CANCEL_TERMS.canonicalVerb}ことができません。お手数ですが、サポート窓口までご連絡ください。こちらで${CANCEL_TERMS.canonical}のお手続きを承ります。`,
	portalFallbackPlanChangeUnavailable: `ご契約情報を確認できないため、この画面から${PLAN_CHANGE_TERMS.changeNoun}のお手続きができません。お手数ですが、サポート窓口までご連絡ください。`,
	/** 恒久的に自力で完了できないときの唯一の出口 (設定 > サポートの単独 SSOT、#2904) */
	portalFallbackSupportLink: 'サポート窓口に連絡する',
	/** fallback 時に、作成済みの portal セッションへそのまま進むための導線 (PIN を再入力させない) */
	portalFallbackContinueButton: `${STRIPE_PORTAL_TERMS.short}へ進む`,
	portalPinNote: (usesPin: boolean) =>
		`⚠️ プラン変更には${usesPin ? '親 PIN' : '確認フレーズ'}の入力が必要です`,
	billingMonthly: '月額',
	// #3208: billingYearly は年額廃止 (#2719) で撤去 (LP-truth、checkout が yearly を reject)
	// #3204: checkout 失敗時のユーザ向けフィードバック (silent no-op 撲滅)
	checkoutFailed: '決済を開始できませんでした。時間をおいて再度お試しください',
	checkoutFailedToastTitle: '決済を開始できませんでした',
	// #4286: STRIPE_DISABLED (決済機能自体が無効な配備) と PRICE_UNRESOLVED (price ID 解決失敗という
	// 別種の設定不備) が同一文言 ('決済機能は現在利用できません') だったため、顧客が「設定不備」と
	// 「機能停止」を区別できず、再試行導線も無いまま離脱していた問題を是正。原因の内部詳細
	// (price ID 未解決等) は出さず、次に取るべき行動だけを示す (ADR-0062、内部例外の非露出)。
	checkoutErrorPriceUnresolved:
		'ただいま決済の準備ができていません。時間をおいて再度お試しください',
	// #4329 ②: checkout 失敗時に顧客が読む文言の SSOT (route 側の直書き禁止、DESIGN.md §6)。
	// 分類は「顧客が次に何をできるか」で分ける。**サーバー側の異常を顧客の入力ミスとして
	// 表示しない** — 原因の所在を偽ると、顧客は直しようのない操作を繰り返す (ADR-0062)。
	checkoutErrorStripeDisabled: '決済機能は現在利用できません',
	checkoutErrorAlreadySubscribed: '既にサブスクリプションに加入済みです',
	/** 配備・設定側の異常。顧客に取れる手は「時間をおく」だけなのでそれだけを示す */
	checkoutErrorServer: 'ただいまお申し込みを受け付けられません。時間をおいて再度お試しください',
	/** 受け取ったリクエストが現行の申込内容と噛み合わない (古い画面のまま操作した等) */
	checkoutErrorStaleRequest:
		'お申し込みを開始できませんでした。ページを再読み込みしてから、もう一度お試しください',
	/** #4329: portal session 自体を作れなかったとき。原因は出さず次の行動だけを示す (ADR-0062) */
	portalErrorCreateFailed: `${STRIPE_PORTAL_TERMS.short}を開けませんでした。時間をおいて再度お試しください`,
	checkoutErrorUnauthenticated: '認証が必要です',
	checkoutErrorForbidden: 'サブスクリプションの管理は保護者のみ可能です',
	// #4161: 決済が未設定の配備 (セルフホスト / 設定不備) でアップグレード操作を押したときの説明。
	// 確認ダイアログを開いてから失敗させる dead-end を作らず、押した時点で理由を提示する。
	billingUnavailable:
		'この環境では決済機能が有効になっていないため、プランの変更手続きに進めません',
	billingUnavailableToastTitle: 'プランの変更手続きに進めません',

	// スタンダードプラン
	// #1963: atom (PLAN_TERMS / PRICE_TERMS) を terms.ts から参照
	standardPlanName: `${PLAN_TERMS.standard}`,
	standardPlanDesc: `${CHILD_TERMS.honorific}無制限・活動無制限・${PLAN_RETENTION_TERMS.standard}保持`,
	standardPriceMonthly: `${PRICE_TERMS.standard}`,
	standardPerMonth: '/月',
	// #3208: standardPriceYearly / standardPerYear / standardYearlyMonthlyEquiv は
	// 年額廃止 (#2719) で撤去 (LP-truth、pricing.html の年額 UI は #3212 で撤去済)

	// ファミリープラン
	// #1963: atom (PLAN_TERMS / PRICE_TERMS) を terms.ts から参照
	familyPlanName: `${PLAN_TERMS.premium}`,
	familyPlanDesc: '家族みんなで見守る+永久保持',
	familyPriceMonthly: `${PRICE_TERMS.family}`,
	// #3208: familyPriceYearly / familyYearlyMonthlyEquiv は年額廃止 (#2719) で撤去 (LP-truth)
	familyRecommendBadge: 'おすすめ',

	// 購入ボタン
	// #1963: tier 分岐内 atom (PLAN_TERMS) を terms.ts から参照
	checkoutButton: (tier: string, loading: boolean) =>
		loading
			? '処理中...'
			: `${tier === 'family' ? PLAN_TERMS.premium : PLAN_TERMS.standard}プランで始める`,
	checkoutNote: `いつでも${CANCEL_TERMS.canonical}・プラン変更可能`,

	// 支払い履歴
	paymentHistoryTitle: '支払い履歴',
	paymentHistoryPortalNote: `支払い履歴はStripeの${STRIPE_PORTAL_TERMS.short}でご確認いただけます`,
	paymentHistoryPortalButton: '支払い履歴を確認',
	paymentHistoryEmpty: '支払い履歴はまだありません',
	paymentHistoryBillingLink: '🧾 請求書・支払い方法の管理',

	// Portal 確認ダイアログ
	portalConfirmTitle: 'プラン変更の確認',
	portalConfirmDesc: `Stripeの${STRIPE_PORTAL_TERMS.short}に移動します。この画面からプラン変更・解約・ダウングレードが可能です。`,
	portalConfirmWarning: '⚠️ 誤操作による解約・ダウングレードを防ぐため、',
	portalConfirmWarningPin: 'を入力してください。',
	portalConfirmWarningPhrase: '確認フレーズ',
	portalConfirmCancel: 'キャンセル',
	portalConfirmLoading: '確認中…',
	portalConfirmSubmit: 'プラン変更画面へ',

	// ダウングレードエラー
	downgradeInfoError: 'ダウングレード情報の取得に失敗しました',
	downgradeArchiveError: 'リソースのアーカイブに失敗しました',
	portalFetchError: 'プラン変更の確認に失敗しました',
	portalConfirmPhraseError: (phrase: string) => `「${phrase}」と入力してください`,
	portalConfirmPhraseLabel: (phrase: string) => `確認のため「${phrase}」と入力してください`,

	// Churn prevention
	churnLostItemMonthly: (months: number | string) => `月替わり限定アイテム ${months}個`,
	churnLostItemTickets: (count: number | string) => `思い出チケット ${count}枚`,
	// #4502 (GAMMA-K2-09): 語彙は #1912 で「毎日のごほうび」に統一済み。解約画面にだけ
	// 旧語彙が残っていた
	churnLostItemBonus: (multiplier: number | string) => `毎日のごほうび ×${multiplier}倍`,
	churnLostItemTitle: (title: string) => `「${title}」称号`,
	// #4482: 整形は formatRetentionPeriod が SSOT（365 の倍数なら「1年以前」と述べる）。
	// #4496: 「アクセス」だけだと閲覧できなくなるだけに読めるが、実装 (retention-cleanup-service) は
	//   物理削除であり再契約でも戻らない。失うものの一覧なので、その事実をそのまま述べる。
	churnLostRetentionDays: (days: number | null) =>
		`${formatRetentionPeriod(days)}以前の記録（削除され、復元できません）`,

	// デモ版固有ラベル
	demoNotice: 'これはデモ画面です',
	demoNoticeOperationsDisabled: '実際の操作はできません',
	demoNoticeToast: (notice: string) => `${notice} - 実際の操作はできません`,
	demoNoticeToastText: 'デモでは実際の操作はできません',
	demoCurrentPlanTitle: '現在のプラン（デモ）',
	demoPlanUsageTitle: 'プラン利用状況',
	demoPlanUsageActivity: 'カスタム活動',
	demoPlanUsageChildren: `${CHILD_TERMS.honorific}`,
	demoPlanUsageRetention: 'データ保持',
	demoPlanUsageRetentionValue: (days: number | null) => (days === null ? '無制限' : `${days}日間`),
	demoPlanUsageMaxValue: (max: number | null) => (max === null ? '無制限' : String(max)),
	demoTrialNote: 'デモではトライアルは開始できません',
	// 注: demoLicenseKey* / demoApplySuccess* / demoNoticeDesc 等のライセンスキー適用デモ UI 文言は
	//     Epic #2525 Phase 7 PR-L4 (#2836) license key 全廃に伴い撤去済 (キー適用 UI 不存在)。
	// #1963: tier 分岐内 atom (PLAN_TERMS) を terms.ts から参照
	demoCheckoutButton: (tier: string) =>
		`${tier === 'family' ? PLAN_TERMS.premium : PLAN_TERMS.standard}プランで始める`,
	demoCheckoutNote: 'デモでは実際の決済は行われません',
	demoPlanManagementTitle: 'プラン管理',
	demoPaymentHistoryTitle: '支払い履歴',
} as const;

// ============================================================
// CHECKOUT_RECONCILIATION_LABELS — checkout 完了照合の結果表示 (#3958)
// ============================================================
//
// Stripe checkout の success_url (`/admin/subscription?session_id=cs_…`) から戻ったときに、
// サーバー側で照合した結果を顧客に伝える文言。webhook 未達時の救済経路であることは
// 顧客の関心事ではないため、内部事情 (webhook / session_id / Stripe API) を露出させない。

export const CHECKOUT_RECONCILIATION_LABELS = {
	/** 反映できた (webhook 未達の救済が成立したケースを含む) */
	applied: 'お支払いを確認しました。プランを反映しました。',
	/** 既に反映済み (webhook 先着 / 同じ URL の再訪) */
	alreadyApplied: 'お支払いは反映済みです。',
	/** Stripe 側でまだ支払いが確定していない */
	pending: 'お支払いの確認をしています。少し時間をおいて「最新の状態を確認」を押してください。',
	/** 照合できなかった (期限切れ / 不正な値 / 一時的な障害)。現在のプラン表示にフォールバック */
	unresolved:
		'お支払い状況を確認できませんでした。反映されない場合はサポートまでお問い合わせください。',
	/** 再確認ボタン */
	recheckButton: '最新の状態を確認',
	/** 再確認中 (進行中である旨の可視化、NN/G #1) */
	rechecking: '確認しています…',
} as const;

// ============================================================
// LICENSE_PAGE_LABELS — 旧名称 alias (共存期間、Phase 7 PR-2c #2699 で rename)
// ============================================================
//
// 旧 `LICENSE_PAGE_LABELS` (96 key) は本 PR で `SUBSCRIPTION_PAGE_LABELS` に rename + 統合済 (上記)。
// 既存参照を段階的に置換する共存期間中、本 alias export で後方互換性を維持する。
// Phase 7 後続 PR (PR-2d 以降) で全参照が `SUBSCRIPTION_PAGE_LABELS` に移行完了後、本 alias を削除する。
//
// 設計意図:
//   - Phase 5 SSOT §4.1: `LICENSE_PAGE_LABELS` → `SUBSCRIPTION_PAGE_LABELS` 統合 (105 key、新規 9 key + 旧 96 key)
//   - `/admin/license` → `/admin/subscription` URL rename (Phase 4 #2620 LEGACY_URL_MAP) と compound 命名整合
//   - V4 framing 軸 decoy (standard 「✓ お勧め」+ premium 最右配置) で 1 人っ子家庭の除外感回避
//     (Phase 1 補強 2 F9 / Phase 3 #2567 §FR-4)
//
// 関連 ADR:
//   - ADR-0058 (family → premium rename): Phase 7 PR-2e 以降で `PLAN_TERMS.premium` を `.premium` に rename
//   - ADR-0045 (terms.ts 2 階層): atom 直書き禁止、`${PLAN_FULL_TERMS.*}` template literal 経由
//   - ADR-0013 (LP truth): 実装事実と LP の整合、月額のみ (Phase 1 補強 2 FR-2)

export const LICENSE_PAGE_LABELS = SUBSCRIPTION_PAGE_LABELS;

// ============================================================
// NUC_LICENSE_LABELS — NUC セルフホスト版 license panel (EPIC #2327 / #2329)
// ============================================================
//
// NucLicensePanel.svelte 専用 compound。Edition badge + 利用状況 + サポート link の
// 3 セクション表示用ラベル SSOT。NUC_EDITION_TERMS atom (terms.ts) と組み合わせて
// 「セルフホスト版」「全機能利用可能」「無制限」を伝播させる (ADR-0045 準拠)。
//
// Mattermost Team Edition / Bitwarden self-hosted / GitLab CE 業界整合。
// LICENSE_PAGE_LABELS とは独立 SSOT (NUC は冗長セクション削除のため別名 namespace)。

export const NUC_LICENSE_LABELS = {
	// Edition badge セクション (Mattermost "Team Edition" 整合)
	editionTitle: `${NUC_EDITION_TERMS.editionEmoji} ${NUC_EDITION_TERMS.selfHosted}`,
	editionDesc: `ご家族の NUC でセルフホストされている、${NUC_EDITION_TERMS.fullAccess}版です。インターネット接続なしでもすべての機能をご利用いただけます。`,

	// 利用状況セクション
	usageTitle: 'ご家族の利用状況',
	usageChildrenLabel: `${CHILD_TERMS.honorific}`,
	usageChildrenUnit: (count: number) => `${count} 人`,
	usageActivitiesLabel: 'カスタム活動',
	usageActivitiesValue: (count: number) => `${count} 件 (${NUC_EDITION_TERMS.unlimited})`,
	usageRetentionLabel: 'データ保持',
	usageRetentionValue: NUC_EDITION_TERMS.unlimited,

	// サポート link セクション
	supportTitle: 'サポート',
	supportDesc: 'お困りの際は以下をご活用ください。',
	contactLabel: 'お問い合わせ',
	docsLabel: 'ドキュメント',
} as const;

// ANALYTICS_LABELS: 削除 (#2284 EPIC #2283)
// /admin/analytics 全面撤去 (PO 指摘 2026-05-19 4 構造問題: 内部用語 UI 露出 /
// SaaS マーケ専門用語 / on-demand 実行コスト / 運用者向け画面の親露出) を解消。
// 運用者向け機能は /ops/analytics に集約 (Activation Funnel は #2285 で移動済)。

export const BILLING_LABELS = {
	pageHeading: '請求書・支払い管理',

	// Subscription overview
	subscriptionOverviewTitle: 'サブスクリプション状況',
	statusLabel: 'ステータス',
	statusActive: '有効',
	statusGracePeriod: '猶予期間',
	statusSuspended: '停止中',
	statusTerminated: '解約済み',
	stripeConnectionLabel: 'Stripe 連携',
	stripeConnected: '✅ 連携済み',
	stripeNotConnected: '未連携',
	expiresLabel: '有効期限',

	// Billing portal section
	billingPortalTitle: '請求書・支払い方法',
	billingPortalDesc: `Stripe の${STRIPE_PORTAL_TERMS.short}で以下の操作ができます:`,
	featureInvoices: '過去の請求書の確認・ダウンロード',
	featurePaymentMethod: '支払い方法（クレジットカード）の変更',
	featurePlanSwitch: `${PLAN_FULL_TERMS.standard} / ${PLAN_FULL_TERMS.premium}の切り替え`,
	featureNextBilling: '次回請求日の確認',
	notReadyAlert: '決済機能は現在準備中です',
	openPortalError: `${STRIPE_PORTAL_TERMS.short}を開けませんでした`,
	openPortalLoading: '読み込み中...',
	openPortalButton: `${STRIPE_PORTAL_TERMS.short}を開く`,
	openPortalNote: `Stripe の安全な${STRIPE_PORTAL_TERMS.short}に移動します`,
	openPortalPinRequired: (label: string) => `⚠️ ${label}の入力が必要です`,
	openPortalPinRequiredPin: '親 PIN',
	openPortalPinRequiredPhrase: '確認フレーズ',
	noCustomerAlert: 'サブスクリプションが未開始のため、請求情報はまだありません。',
	noCustomerAlertSelectPlan: 'プランを選択',
	noCustomerAlertSuffix: 'すると利用可能になります。',
	noSubscriptionAlert: 'Stripe Customer Portal を利用するには、サブスクリプションが必要です。',

	// Nav link
	navLinkTitle: 'プラン管理',
	navLinkHint: 'プランの選択・変更・トライアル開始',

	// 解約フローへの導線 (#1596)
	cancelLinkTitle: '解約手続き',
	cancelLinkHint: '解約理由をお聞かせください（必須）',

	// Dialog
	dialogTitle: `${STRIPE_PORTAL_TERMS.short}を開く`,
	dialogDesc: `Stripeの${STRIPE_PORTAL_TERMS.short}に移動します。この画面から支払い方法の変更・プラン切り替えが可能です。`,
	dialogPinRequired: (label: string) => `⚠️ 誤操作を防ぐため、${label}を入力してください。`,
	dialogPinOrPhrase: '確認フレーズ',
	dialogConfirmPhraseLabel: (phrase: string) => `確認のため「${phrase}」と入力してください`,
	dialogCancelButton: 'キャンセル',
	dialogConfirmLoading: '確認中…',
	dialogConfirmButton: `${STRIPE_PORTAL_TERMS.short}へ`,
} as const;

// ============================================================
// ARCHIVED_RESOURCE_LABELS — 無料プランの上限で archive 中のリソースの告知 / 一覧 (#4708)
// ============================================================
//
// トライアル終了 / 解約 / 支払い失敗で無料プランに戻ったとき、上限を超えるお子さま / 活動 /
// チェックリストは archive (一時非表示) される。FAQ / pricing は「削除されず、管理画面で確認でき、
// 有料プランで元に戻る」と約束しているので、その 3 点を画面で成立させる文言。
//   - banner: admin 全画面の本文上部 (TrialBanner と同階層、flow、CTA 以外はタップ不可)
//   - listing: /admin/children の archive 一覧 (読み取り専用、復元操作は置かない)
// ADR-0012: 「失う / 消える」を使わず、事実 (非表示) + 復元可能性のみ。煽り CTA は置かない。
export const ARCHIVED_RESOURCE_LABELS = {
	// banner
	bannerTitle: (breakdown: string) => `${breakdown}が非表示になっています`,
	bannerDesc: `${PLAN_FULL_TERMS.free}の上限を超えた分を一時的に${PLAN_CHANGE_TERMS.archive}しています。データは削除されません。有料プランにすると自動で元に戻ります。`,
	/** 件数の内訳。0 件の資源は省略 (例: 活動のみなら「活動 5 件」) */
	breakdown: (c: { children: number; activities: number; checklists: number }) =>
		[
			c.children > 0 ? `${CHILD_TERMS.honorific} ${c.children}人` : null,
			c.activities > 0 ? `活動 ${c.activities}件` : null,
			c.checklists > 0 ? `チェックリスト ${c.checklists}件` : null,
		]
			.filter((x): x is string => x !== null)
			.join(' / '),
	bannerCta: ACTION_LABELS.viewPlans,
	bannerListLink: `非表示の${CHILD_TERMS.honorific}を見る`,
	// /admin/children の archive 一覧 (読み取り専用)
	childrenSectionTitle: `非表示になっている${CHILD_TERMS.honorific}`,
	/** 一覧見出し + 件数 (「非表示になっているお子さま（2）」) */
	childrenSectionTitleWithCount: (count: number) =>
		`非表示になっている${CHILD_TERMS.honorific}（${count}）`,
	childrenSectionDesc: `${PLAN_FULL_TERMS.free}の上限を超えたため一時的に非表示になっています。記録・編集はできませんが、データは残っています。有料プランにすると自動で表示に戻ります。`,
	childrenSectionReadOnlyTag: '非表示中',
	childrenSectionCta: ACTION_LABELS.viewPlans,
} as const;

// ============================================================
// PHASE4_REACTIVATION_FLOW_LABELS — reactivation banner 動線文言 (Phase 4 #2623 / Phase 7 PR-2b)
// ============================================================
//
// Phase 4 #2623 §文言 atom + Phase 5 子 5 #2656 §4.4 SSOT 配置確定。
// archived → reactivation 動線で全 admin 画面で banner 常時表示 (Phase 4 #2623 §2 原則 1)、
// `?from=reactivation-banner` / `?from=reactivation-listing` クエリ重畳で context-passing。
//
// 設計意図:
//   - Phase 3 #2575 archived listing UI と表裏 (アーカイブ → 復活 動線の SSOT 文言)
//   - 補強 PR #2684 (代替案 D) の影響なし: 本 compound は archived データの再 reactivation 文言で、
//     ダウン即時 / credit memo とは独立 (archived は 90 日 retention 経由の物理削除前救済動線)
//
// 関連 ADR:
//   - ADR-0049 (retention 90 日): free plan archived データの 90 日保持 → 物理削除前の救済動線
//   - ADR-0045 (terms.ts 2 階層): `${PLAN_CHANGE_TERMS.restore}` 経由参照
//   - ADR-0012 (Anti-engagement): 「失う / 消える / 使えなくなる」atom 含めず、「復活させる」事実説明

export const PHASE4_REACTIVATION_FLOW_LABELS = {
	// banner dismiss 関連 (session storage で次タブ open まで非表示、ADR-0012 連続演出回避)
	bannerDismissAriaLabel: 'バナーを閉じる',
	bannerDismissHint: '次回タブを開くまで表示されません',
	// subscription page 上部 context line (?from=reactivation-banner 時)
	contextFromBanner: (total: number) =>
		`${total}件のデータを${PLAN_CHANGE_TERMS.restore}させるために、プランをご検討ください`,
	// subscription page 上部 context line (?from=reactivation-listing 時、archived listing 経由)
	contextFromListing: (total: number) =>
		`${total}件のデータを${PLAN_CHANGE_TERMS.restore}させて、お子さまの記録を引き継ぎませんか`,
	// /confirm 画面 (Phase 3 #2573) 上部 context line
	confirmContext: (total: number) =>
		`お申し込み後、${total}件のアーカイブデータが自動的に${PLAN_CHANGE_TERMS.restore}します`,
	// reactivation 完了 toast (Phase 3 #2572 success polling 経路、Toast.svelte primitive 流用、3s 自動消失)
	toastReactivationSuccess: (total: number) =>
		`${total}件のデータを${PLAN_CHANGE_TERMS.restore}しました`,
} as const;

// ============================================================
// CANCELLATION_LABELS - 解約フロー (#1596 / ADR-0023 §3.8 / I3)
// 全プラン強制の解約理由ヒアリング (3 分類 + 自由記述)
// Anti-engagement 原則 (ADR-0012): 「離脱トリガー」にしない設計（煽り無し・引き止め無し）
// ============================================================

/** 解約理由カテゴリ ID (DB 保存値) */
export const CANCELLATION_CATEGORY = {
	GRADUATION: 'graduation', // 卒業: 子供が自律した
	CHURN: 'churn', // 離反: 不満があった
	PAUSE: 'pause', // 中断: 家庭事情等で一時停止
} as const;

export type CancellationCategory =
	(typeof CANCELLATION_CATEGORY)[keyof typeof CANCELLATION_CATEGORY];

export const CANCELLATION_CATEGORIES: ReadonlyArray<CancellationCategory> = [
	CANCELLATION_CATEGORY.GRADUATION,
	CANCELLATION_CATEGORY.CHURN,
	CANCELLATION_CATEGORY.PAUSE,
];

/** #4585-1: 「選ばずに進めた場合」の見出し。同一画面の複数箇所から参照するため 1 箇所に置く */
const ARCHIVE_FALLBACK_HEADING = '選ばずに進めた場合';

export const CANCELLATION_LABELS = {
	pageHeading: '解約手続き',
	pageDesc: '解約の前に、ぜひ理由をお聞かせください。今後の改善に活用させていただきます（必須）。',

	// Form fields
	reasonSectionTitle: '解約理由',
	reasonRequired: '必須',
	freeTextLabel: 'ご意見・ご要望（任意）',
	freeTextPlaceholder:
		'差し支えなければ、もう少し詳しく教えていただけると嬉しいです（最大 1000 文字）',
	freeTextMaxLength: 1000,
	freeTextHint: (current: number, max: number) => `${current} / ${max} 文字`,

	// 3 categories - radio button options
	categoryGraduationLabel: '卒業',
	categoryGraduationHint: `${CHILD_TERMS.honorific}が自分で計画できるようになった・がんばりクエストを使う必要がなくなった`,
	categoryChurnLabel: '離反',
	categoryChurnHint: '機能が合わない・期待と違った',
	categoryPauseLabel: '中断',
	categoryPauseHint: '家庭事情・引っ越し・一時的に離れる（再開予定あり）',

	// Plan-context messaging (free / standard / family 共通)
	// #1959: 無料プラン → PLAN_FULL_TERMS.free 参照化 (atom 直書き撤廃)
	// #4496: 旧 freePlanNotice は「解約後はアカウント自体を削除する必要があります」と、事実でない
	//   義務を提示して退会 (無料プランは猶予なし = 即時物理削除) へ誤誘導していた。
	//   旧 paidPlanNotice は「決済停止を行います」だけで、期末まで使えることと日割り返金が
	//   ないことを手続き前に示していなかった (#3991 期末解約モデルの不告知)。
	freePlanNotice: `${PLAN_FULL_TERMS.free}をご利用中のため、お支払いは発生しておらず${CANCEL_TERMS.canonical}のお手続きは必要ありません。データを消したい場合はアカウント${CANCEL_TERMS.account}（設定 > アカウント削除）が別途必要です。差し支えなければ、その前に理由をお聞かせください。`,
	// #4585-1 QM: 体験中の顧客は「請求は無い」が「無料プランの上限でもない」。freePlanNotice を
	// そのまま出すと、同じ画面で「無料プランをご利用中」と「無料プランに戻ると」が並び、
	// 前者が事実でないまま矛盾する (実測: 体験中アカウントの解約画面)。
	//   #4540 Q4: 体験中の顧客も手続き後は無料プランに戻るため、保持期間の告知対象に含める。
	trialPlanNotice: `お支払いは発生していないため、請求を止めるお手続きは必要ありません。ただし、いまは有料プランと同じ上限でご利用いただいているため、${PLAN_FULL_TERMS.free}に戻ると上限を超える分の扱いが決まります。${FREE_PLAN_RETENTION_NOTICE}データを消したい場合はアカウント${CANCEL_TERMS.account}（設定 > アカウント削除）が別途必要です。`,
	// #4709: 「記録の書き出しは請求期間の終了日まで」を解約を決める画面でも述べる。
	//   `/api/v1/export` は canExport gate で無料プランを 403 にするため、期間終了後は
	//   退会画面の最小エクスポート (#4472) しか持ち出し手段が残らない。
	//   #4540 Q4: 「お子さまの記録は残ります」だけで終えると、無料プランの保持期間を超えた記録が
	//   物理削除される事実が解約を決める瞬間に見えない (顧客に有利に見える方向の不正確さ)。
	//   保持期間は FREE_PLAN_RETENTION_NOTICE (= 特商法と同一文) を共有し、日数は直書きしない。
	//   保持期間の告知 (残る記録がいつまで残るか) と持ち出し期限 (いつまで書き出せるか) は
	//   別の論点なので併記する。
	paidPlanNotice: `${CANCEL_TERMS.canonical}のお手続きを進めても、現在の請求期間の終了日までは有料プランをそのままご利用いただけます（日割り計算による返金はありません）。期間の終了後は${PLAN_FULL_TERMS.free}へ切り替わり、お子さまの記録は残ります。${FREE_PLAN_RETENTION_NOTICE}次回以降の請求は発生しません。記録の書き出し（エクスポート）は請求期間の終了日までのご利用となり、${PLAN_FULL_TERMS.free}へ切り替わったあとは、${CANCEL_TERMS.account}のお手続きの画面から${DELETION_EXPORT_TERMS.freeScopeSummary}のみ保存できます。`,

	// Submit
	submitButton: '解約手続きへ進む',
	submitLoading: '送信中…',
	submitButtonNoStripe: '解約理由を送信する',
	cancelButton: '前のページに戻る',

	// Errors
	errorCategoryRequired: '解約理由を選択してください',
	errorFreeTextTooLong: 'ご意見は 1000 文字以内で入力してください',
	errorSubmitFailed: '送信に失敗しました。時間をおいて再度お試しください',

	// Success
	successHeading: 'ご回答ありがとうございました',
	// #4329: 旧 successDesc は無料プランの顧客にも「Stripe で解約手続きを完了してください」と
	// 表示していた (無料プランに Stripe 契約は無い)。回答の受領だけを述べ、以降の手続きの
	// 説明は「手続きが残っている場合」の枠 (portalUnavailable*) に寄せる。
	successDesc: 'いただいたご意見は、サービス改善に活用させていただきます。',
	successFreeProceed: 'アカウント削除はこちら',

	// #4329 ①: portal を作れなかったときの回復導線。
	// 旧実装は「Stripe ${STRIPE_PORTAL_TERMS.short}で解約を完了する」と名乗るボタンが
	// 自アプリのプラン画面へ戻すだけで、顧客は解約したつもりのまま課金が続いていた
	// (特商法の解約導線の実効性)。失敗した事実・残っている手続き・代替手段を出す。
	// 原因の内部詳細 (Stripe API エラー等) は顧客に出さない (ADR-0062)。
	portalUnavailableHeading: `${CANCEL_TERMS.canonical}のお手続きが残っています`,
	portalUnavailableDesc: `ご回答は受け付けましたが、${STRIPE_PORTAL_TERMS.canonical}を開けませんでした。${CANCEL_TERMS.canonical}はまだ完了していません。`,
	portalRetryButton: `${STRIPE_PORTAL_TERMS.short}を開いて${CANCEL_TERMS.canonicalVerb}`,
	portalRetryFailed: `${STRIPE_PORTAL_TERMS.short}を開けませんでした。時間をおいて再度お試しいただくか、下記のサポート窓口までご連絡ください`,
	portalSupportHint: `うまくいかない場合は、サポート窓口からご連絡ください。こちらで${CANCEL_TERMS.canonical}のお手続きを承ります。`,
	portalSupportLink: 'サポート窓口に連絡する',

	// #4525: 有料プランだが Stripe 契約が紐づいていない異常状態。この画面から
	//   ${STRIPE_PORTAL_TERMS.canonical} を開けないため、フォームを送っても解約は完了しない。
	//   「お手続きは必要ありません」(freePlanNotice) を出すと課金が続いたまま放置される。
	//   再試行しても直らない状態なので、最初からサポート窓口へ案内する (#4548 と同じ判断)。
	paidWithoutStripeNotice: `ご契約の状態を確認できませんでした。この画面からは${CANCEL_TERMS.canonical}のお手続きを完了できません。お手数ですが、「設定 > サポート」からご連絡ください。こちらで${CANCEL_TERMS.canonical}のお手続きを承ります。`,

	// #4585-1: 解約フローも「どの記録を残すか」の選択 UI に合流させる (PO 決裁 = 案 A)。
	// #4585-3: fallback 規則を子供だけ「直近の利用順」に変更 (PO 決裁 Q1 / Q3)。
	// 顧客に伝えるのは「お子さまは最近記録がある方を残す」ところまで。活動・チェックリストの
	// 並び順 (登録順) までは書かない — 復元でき、かつ選択 UI で顧客自身が選べるため。
	archiveFallbackHeading: ARCHIVE_FALLBACK_HEADING,
	archiveFallbackRule: (maxChildren: number, maxActivities: number, maxChecklists: number) =>
		`${PLAN_FULL_TERMS.free}に戻ると、${CHILD_TERMS.neutral}は${maxChildren}人・活動は${maxActivities}個・チェックリストは${CHILD_TERMS.neutral}1人あたり${maxChecklists}個までになります。残すものを選ばないまま手続きが完了した場合は、この数だけ残して超えた分をアーカイブします。${CHILD_TERMS.honorific}は、最近記録がある${CHILD_TERMS.honorific}から順に残します。`,
	// #4585-4: 契約終了の告知 (`SUBSCRIPTION_PAGE_LABELS.cancelledDesc`) と同一文を共有する。
	// 解約画面を通る顧客と通らない顧客 (支払い失敗) で「戻せるかどうか」の説明を分けない。
	archiveFallbackRestore: ARCHIVE_RESTORE_ASSURANCE,
	selectionButton: '残すデータを選ぶ',
	selectionLoading: '確認しています…',
	selectionUnavailable: `残すデータの選択画面を開けませんでした。このまま${CANCEL_TERMS.canonical}のお手続きを続けると、「${ARCHIVE_FALLBACK_HEADING}」の扱いになります。もう一度お試しになる場合は下のボタンから、このまま進める場合は送信ボタンを押してください。`,
	// #4585-1 QM: 選択ダイアログを閉じた顧客の出口。確定ボタンは超過分を選ぶまで押せないため、
	// 「どれも手放したくない」顧客の唯一の操作が「閉じる」になる。ここで手続きを再開できないと
	// 解約そのものが行き止まりになる (#4329 / #4548 / #4560 と同じ class)。
	selectionSkipped: `残すデータを選ばずに閉じました。このまま${CANCEL_TERMS.canonical}のお手続きを続けると、「${ARCHIVE_FALLBACK_HEADING}」の扱いになります。選び直すこともできます。`,
	// #4585-1 QM: 閉じた / 取得に失敗した顧客が選択に戻る唯一の導線。これが無いと、
	// 誤って閉じた 1 クリックで「自分で選ぶ」機会を恒久的に失う (子供の記録は取り返しが難しい)。
	selectionReopen: '残すデータを選び直す',
} as const satisfies Record<string, unknown>;

/** 表示用ラベル取得 */
export function getCancellationCategoryLabel(category: CancellationCategory): string {
	switch (category) {
		case CANCELLATION_CATEGORY.GRADUATION:
			return CANCELLATION_LABELS.categoryGraduationLabel;
		case CANCELLATION_CATEGORY.CHURN:
			return CANCELLATION_LABELS.categoryChurnLabel;
		case CANCELLATION_CATEGORY.PAUSE:
			return CANCELLATION_LABELS.categoryPauseLabel;
	}
}

// ============================================================
// GRADUATION_LABELS - 卒業フロー (#1603 / ADR-0023 §3.8 / §5 I10)
// 解約フローで「卒業」を選んだ親向けの専用ページ。
// Anti-engagement 原則 (ADR-0012): ポジティブだが煽らない。引き止め CTA 禁止。
//
// #1961 (Phase 7 H4) atom 直書き監査:
//   - 卒業フローは「卒業」「ご利用期間」「事例公開」「ニックネーム」等の独自用語のみで構成され、
//     プラン名 (PLAN_TERMS / PLAN_FULL_TERMS) / 価格 (PRICE_TERMS) / トライアル日数 (TRIAL_TERMS) /
//     解約期間 (CANCEL_TERMS) / 無料訴求 (FREE_TERMS) の atom には依存しない。
//   - yenAmount / days / current / max は全て引数注入で計算ロジック側の責務。
//   - 検証: 範囲内に '無料' / 'スタンダード' / 'ファミリー' / '7日間' / '7 日間' / '¥\d+' /
//     '無料プラン' / 'スタンダードプラン' / 'ファミリープラン' リテラル 0 件。
// ============================================================

export const GRADUATION_LABELS = {
	pageHeading: '卒業おめでとうございます',
	pageDesc:
		'お子さまの自律をともに見守れたこと、心より嬉しく思います。残ポイントの活用例と、もしよければ事例として共有していただけるかをお伺いします。',

	// 残ポイントセクション
	pointsSectionTitle: '残ポイント',
	pointsSectionHint: '卒業時点での合計ポイントです',
	pointsUnit: 'pt',
	pointsZero: 'ポイント残高はありません',

	// 還元提案セクション
	rewardSuggestionTitle: 'お子さまへのポイント還元アイデア',
	rewardSuggestionHint: `${CHILD_TERMS.honorific}ががんばって貯めたポイントを、ご家庭で意味のある形に変えていただくための参考例です。`,
	rewardCashLabel: '現金換算の目安',
	rewardCashDesc: (yenAmount: number) =>
		`100 pt = 100 円換算 (目安) で、約 ${yenAmount.toLocaleString('ja-JP')} 円相当`,
	rewardItemsLabel: '物品の例',
	rewardItemsDesc: 'お小遣い帳・図書カード・本人の欲しがっていたグッズ・文房具 など',
	rewardExperienceLabel: '体験の例',
	rewardExperienceDesc: '家族での外食・遊園地・映画・お子さま主役の小旅行 など',
	rewardNoteLabel: '注意',
	rewardNote:
		'金額換算はあくまで参考です。ご家庭の方針に合わせて、お子さまが「がんばってよかった」と感じられる形で還元してあげてください。',

	// 利用期間表示
	usagePeriodLabel: 'ご利用期間',
	usagePeriodDays: (days: number) => `${days} 日間 ご利用いただきました`,

	// 事例公開承諾セクション
	consentSectionTitle: '事例として共有していただけますか？（任意）',
	consentSectionHint:
		'公開させていただく場合は、お子さまの実名は使いません。下記のニックネームで掲載させていただきます。',
	consentCheckboxLabel: '卒業事例として、当サービスで紹介させていただいてもよい',
	nicknameLabel: '公開時のニックネーム',
	nicknameRequired: '必須',
	nicknamePlaceholder: '例: たろうくん家',
	nicknameHint: '実名禁止。お子さまや家族が特定されない範囲でご記入ください（最大 30 文字）',
	nicknameMaxLength: 30,
	messageLabel: '卒業のひとことメッセージ（任意・公開可）',
	messagePlaceholder:
		'もしよろしければ、卒業のお気持ちをひとことお寄せください（公開時に他のご家庭の参考になります、最大 500 文字）',
	messageMaxLength: 500,
	messageHint: (current: number, max: number) => `${current} / ${max} 文字`,

	// Submit
	submitButton: '卒業を完了する',
	submitConsentButton: '事例として共有して卒業を完了する',
	submitLoading: '送信中…',
	skipButton: '事例共有はせず卒業のみ完了する',

	// Errors
	errorNicknameRequired: '公開時のニックネームをご入力ください',
	errorNicknameTooLong: 'ニックネームは 30 文字以内でご入力ください',
	errorMessageTooLong: 'メッセージは 500 文字以内でご入力ください',
	errorSubmitFailed: '送信に失敗しました。時間をおいて再度お試しください',

	// Success (after consent recorded)
	successHeading: '卒業を見届けました',
	successDesc:
		'長い間ありがとうございました。お子さまのこれからの自律した日々が、ますます充実することを願っています。',
	successConsentThanks:
		'事例公開のご快諾ありがとうございました。サービス改善・他のご家庭への参考に活用させていただきます。',
	// #4498: 課金プランの卒業送信ボタン。押した先は Stripe の解約フローであり、
	// 「卒業を完了する」系の名乗りだと解約が終わったと誤認される。
	successProceedButton: '解約手続きへ進む',
	successProceedFreeButton: `${ADMIN_VIEW_TERMS.canonical}に戻る`,
} as const satisfies Record<string, unknown>;

// ============================================================
// 料金プランページ (#1452 Phase B)
// ============================================================

export const PRICING_PAGE_LABELS = {
	heading: '料金プラン',
	// #1960 Phase 7 H3: terms.ts atom 参照化 (FREE_TERMS / PLAN_TERMS / TRIAL_TERMS / PLAN_FULL_TERMS)
	subtitle1: `${FREE_TERMS.base}ではじめられます。${PLAN_TERMS.standard}・${PLAN_TERMS.premium}プランはすべて`,
	subtitleTrialDays: `${TRIAL_TERMS.duration}の無料体験`,
	subtitle2: '付き',
	// #1912 (F-6): LP 訴求文の「ログインボーナス」「連続達成ボーナス」がギャンブル系語彙のため
	//   日本語の素朴な表現に置換（IT リテラシーなし親 P1 の認知ジャンプ防止）。
	//   内部実装識別子 (login-bonus-service / loyalty-service) は識別子として scope 外。
	featureNote:
		'お子さまが楽しめる冒険の仕組み（レベル・おみくじ・スタンプカード・毎日のごほうび・続けるごほうびなど）は',
	featureNoteStrong: '全プラン共通',
	featureNoteSuffix: 'で制限なし',
	// #1896 PO-4-10: 旧 'faqTitle: よくある質問' は LP_FAQ_TERMS.faqHtmlTitle 経由に統一
	//   ('よくあるご質問' に長形式化)。key 名も compound 役割を明示する 'faqHeading' に rename
	//   し atom と key 名の混同を防ぐ（src/routes/pricing/+page.svelte 参照を同期更新）。
	faqHeading: `${LP_FAQ_TERMS.faqHtmlTitle}`,
	faqFreePlanQ: `${PLAN_FULL_TERMS.free}でも十分使えますか？`,
	faqFreePlanA:
		'はい。プリセットの活動とチェックリストで基本的な機能はお使いいただけます。お子さまの冒険体験は無料でも一切制限ありません。',
	faqCancelTrialQ: `無料体験中に${CANCEL_TERMS.canonical}できますか？`,
	// #4496: 旧文言「無料体験期間中に解約すれば一切課金されません」は「解約しなければ課金される」
	//   という誤含意を持っていた。トライアルは自動課金なしが仕様 (FR-5 / NFR-1) なので、
	//   「何もしなくても課金されない」ことを先に述べる。
	faqCancelTrialA: `はい。無料体験は自動で課金される仕組みではありません。体験期間が終わると自動的に${PLAN_FULL_TERMS.free}へ切り替わり、料金は発生しません（体験中に${CANCEL_TERMS.canonicalVerb}手続きをしなくても課金されません）。`,
	faqCancelQ: '解約したらデータはすぐに削除されますか？',
	// #4496: 旧文言は**退会 (アカウント削除) の猶予期間**を解約の説明に転用しており、
	//   「解約するとデータが削除される」という事実と異なる記述になっていた。
	//   実装事実 (#3991 期末解約モデル / cancel_at_period_end=true):
	//     - 解約はデータを削除しない。期末まで有料プランを使え、その後無料プランへ自動移行する
	//     - 無料プランの保持期間 (PLAN_HISTORY_RETENTION_DAYS.free) を超えた記録は
	//       retention-cleanup-service が**物理削除**する (閲覧不可ではなく復元不能)
	//     - データそのものの削除は退会の手続きで、猶予は DELETION_GRACE_PERIOD_DAYS
	//   アプリ内 /pricing と LP /site/pricing.html / faq.html / index.html / 特商法で同一の
	//   事実を述べる (数値は terms.ts atom 経由で値 SSOT から引く)。
	faqCancelA: `いいえ。${CANCEL_TERMS.canonical}してもデータは削除されません。現在の請求期間の終了日までは有料プランをそのままご利用いただけ、その後は${PLAN_FULL_TERMS.free}へ自動的に切り替わります（お子さまの記録は残ります）。${PLAN_FULL_TERMS.free}の履歴保持期間は ${PLAN_RETENTION_TERMS.freeSpaced}です。${PLAN_RETENTION_TERMS.freeSpaced}を超えた記録は削除され、復元できません（再契約でも戻りません）。必要な記録は、有料プランのご利用期間中に書き出してください。記録の書き出し（エクスポート）は${PLAN_FULL_TERMS.standard}以上の機能です。${PLAN_FULL_TERMS.free}では、${CANCEL_TERMS.account}のお手続きの画面から${DELETION_EXPORT_TERMS.freeScopeSummary}のみ保存できます。データそのものを消すのはアカウント${CANCEL_TERMS.account}のお手続きで、プラン別の猶予期間（${PLAN_FULL_TERMS.free}: ${DELETION_GRACE_TERMS.free} / ${PLAN_FULL_TERMS.standard}: ${DELETION_GRACE_TERMS.standardSpaced}間 / ${PLAN_FULL_TERMS.premium}: ${DELETION_GRACE_TERMS.premiumSpaced}間）の経過後にすべてのデータが完全に削除されます。`,
	faqBillingDateQ: '課金日はいつですか？',
	// #4502: 年額は #2719 で廃止済み。LP 側は #3212 で是正済みで、ここだけ残っていた
	faqBillingDateA: 'お申し込み日を起算日として毎月自動更新されます。',
	faqPaymentQ: '支払い方法は？',
	faqPaymentA:
		'クレジットカード（Stripe が対応する主要ブランド）に対応しています。Stripeによる安全な決済処理を使用しています。',
	faqPlanChangeQ: 'プランの変更はできますか？',
	faqPlanChangeA: `はい。${PLAN_TERMS.standard}↔${PLAN_TERMS.premium}の切り替えがいつでも可能です。${ADMIN_VIEW_TERMS.canonical}の「プラン・お支払い」から変更できます。`,
	faqSelfHostQ: 'セルフホスト版はありますか？',
	faqSelfHostA:
		'はい。全機能を無料でお使いいただけるオープンソース版があります。DockerとNode.jsの基本的な知識が必要です。',
} as const;

/**
 * DowngradeResourceSelector ダイアログ用ラベル (#1465 Phase D)
 */
export const DOWNGRADE_RESOURCE_SELECTOR_LABELS = {
	dialogTitle: 'ダウングレードの確認',
	targetTierSuffix: 'へのダウングレード',
	retentionUnlimited: '無制限',
	/**
	 * 保持期間短縮の警告文 (#4482)。
	 *
	 * 以前は接頭辞 / 接尾辞の断片を svelte 側で `${days}日` と繋いで組み立てていたため、
	 * 保持日数を 365 の倍数に変えるとここだけ「365日」と述べ、料金表の「1年」と食い違った。
	 * 文の組み立てごと本 compound に集約し、日数の整形は formatRetentionPeriod に委ねる。
	 *
	 * `PlanLimits.historyRetentionDays` は `number | null` なので両引数とも null を受ける
	 * (null の整形は formatRetentionPeriod が「無期限」として担う)。
	 *
	 * #4528: 後段は「閲覧できなくなります」と述べていたが、実装
	 * (`server/services/retention-cleanup-service.ts`) は `recorded_date < cutoffDate` の
	 * 活動ログ・ポイント台帳・ステータス履歴を**行ごと削除する**。復元手段は無く、
	 * 上位プランに戻しても戻らない。ダウングレード確認画面は顧客が不可逆な結果を
	 * 自分の操作で確定させる直前の地点なので、婉曲化すると「あとで戻せば見られる」と
	 * 誤解したままデータを失う。#4496 (LP・特商法) / #4507 (メール) で確定した強さ
	 * 「削除され、復元できません（再契約でも戻りません）」と同一表現で述べ切る。
	 *
	 * @param currentDays 現プランの保持日数 (null = 無制限)
	 * @param targetDays  ダウングレード先の保持日数 (null = 無期限)
	 */
	retentionWarning: (currentDays: number | null, targetDays: number | null) => {
		const current = currentDays === null ? '無制限' : formatRetentionPeriod(currentDays);
		const target = formatRetentionPeriod(targetDays);
		return `データ保持期間が${current}から${target}に短縮されます。${target}を超えた記録は削除され、復元できません（再契約でも戻りません）。`;
	},
	excessTitlePrefix: '現在のリソースが',
	excessTitleSuffix: 'の上限を超えています',
	excessGuide:
		'ダウングレード先の上限に合わせて、アーカイブするリソースを選択してください。アーカイブされたデータはアップグレード時に復元できます。',
	childrenSectionTitle: (current: number, max: number | null) =>
		`子供（${current}人 → 上限 ${max ?? '無制限'}人）`,
	childrenSectionGuide: (excess: number, archived: number) =>
		`${excess}人分をアーカイブしてください（選択: ${archived}/${excess}）`,
	archiveLabel: 'アーカイブ',
	keepLabel: '残す',
	childRemainingHint: (remaining: number) => `あと${remaining}人分を選択してください`,
	activitiesSectionTitle: (current: number, max: number | null) =>
		`活動（${current}個 → 上限 ${max ?? '無制限'}個）`,
	activitiesSectionGuide: (excess: number, archived: number) =>
		`${excess}個分をアーカイブしてください（選択: ${archived}/${excess}）`,
	activityRemainingHint: (remaining: number) => `あと${remaining}個分を選択してください`,
	checklistsSectionTitle: (max: number | null) =>
		`チェックリストテンプレート（1子あたり上限 ${max ?? '無制限'}個）`,
	checklistsChildGuide: (childName: string, excess: number, archived: number) =>
		`${childName}: ${excess}個分をアーカイブ（選択: ${archived}/${excess}）`,
	restoreNote:
		'アーカイブされたデータは削除されません。再度アップグレードすることで完全に復元できます。',
	cancelButton: 'キャンセル',
	archivingLabel: 'アーカイブ中…',
	archiveAndProceedButton: 'アーカイブしてプラン変更へ進む',
	processingLabel: '処理中…',
	proceedButton: 'プラン変更へ進む',
	loadingLabel: '読み込み中...',
} as const;

// ============================================================
// CHECKOUT_LABELS — Stripe Checkout custom_text SSOT (#2346 / EPIC #2345)
// ============================================================
//
// 景品表示法対応の critical 修正:
//   - 旧: 'お支払い後、すぐにすべての機能をご利用いただけます。' (stripe-service.ts 直書き)
//   - 旧: 'アプリに戻ってすべての機能をお楽しみください。'        (stripe-service.ts 直書き)
//   - 新: 'お支払い後、すぐにお選びのプランの機能をご利用いただけます。'
//   - 新: 'アプリに戻ってお選びのプランの機能をお楽しみください。'
//
// 法的根拠:
//   - 景品表示法 5 条 1 号 (優良誤認表示) — 「すべての機能」表示はスタンダードプラン購入時に
//     ファミリープラン機能まで含むと誤認させる可能性 (課徴金 売上 × 3% リスク)
//   - 特商法 2022-06 改正 最終確認画面ガイドライン — Stripe Checkout 最終確認画面の
//     誤認表示は消費者契約取消可能性 (消費者契約法 4 条 1 項)
//   - 消費者庁「動画見放題プラン」措置命令事例 — 本ケースと相同類型
//
// 設計指針:
//   - submitMessage         : Stripe Checkout の `custom_text.submit.message` 用
//                              (購入確定ボタン直前の説明文)
//   - afterSubmitMessage    : Stripe Checkout の `custom_text.after_submit.message` 用
//                              (購入確定直後の thank-you 画面文)
//   - submitMessageWithPlan : future-proof: プラン名動的差し込み版 (固定文言版は本 PR で採用、
//                              関数版は将来 plan tier が確定した文脈で使用予定)
//   - afterSubmitMessageWithPlan : 同上 (after_submit 版)
//
// `${CHECKOUT_TERMS.chosenPlanFeature}` 経由参照によりリテラル「お選びのプランの機能」を
// terms.ts SSOT (atom) から 1 行修正で全 compound に伝播可能 (ADR-0045)。
//
// 参照: docs/decisions/0002-critical-fix-quality-gate.md (本 atom 適用の critical 5 要件履歴)

// 申込確定直前に述べる「引渡時期・自動更新」(特商法 12 条の 6 第 1 項 4 号相当)。
// 提供開始時期は tokushoho.html の「サービス提供時期」行 (お申し込み後、即時ご利用いただけます)、
// 自動更新は同「支払時期」行 (以後は毎月同じ日に自動課金します) と同じ事実を述べる。
// 「お選びのプランの機能」は景品表示法 5 条 1 号対応の限定文言 (#2346) をそのまま維持する。
//
// **金額が初回と更新で一致するとは述べない**: 同じ session に `allow_promotion_codes: true`
// (`stripe-service.ts`) があり、`duration: once` のプロモーションコードが使われると初回と
// 次回以降で請求額が変わる。「同額」等の断定は特商法 12 条の 6 の金額表示にあたる部分を
// 事実と食い違わせるため書かない (tokushoho.html「支払時期」行にも同種の断定は無い)。
// 代わりに「そのつど課金される」ことと「次回以降の金額をどこで確認できるか」を述べる。
const CHECKOUT_DELIVERY_AND_RENEWAL_NOTICE = `お支払い後、すぐに${CHECKOUT_TERMS.chosenPlanFeature}をご利用いただけます。以後は毎月同じ日に自動で更新し、そのつど課金します。次回以降のご請求金額は${STRIPE_PORTAL_TERMS.short}でご確認いただけます。`;

// 申込確定直前に述べる「申込撤回・解約方法」(同項 5 号相当)。
// 経路は tokushoho.html の「返品・キャンセル」行と同一の 1 本に揃える
// (見守り画面 →「プラン・お支払い」→「請求管理ページを開く」)。別経路を新たに名乗らない。
const CHECKOUT_CANCEL_METHOD_NOTICE = `${ADMIN_VIEW_TERMS.canonical}の「${ADMIN_SCREEN_TERMS.subscription}」→「${STRIPE_PORTAL_TERMS.short}を開く」からいつでも${CANCEL_TERMS.canonical}できます。${CANCEL_TERMS.canonical}後は現在の請求期間の終了日までご利用いただけ、日割り計算による返金は行いません。デジタルサービスのため返品はお受けしておりません。`;

export const CHECKOUT_LABELS = {
	// #2573 (2026-09-04 QM 監査 legal.md [S1]): 申込確定の直前で事業者が文言を出せる枠は
	// `custom_text.submit.message` ただ 1 つ。ここを販促文 (旧:「お支払い後、すぐに…
	// ご利用いただけます。」だけ) に使うと、顧客は **毎月自動更新であること / 解約の方法 /
	// いつから使えるか** を知らないまま確定ボタンを押す。Stripe Checkout の既定表示は金額と
	// 請求周期しか出さないため、この 3 点はここで述べる以外に出す場所が無い。
	//
	// 利用規約への同意は `consent_collection.terms_of_service: 'required'` が Stripe 既定の
	// チェックボックス (規約リンク付き) で収集するため、本文では繰り返さない
	// (`custom_text.terms_of_service_acceptance` も設定しない = 同じことを 2 回言わない)。
	//
	// Stripe の `custom_text.*.message` は 1200 文字上限
	// (node_modules/stripe/cjs/resources/Checkout/Sessions.d.ts `namespace CustomText`)。
	// 超えると session 作成が 400 になり申込導線ごと死ぬため、
	// tests/unit/services/stripe-service.test.ts が上限内であることを pin する。
	submitMessage: `【${TOKUSHOHO_TERMS.heading4Delivery}】${CHECKOUT_DELIVERY_AND_RENEWAL_NOTICE}\n【${TOKUSHOHO_TERMS.heading5Cancel}】${CHECKOUT_CANCEL_METHOD_NOTICE}`,
	afterSubmitMessage: `アプリに戻って${CHECKOUT_TERMS.chosenPlanFeature}をお楽しみください。`,
	// future-proof: プラン名動的差し込み版 (#2346 No-gos = 本 PR では未使用、定義のみ)。
	// #2573: これは「提供開始時期」しか述べないため、**`custom_text.submit.message` には
	// そのまま使えない** (自動更新・解約方法が欠ける)。使うときは上の 2 つの notice を
	// 併せて組み立てること。
	submitMessageWithPlan: (planLabel: string) =>
		`お支払い後、すぐに${planLabel}の機能をご利用いただけます。`,
	afterSubmitMessageWithPlan: (planLabel: string) =>
		`アプリに戻って${planLabel}の機能をお楽しみください。`,
} as const;
