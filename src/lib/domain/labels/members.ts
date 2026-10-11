// labels 層 (ADR-0045 / #4965): メンバー・招待・閲覧リンク (画面をまたぐ機能)。置き場所の規則は docs/DESIGN.md §6
import {
	ADMIN_VIEW_TERMS,
	CANCEL_TERMS,
	CHILD_TERMS,
	PARENT_TERMS,
	PLAN_FULL_TERMS,
} from '../terms';
// #4704: 受諾拒否の理由。案内文の網羅を型で強制するために型だけを引く
import type { InviteAcceptErrorReason } from '../validation/auth';
import { SETTINGS_LABELS } from './admin-settings';

// #4672: PAGE_GUIDE_LABELS.adminMembers がボタン名を参照するため PAGE_GUIDE_LABELS より前に置く
//        (module 初期化順。const は宣言前に参照できない)
// ============================================================
// admin/members ページ (#1452 Phase B)
// ============================================================

export const MEMBERS_LABELS = {
	// #4704: 招待できない状態を **押す前に** 伝える (旧: フォームが活性のまま、送信して初めて 403)。
	/** 上限到達 (free = 自分 1 人まで / standard = 4 人まで) */
	inviteLimitTitle: '今のプランではこれ以上ご招待いただけません',
	inviteLimitDesc: (current: number, max: number) =>
		`ご家族のメンバーと発行済みの招待をあわせて ${current} / ${max} 人です。${PLAN_FULL_TERMS.standard}以上にすると人数を増やせます。`,
	/** free は「上限 1 人」= 実質「自分だけ」なので、人数ではなく意味で伝える */
	inviteLimitDescFree: `${PLAN_FULL_TERMS.free}ではご家族の招待をご利用いただけません（${ADMIN_VIEW_TERMS.canonical}はご本人のみ）。${PLAN_FULL_TERMS.standard}以上にすると、ご家族を招待できます。`,
	inviteLimitCta: 'プランを見る',
	/** セルフホスト (NUC) では招待 API 自体が使えない */
	inviteUnsupportedTitle: 'この環境では招待をご利用いただけません',
	inviteUnsupportedDesc:
		'ご自宅のサーバーでお使いの場合、同じ端末・同じネットワークからそのままご利用いただけるため、招待の仕組みはありません。',

	// Role labels
	roleOwner: 'オーナー',
	roleParent: `${PARENT_TERMS.honorific}`,
	// #4716: 招待ロールの選択肢は保護者画面にしか出ない。親画面は honorific に寄せる。
	roleChild: `${CHILD_TERMS.honorific}`,

	// Current members section
	currentMembersTitle: '現在のメンバー',
	noMembersText: 'メンバーがいません',
	transferButton: '移譲',
	removeButton: '削除',
	leaveGroupButton: '家族グループを離れる',

	// Invite section
	inviteSectionTitle: 'メンバーを招待',
	inviteRoleLabel: '招待ロール',
	// #3549 判断2: 宛先 email 束縛 (任意入力。設定時は招待リンクをその email のアカウントでのみ受諾可能)
	inviteEmailLabel: '宛先メールアドレス（任意）',
	inviteEmailHint: '入力すると、このメールアドレスのアカウントだけが招待を受諾できます',
	inviteChildLabel: `対象の${CHILD_TERMS.honorific}（任意）`,
	inviteChildNone: '-- 後で紐づけ --',
	inviteCreateLoading: '作成中...',
	inviteCreateButton: '招待リンクを作成',
	inviteSuccessMsg: '招待リンクが作成されました（7日間有効）',
	inviteQrAlt: '招待QRコード',
	inviteQrNote: 'スマートフォンのカメラでスキャンして参加できます',
	inviteUrlLabel: '招待URL',
	inviteCopied: 'コピー済み',
	inviteCopy: 'コピー',

	// Pending invites section
	pendingInvitesTitle: '保留中の招待',
	inviteExpiresPrefix: '期限: ',
	// #3555 ①: 宛先 email 束縛付き招待の宛先を owner に見せる (タイプミスに気づき
	// 取消し → 再発行できる修正導線)
	inviteEmailBoundPrefix: '宛先: ',
	inviteRevokeButton: '取消し',
	// #3552 ③: 招待の発行・取消は owner 専用 (#3549 PO 決裁 (a))。parent には保留中招待
	// リストは見えるが取消ボタンは非表示のため、「なぜ操作できないか + 誰に依頼するか」を
	// 案内し「認知的宙吊り」(操作が消えて理由も導線も無い状態) を解消する。
	inviteOwnerOnlyNote:
		'招待の発行・取り消しはオーナーのみ行えます。変更が必要な場合はオーナーにご依頼ください。',

	// Error messages
	inviteCreateError: '招待リンクの作成に失敗しました',
	networkError: '通信エラーが発生しました',
	removeError: '削除に失敗しました',
	transferError: '移譲に失敗しました',
	leaveError: '離脱に失敗しました',

	// Confirm dialogs
	revokeConfirm: 'この招待リンクを取り消しますか？',
	removeMemberConfirm: (email: string) =>
		`${email} をメンバーから削除しますか？この操作は取り消せません。`,
	transferConfirm: (email: string) =>
		`${email} にオーナー権限を移譲しますか？\n移譲後、あなたは「保護者」ロールになります。この操作は取り消せません。`,
	leaveGroupConfirm: '家族グループを離れますか？この操作は取り消せません。',

	// Viewer link section
	viewerSectionTitle: '閲覧リンク',
	viewerSectionDesc: '祖父母や家族に、お子さまの成長を読み取り専用で共有できます',
	viewerLabelField: 'ラベル（任意）',
	viewerLabelPlaceholder: '例: おばあちゃん用',
	viewerDurationLabel: '有効期限',
	// #4500: viewerDuration7d は `TRIAL_TERMS.duration` (無料体験の期間) を流用していた。
	// 閲覧リンクの有効期限とトライアル期間は無関係で、トライアルを 14 日に変えた瞬間に
	// 閲覧リンクの選択肢が「14日間」と表示される (誤流用)。閲覧リンク自身の値として持つ。
	viewerDuration7d: '7日間',
	viewerDuration30d: '30日間',
	viewerDurationUnlimited: '無期限',
	viewerCreateLoading: '作成中...',
	viewerCreateButton: '閲覧リンクを作成',
	viewerSuccessMsg: '閲覧リンクが作成されました',
	viewerQrAlt: '閲覧QRコード',
	viewerQrNote: 'スマートフォンのカメラでスキャンして閲覧できます',
	viewerUrlLabel: '閲覧URL',
	viewerCopied: 'コピー済み',
	viewerCopy: 'コピー',
	viewerNoLabel: '(ラベルなし)',
	viewerStatusInvalid: '無効',
	viewerStatusExpired: '期限切れ',
	viewerStatusValid: '有効',
	viewerExpiresPrefix: '期限: ',
	viewerExpiresNone: '無期限',
	viewerRevokeButton: '無効化',
	viewerDeleteButton: '削除',
	viewerRevokeConfirm: 'この閲覧リンクを無効にしますか？',
	viewerDeleteConfirm: 'この閲覧リンクを削除しますか？',
	viewerCreateError: '閲覧リンクの作成に失敗しました',

	// Button titles
	transferTitle: 'オーナー権限を移譲',
	removeTitle: 'メンバーを削除',
} as const;

