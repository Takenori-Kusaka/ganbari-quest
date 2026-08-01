// src/lib/domain/contract-state-view.ts
// 契約状態 × 表示文言 × 認可結果の対応表 (#4156)
//
// 背景: #4146 でプラン画面と課金画面を統合したとき、画面の分岐が
// **契約の有無 (`stripeSubscriptionId`)** に一本化された。しかし
//   - `stripeSubscriptionId` は契約中しか存在しない (解約で消える)
//   - `stripeCustomerId` は一度でも取引があれば残る (`TERMINAL_CONTRACT_STATE` が意図的に残す)
// と寿命が違う。**請求書・領収書は過去の取引に紐づく**ため後者で判定しなければならない。
// 前者で判定した結果、解約済みの顧客から請求セクションごと消えた (退行 1)。
//
// もう 1 つ、#3993 で「解約後も無料プラン相当で書き込みを許可する」と認可の実挙動を
// 変えたとき、画面の文言 (「新しい活動の記録やポイントの付与はできません」) が追従しなかった
// (退行 2)。表示と認可が別ファイルにあり、整合を機械検証していなかったことが原因である。
//
// 本モジュールは両者を 1 つの表に載せる。表と実挙動の乖離は
// `tests/unit/domain/contract-state-view.test.ts` が実 `authorizeCognito` を叩いて検出する
// (ADR-0061 fitness function — 片方だけ変えたら落ちる)。
//
// 状態名は `docs/design/billing-redesign/contract-state-matrix.md` §4 の S1〜S5 に対応させ、
// 4 つ目の語彙を作らない。S6 (`terminated` = 退会) は本表の対象外 (理由は下記 §S6)。

import { AUTH_LICENSE_STATUS, type AuthLicenseStatus } from './constants/auth-license-status';
import { SUBSCRIPTION_STATUS, type SubscriptionStatus } from './constants/subscription-status';
import { SUBSCRIPTION_PAGE_LABELS } from './labels';

export const CONTRACT_STATE = {
	/** S1 未課金 (サインアップ直後 / トライアル) */
	FREE: 'free',
	/** S2 課金中 */
	ACTIVE: 'active',
	/** S2 + Stripe の `cancel_at_period_end` (期末解約の予約中。契約自体はまだ生きている) */
	CANCEL_PENDING: 'cancel-pending',
	/** S3 支払い失敗猶予 (dunning) */
	GRACE_PERIOD: 'grace-period',
	/** S4 停止 (契約は残り復帰しうる) */
	PAYMENT_SUSPENDED: 'payment-suspended',
	/** S5 契約終了 (解約確定。`stripeCustomerId` は残る) */
	CANCELLED: 'cancelled',
} as const;

export type ContractState = (typeof CONTRACT_STATE)[keyof typeof CONTRACT_STATE];

export const ALL_CONTRACT_STATES: readonly ContractState[] = [
	CONTRACT_STATE.FREE,
	CONTRACT_STATE.ACTIVE,
	CONTRACT_STATE.CANCEL_PENDING,
	CONTRACT_STATE.GRACE_PERIOD,
	CONTRACT_STATE.PAYMENT_SUSPENDED,
	CONTRACT_STATE.CANCELLED,
] as const;

/** 画面に出す告知 (`tone` は Alert / section の配色に対応) */
export interface ContractStateNotice {
	tone: 'warning' | 'info';
	title: string;
	desc: string;
}

export interface ContractStateView {
	/** `contract-state-matrix.md` §4 の行 */
	matrixRow: 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
	/** `deriveTenantEntitlement` が導く licenseStatus */
	licenseStatus: AuthLicenseStatus;
	/**
	 * 認可の実挙動として「活動の記録・ポイント付与ができるか」。
	 * #3993 の PO 判断により、解約後も停止中も**無料プラン相当で書き込みは許可される**
	 * (上限は free tier の plan limit が担う)。
	 */
	writesAllowed: boolean;
	/** `/admin/subscription` が status 別セクションとして描画する告知 (null = 描画しない) */
	statusNotice: ContractStateNotice | null;
	/**
	 * その契約状態で顧客が目にする文言すべて。`statusNotice` 以外の場所 (期末解約バナー等) で
	 * 出るものも含める — 検証対象から漏れる文言を作らないため。
	 */
	customerFacingTexts: readonly string[];
}

/**
 * 「書き込みができない」と読める表現。`writesAllowed: true` の状態でこれらを出してはならない
 * (ADR-0013 — 表示は実装の事実を SSOT とする)。
 */
export const WRITE_DENIAL_PHRASES: readonly string[] = [
	'記録やポイントの付与はできません',
	'記録はできません',
	'記録できません',
	'ご利用いただけません',
	'ご利用になれません',
] as const;

/** 期末解約バナーの検証用サンプル日付 (文言関数を実引数で評価するため) */
const SAMPLE_PERIOD_END = '2026-09-30';

