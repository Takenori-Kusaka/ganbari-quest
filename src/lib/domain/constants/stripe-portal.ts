// src/lib/domain/constants/stripe-portal.ts
// Stripe Customer Portal 導線の共有定数 (#4166 / #4270)

/**
 * portal の flow が Stripe に拒否されて home に倒れたことを画面へ伝える query パラメータ。
 *
 * 解約フローは server action → Stripe への redirect で完結するため、倒れたことを伝える経路が
 * リダイレクト先の URL しかない。文字列を 2 箇所に直書きすると片方だけ直る不整合になるため
 * ここを SSOT にする (書き手: `admin/subscription/cancel/+page.server.ts` /
 * 読み手: `admin/subscription/+page.server.ts`)。
 */
export const PORTAL_FALLBACK_PARAM = 'portalFallback';

/**
 * どの意図の操作が home に倒れたか。顧客に出すメッセージ (次の操作) が変わる。
 *
 * - `cancel`: 解約フロー (解約理由フォームの直後)
 * - `plan-change`: プラン変更フロー (アップグレード CTA)
 */
export const PORTAL_FALLBACK_CONTEXT = {
	CANCEL: 'cancel',
	PLAN_CHANGE: 'plan-change',
} as const;

export type PortalFallbackContext =
	(typeof PORTAL_FALLBACK_CONTEXT)[keyof typeof PORTAL_FALLBACK_CONTEXT];

/**
 * **なぜ** 要求した flow へ直行できなかったか (#4548)。
 *
 * 顧客から見た着地 (portal ホーム) は同じでも、**次に取るべき行動が正反対**なので分ける。
 * 一括りにすると、恒久不能の顧客が「もう一度お試しください」を無限に繰り返す行き止まりに入る
 * (特商法上の解約導線の実効性)。
 *
 * - `flow-rejected`: Stripe が `flow_data` を拒否した (#4270)。**時間をおけば直りうる** → 再試行
 * - `no-subscription`: `stripeSubscriptionId` を持たず flow を組み立てられなかった (#4537)。
 *   **何度押しても同じ結果**になる (DB とのドリフト / 解約済みで Customer だけ残存) → 問い合わせ
 */
export const PORTAL_FALLBACK_REASON = {
	FLOW_REJECTED: 'flow-rejected',
	NO_SUBSCRIPTION: 'no-subscription',
} as const;

export type PortalFallbackReason =
	(typeof PORTAL_FALLBACK_REASON)[keyof typeof PORTAL_FALLBACK_REASON];

/**
 * 理由をリダイレクト先の画面へ伝える query パラメータ (#4548)。
 *
 * `PORTAL_FALLBACK_PARAM` (どの操作が倒れたか) とは軸が違う。文脈 × 理由の 2 軸で
 * 出す文言が決まるため、既存 param に値を足して 1 軸に潰さない。
 * 書き手: `cancel/+page.server.ts` / `cancel/graduation/+page.server.ts` /
 * `cancel/thanks/+page.server.ts`、読み手: `admin/subscription/+page.server.ts`。
 */
export const PORTAL_FALLBACK_REASON_PARAM = 'portalFallbackReason';

/**
 * portal そのものを作れなかったことを画面へ伝える query パラメータ (#4329)。
 *
 * `PORTAL_FALLBACK_PARAM` (flow は拒否されたが portal には入れた) とは別事象。こちらは
 * **Stripe に一切到達できていない**ため、顧客の解約手続きは 1 ミリも進んでいない。
 * 黙って thanks ページへ落とすと「解約したつもりで課金され続ける」ので、受け取り側は
 * 失敗した事実と代替手段を必ず出す (書き手: `cancel/+page.server.ts` /
 * 読み手: `cancel/thanks/+page.server.ts`)。
 */
export const PORTAL_UNAVAILABLE_PARAM = 'portalUnavailable';

/**
 * fallback で戻す先の URL を組み立てる (#4548)。
 *
 * 解約 (通常 / 卒業 / thanks からの再試行) の 3 経路が同じ URL を作る。文字列連結を各所に
 * 置くと、理由を足したときに一部だけ落ちる (= 一部の顧客にだけ出口が出ない) ため 1 箇所にする。
 */
export function buildPortalFallbackLocation(
	context: PortalFallbackContext,
	reason: PortalFallbackReason,
): string {
	return `/admin/subscription?${PORTAL_FALLBACK_PARAM}=${context}&${PORTAL_FALLBACK_REASON_PARAM}=${reason}`;
}

export function isPortalFallbackContext(value: unknown): value is PortalFallbackContext {
	return value === PORTAL_FALLBACK_CONTEXT.CANCEL || value === PORTAL_FALLBACK_CONTEXT.PLAN_CHANGE;
}

export function isPortalFallbackReason(value: unknown): value is PortalFallbackReason {
	return (
		value === PORTAL_FALLBACK_REASON.FLOW_REJECTED ||
		value === PORTAL_FALLBACK_REASON.NO_SUBSCRIPTION
	);
}