/**
 * メンバー role の内部コードを日本語ラベルにする (#4507)。
 *
 * 内部コード ('owner' / 'parent' / 'child') を顧客に見せないための SSOT
 * (DESIGN.md §6「内部コード露出禁止」)。メール本文 / 画面のどちらからも本関数を通す。
 * 未知の role は内部コードを露出させず空文字を返さないよう、汎用語にフォールバックする。
 */
export function getMemberRoleLabel(role: string): string {
	switch (role) {
		case 'owner':
			return MEMBERS_LABELS.roleOwner;
		case 'parent':
			return MEMBERS_LABELS.roleParent;
		case 'child':
			return MEMBERS_LABELS.roleChild;
		default:
			return MEMBERS_LABELS.roleParent;
	}
}

export const AUTH_INVITE_LABELS = {
	appTitle: 'がんばりクエスト',
	invalidLink: 'この招待リンクは無効または期限切れです。',
	invalidLinkDesc: '招待した方に新しいリンクを発行してもらってください。',
	loginPageLink: 'ログインページへ',
	// #4049: 家庭内共有端末 (親の端末で子の招待リンクを踏む) の正しい次アクションを案内する。
	// #0203 の残留防止でログアウト時に招待 Cookie が消えるため、ログアウト後は
	// 「招待リンクをもう一度タップする」必要がある。これを明示しないと、そのまま
	// /auth/signup に進んで新規家族グループの owner になってしまう。
	// #4704: 招待を発行した本人 (同じ家族グループ) がリンクを開いたときは「別のグループ」ではない。
	// リンクの使い方 (渡す相手が違う) を伝える。
	ownTenantInvite: 'このリンクはご自身のご家族グループへの招待です。',
	ownTenantInviteDesc:
		'招待したい方（別のアカウントをお使いの方）にこのリンクをお送りください。お送りした方がリンクを開くと参加できます。',
	alreadyInTenant: '既に別のグループに所属しているため、この招待を受けることはできません。',
	alreadyInTenantDesc: `${CHILD_TERMS.hiragana}用のアカウントを新しく作る場合は、一度ログアウトしてから、招待リンクをもう一度タップしてください。`,
	// #4049 AC3: ログイン中に出るエラー画面の主導線 (「ログインページへ」だけを出口にしない)
	logoutButton: 'ログアウトする',
	inviteMessage: '家族グループへの招待が届いています。',
	roleLabel: '参加ロール:',
	// 招待の参加ロール表示 (内部コード role を露出しない、DESIGN.md §6)
	roleParent: PARENT_TERMS.honorific,
	roleChild: CHILD_TERMS.hiragana,
	signupButton: '新規アカウントを作成して参加',
	loginButton: '既存アカウントでログインして参加',
	// #3555 ①: 招待 email 束縛 (#3549 判断2) の不一致を顧客向けに案内する文言。
	// 英語エラーコード (INVITE_EMAIL_MISMATCH) を露出せず、次アクションを必ず添える。
	emailMismatch: 'この招待は別のメールアドレス宛です。',
	emailMismatchDesc: '招待した方に、あなたのメールアドレス宛の招待を発行し直してもらってください。',
	// #4636: 受諾できなかったときは新規家族グループを作らず `/auth/join` に留まる。
	// 文言は「なぜ参加できなかったか + 次アクション」の 2 点セットで、第三者に
	// 招待元世帯の支払い状態を推測させない粒度に丸める (ADR-0062 内部例外非露出)。
	joinBlockedMismatch:
		'この招待は別のメールアドレス宛のため、参加できませんでした。招待した方に、あなたのメールアドレス宛の招待を発行し直してもらってください。',
	joinBlockedUnverified:
		'メールアドレスの確認が完了していないため、参加できませんでした。確認メールのリンク（または確認コード）で確認を終えてから、招待リンクをもう一度開いてください。',
	joinBlockedExpired:
		'招待の有効期限が切れているため、参加できませんでした。招待した方に、新しい招待リンクを発行してもらってください。',
	// 支払い状態に触れない粒度に丸める (招待コードを持つだけの第三者に世帯の課金状態を漏らさない)
	joinBlockedTenantUnavailable:
		'いまこの家族グループには参加できません。招待した方にご確認のうえ、改めて招待を発行してもらってください。',
	joinBlockedAlreadyInTenant:
		'あなたのアカウントはすでに別の家族グループに参加しているため、この招待は受け取れません。参加する方ご本人のアカウントでログインし直してから、招待リンクを開いてください。',
	joinBlockedSelfInvite:
		'ご自身が発行した招待は受け取れません。参加する方ご本人のアカウントで招待リンクを開いてください。',
	joinBlockedOwnerDowngrade:
		'あなたはすでにこの家族グループの管理者のため、この招待を受け取る必要はありません。そのまま管理者としてご利用いただけます。',
	// #4723 / #4704: プランのメンバー上限。第三者にどのプランかを推測させないため人数も上限値も出さない
	joinBlockedMemberLimit:
		'この家族グループはメンバーの上限に達しているため、参加できませんでした。招待した方にご確認ください。',
	joinBlockedGeneric:
		'招待を受け取れませんでした。招待した方に、招待リンクを発行し直してもらってください。',
} as const;