export const CONTRACT_STATE_VIEW: Record<ContractState, ContractStateView> = {
	[CONTRACT_STATE.FREE]: {
		matrixRow: 'S1',
		licenseStatus: AUTH_LICENSE_STATUS.NONE,
		writesAllowed: true,
		statusNotice: null,
		customerFacingTexts: [],
	},
	[CONTRACT_STATE.ACTIVE]: {
		matrixRow: 'S2',
		licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
		writesAllowed: true,
		statusNotice: null,
		customerFacingTexts: [],
	},
	[CONTRACT_STATE.CANCEL_PENDING]: {
		matrixRow: 'S2',
		licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
		writesAllowed: true,
		// 期末解約の告知は専用バナー (取り消しボタン付き) が担うため status 別セクションは出さない
		statusNotice: null,
		customerFacingTexts: [
			SUBSCRIPTION_PAGE_LABELS.cancelPendingDescUnknownDate,
			SUBSCRIPTION_PAGE_LABELS.cancelPendingDesc(SAMPLE_PERIOD_END),
		],
	},
	[CONTRACT_STATE.GRACE_PERIOD]: {
		matrixRow: 'S3',
		licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
		writesAllowed: true,
		statusNotice: {
			tone: 'warning',
			title: SUBSCRIPTION_PAGE_LABELS.gracePeriodTitle,
			desc: SUBSCRIPTION_PAGE_LABELS.gracePeriodDesc,
		},
		customerFacingTexts: [SUBSCRIPTION_PAGE_LABELS.gracePeriodDesc],
	},
	[CONTRACT_STATE.PAYMENT_SUSPENDED]: {
		matrixRow: 'S4',
		licenseStatus: AUTH_LICENSE_STATUS.SUSPENDED,
		writesAllowed: true,
		statusNotice: {
			tone: 'warning',
			title: SUBSCRIPTION_PAGE_LABELS.paymentSuspendedTitle,
			desc: SUBSCRIPTION_PAGE_LABELS.paymentSuspendedDesc,
		},
		customerFacingTexts: [SUBSCRIPTION_PAGE_LABELS.paymentSuspendedDesc],
	},
	[CONTRACT_STATE.CANCELLED]: {
		matrixRow: 'S5',
		// S5 は `stripeSubscriptionId` が NULL のため `deriveTenantEntitlement` は NONE を返す
		// (`status=suspended` でも SUSPENDED にはならない)。無料プランと同じ扱いである。
		licenseStatus: AUTH_LICENSE_STATUS.NONE,
		writesAllowed: true,
		statusNotice: {
			tone: 'info',
			title: SUBSCRIPTION_PAGE_LABELS.cancelledTitle,
			desc: SUBSCRIPTION_PAGE_LABELS.cancelledDesc,
		},
		customerFacingTexts: [SUBSCRIPTION_PAGE_LABELS.cancelledDesc],
	},
};

export interface ContractStateInput {
	status: SubscriptionStatus;
	stripeSubscriptionId?: string | null;
	/** Stripe の `cancel_at_period_end`。SSOT は Stripe 側 (#3991) */
	cancelAtPeriodEnd?: boolean;
}

/**
 * `families` の契約 4 列 + Stripe の期末解約フラグから契約状態を導く。
 *
 * S6 (`terminated` = 退会) は本表の対象外。退会テナントは `hooks.server.ts` が
 * 画面に到達する前に完全ブロックするため、「画面の告知 × 認可」の対応表に載せると
 * 実挙動 (到達しない) と噛み合わない。`/admin/subscription` は従来どおり
 * `statusTerminated` の専用セクションで扱う。
 */
export function resolveContractState(input: ContractStateInput): ContractState | null {
	const hasContract = !!input.stripeSubscriptionId;

	if (input.status === SUBSCRIPTION_STATUS.TERMINATED) return null;

	if (input.status === SUBSCRIPTION_STATUS.SUSPENDED) {
		// S4 / S5 の分岐は `isChurnedContract` と同じ判別軸 (契約の有無)
		return hasContract ? CONTRACT_STATE.PAYMENT_SUSPENDED : CONTRACT_STATE.CANCELLED;
	}

	if (input.status === SUBSCRIPTION_STATUS.GRACE_PERIOD) return CONTRACT_STATE.GRACE_PERIOD;

	if (!hasContract) return CONTRACT_STATE.FREE;

	return input.cancelAtPeriodEnd ? CONTRACT_STATE.CANCEL_PENDING : CONTRACT_STATE.ACTIVE;
}

/**
 * 請求書・領収書 (= **過去の取引**) に到達できるか。
 *
 * 判定軸は契約の有無ではなく **顧客の有無** (`stripeCustomerId`)。解約すると
 * `stripeSubscriptionId` は消えるが `stripeCustomerId` は残る (`TERMINAL_CONTRACT_STATE`)。
 * 特商法の表示義務に接続する導線であり、解約済みでも到達可能でなければならない (#4156)。
 *
 * サーバー側の `createPortalSession` も同じ軸で判定している
 * (`stripeCustomerId` が無いときだけ `NO_STRIPE_CUSTOMER`)。
 */
export function canOpenBillingHistory(input: { stripeCustomerId?: string | null }): boolean {
	return !!input.stripeCustomerId;
}

/** 契約中の操作 (プラン変更 / 支払い方法の更新) ができるか */
export function hasActiveContract(input: { stripeSubscriptionId?: string | null }): boolean {
	return !!input.stripeSubscriptionId;
}
