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
 * portal そのものを作れなかったことを画面へ伝える query パラメータ (#4329)。
 *
 * `PORTAL_FALLBACK_PARAM` (flow は拒否されたが portal には入れた) とは別事象。こちらは
 * **Stripe に一切到達できていない**ため、顧客の解約手続きは 1 ミリも進んでいない。
 * 黙って thanks ページへ落とすと「解約したつもりで課金され続ける」ので、受け取り側は
 * 失敗した事実と代替手段を必ず出す (書き手: `cancel/+page.server.ts` /
 * 読み手: `cancel/thanks/+page.server.ts`)。
 */
export const PORTAL_UNAVAILABLE_PARAM = 'portalUnavailable';

export function isPortalFallbackContext(value: unknown): value is PortalFallbackContext {
	return value === PORTAL_FALLBACK_CONTEXT.CANCEL || value === PORTAL_FALLBACK_CONTEXT.PLAN_CHANGE;
}