/**
 * `/auth/invite/[code]` の引っ越し合流 (別の家族グループへ移る) 確認画面 (#4642)。
 *
 * **不可逆操作**: 元の家族グループのデータは復元できない。文言は「何が消えるか」と
 * 「取り消せないこと」を明示し、同意チェックを経ないと実行させない。
 */
export const INVITE_RELOCATION_LABELS = {
	title: '今の家族グループを畳んで参加しますか？',
	lead: 'あなたは今、ご自身が管理者の家族グループをお使いです。この招待に参加すると、いまの家族グループは削除され、招待された家族グループに移ります。',
	discardHeading: '削除されるもの',
	discardItems: [
		`いまの家族グループに登録した${CHILD_TERMS.honorific}のプロフィール`,
		'活動・ごほうび・チェックリスト・ルールなどの設定',
		'これまでの記録（ポイント履歴・達成の記録）と、アップロードした画像',
	],
	irreversibleWarning: '削除したデータは元に戻せません。この操作は取り消せません。',
	keepNote:
		'ログインに使うメールアドレスとアカウントはそのままです。招待された家族グループでそのままお使いいただけます。',
	backupHint:
		'記録を残しておきたい場合は、参加する前にいまの家族グループの設定からデータをエクスポートしてください。',
	acknowledgeLabel: '上記に同意します（いまの家族グループのデータは削除され、元に戻せません）',
	// #4642 PO 差し戻し: 退会と結果が同じ (fullTenantDeletion) なので要求する重さも同じにする。
	// 確認語の atom は CANCEL_TERMS.confirmPhrase (退会側と共通、複製を作らない)。
	confirmInputLabel: SETTINGS_LABELS.dangerConfirmInputLabel,
	confirmInputPlaceholder: CANCEL_TERMS.confirmPhrase,
	confirmInputMismatch: `確認のため「${CANCEL_TERMS.confirmPhrase}」と正確に入力してください。`,
	confirmButton: '同意して参加する',
	confirmButtonLoading: '参加しています…',
	cancelButton: 'やめておく',
	acknowledgeRequired: '同意のチェックを入れてから進んでください。',
	failed:
		'参加できませんでした。時間をおいてもう一度お試しください。いまの家族グループはそのまま残っています。',
	// 引っ越しできないときの案内 (理由ごとに次アクションを添える)
	blockedHasOtherMembers:
		'いまの家族グループに他のメンバーがいるため、参加できません。メンバー管理から他のメンバーを削除するか、先に別の方へ管理者を移してから、招待リンクをもう一度開いてください。',
	// #4642 PO 決裁 Q1: 子供が 1 人でも居たら阻止する (その子の記録ごと消えるため)。
	blockedHasChildren: `いまの家族グループに${CHILD_TERMS.honorific}の記録が残っているため、参加できません。記録を残しておきたい場合は先にデータをエクスポートし、${CHILD_TERMS.honorific}の登録を削除してから、招待リンクをもう一度開いてください。`,
	blockedNotOwner:
		'いまの家族グループの管理者ではないため、ここからは参加できません。メンバー管理から今の家族グループを抜けたあと、招待リンクをもう一度開いてください。',
} as const;

/**
 * 受諾拒否理由 → `/auth/join` に出す説明文の対応表 (SSOT、#3555 ① / #4633 AC-A / #4636)。
 * 理由の一覧は `INVITE_ACCEPT_ERROR_REASONS` (`$lib/domain/validation/auth`) 側が持つ。
 *
 * #4704: `Record<InviteAcceptErrorReason, string>` を満たすことを型で強制する。
 * 受諾の失敗理由を増やしたのに案内文を書かないと**コンパイルが通らない**。
 * 案内が無い理由が混ざると、顧客は「なぜ参加できなかったか」を知らないまま
 * `/auth/join` で行き止まる (#4704 で MEMBER_LIMIT_REACHED を足したとき、旧実装の
 * 2 件 allowlist はこの経路を素通りさせていた)。
 */
export const INVITE_JOIN_BLOCKED_MESSAGES = {
	INVITE_EMAIL_MISMATCH: AUTH_INVITE_LABELS.joinBlockedMismatch,
	INVITE_EMAIL_UNVERIFIED: AUTH_INVITE_LABELS.joinBlockedUnverified,
	INVALID_OR_EXPIRED: AUTH_INVITE_LABELS.joinBlockedExpired,
	TENANT_NOT_FOUND: AUTH_INVITE_LABELS.joinBlockedTenantUnavailable,
	ALREADY_IN_TENANT: AUTH_INVITE_LABELS.joinBlockedAlreadyInTenant,
	SELF_INVITE_NOT_ALLOWED: AUTH_INVITE_LABELS.joinBlockedSelfInvite,
	OWNER_CANNOT_BE_DOWNGRADED: AUTH_INVITE_LABELS.joinBlockedOwnerDowngrade,
	// #4723 / #4704: 受諾 txn 内の席数検査で拒否されたとき (発行後のプラン変更 / 同時受諾)
	MEMBER_LIMIT_REACHED: AUTH_INVITE_LABELS.joinBlockedMemberLimit,
} as const satisfies Record<InviteAcceptErrorReason, string>;

/**
 * `/auth/join` — 招待受諾に失敗した (または参加先が確定していない) 人が留まる画面 (#4636)。
 * 旧実装はここで無音のうちに新しい家族グループを作って owner にしていた。作るかどうかは
 * 本人に選ばせ、選ぶまでは membership 未確定を正規の状態として扱う。
 */
export const AUTH_JOIN_LABELS = {
	blockedTitle: '招待の家族グループに参加できませんでした',
	noInviteTitle: '参加する家族グループが決まっていません',
	noInviteDesc:
		'招待を受けている場合は、招待した方から届いたリンクをもう一度開いてください。ご自身で新しく始める場合は、下のボタンから家族グループを作成できます。',
	retryHint: '原因を解消してから招待リンクをもう一度開くと、そのまま参加できます。',
	createSectionTitle: '新しく自分の家族グループを作る',
	createSectionDesc:
		'招待での参加はやめて、ご自身が管理者となる新しい家族グループを作成します。招待した方の家族グループのデータは引き継がれません。',
	createButton: '自分の家族グループを作る',
	createButtonLoading: '作成しています…',
	createFailed:
		'家族グループを作成できませんでした。時間をおいてもう一度お試しください。続く場合はサポートへご連絡ください。',
	switchAccountLink: '別のアカウントでログインする',
} as const;

/** 未知の理由 (将来追加された理由 / 想定外) は汎用文言にフォールバックする。 */
export function getInviteJoinBlockedMessage(reason: string): string {
	return (
		(INVITE_JOIN_BLOCKED_MESSAGES as Record<string, string>)[reason] ??
		AUTH_INVITE_LABELS.joinBlockedGeneric
	);
}

export const VIEW_PAGE_LABELS = {
	appTitle: 'がんばりクエスト',
	viewOnlyNotice: '閲覧専用リンク',
	// #4866 系 QM 監査 (consistency) / PO 差し戻し 2026-09-09:
	// **同一画面で「お子さま」と「こども」を併記**していた (DESIGN.md §6 の 5 ドメイン用語)。
	// `/view/[token]` は「リンクを共有された大人 (祖父母等)」が見る面なので、
	// #4716 が保護者画面に適用したのと同じ `CHILD_TERMS.honorific` に寄せる
	// (`SETUP_CHILDREN_LABELS` / `SETUP_CHALLENGES_LABELS` の `errorNoChildren` が既に honorific 参照で、そちらに揃える形)。
	emptyChildren: `まだ ${CHILD_TERMS.honorific}が とうろくされていません`,
	statPointLabel: 'ポイント',
	statLevelLabel: 'そうごうレベル',
	footerText: `がんばりクエスト — ${CHILD_TERMS.honorific}の がんばりを みんなで おうえん`,
	// #4703: 無効 / 期限切れ token 専用の説明。汎用 404「ページが みつかりません」だと
	// リンクを共有された人 (祖父母等) が「自分の操作を間違えた」と受け取ってしまう。
	// (#4512 の errorInvalidToken は同一文言の重複 atom だったため本 SSOT に統合)
	invalidTokenTitle: 'このリンクは無効か、期限切れです',
	invalidTokenDesc: `リンクの有効期限が切れたか、共有した${PARENT_TERMS.honorific}が無効にした可能性があります。共有元の${PARENT_TERMS.honorific}に新しいリンクの発行を依頼してください。`,
} as const;
