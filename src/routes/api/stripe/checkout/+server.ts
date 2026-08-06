// POST /api/stripe/checkout — Stripe Checkout Session 作成
// セキュリティ: 認証必須 + owner/parent ロールのみ + tenantId はサーバー側から取得（改ざん不可）

import { error, json } from '@sveltejs/kit';
import { SUBSCRIPTION_PLAN } from '$lib/domain/constants/subscription-plan';
import { SUBSCRIPTION_PAGE_LABELS } from '$lib/domain/labels';
import { logger } from '$lib/server/logger';
import { createCheckoutSession } from '$lib/server/services/stripe-service';
import type { RequestHandler } from './$types';

/** オープンリダイレクト防止: returnPath は相対パス（/ 始まり）のみ許可 */
function validateReturnPath(path: string | undefined): string {
	if (!path) return '/admin';
	if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
		return '/admin';
	}
	return path;
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const context = locals.context;
	if (!context) {
		error(401, SUBSCRIPTION_PAGE_LABELS.checkoutErrorUnauthenticated);
	}

	// ロールチェック: owner/parent のみ決済操作を許可
	if (context.role !== 'owner' && context.role !== 'parent') {
		error(403, SUBSCRIPTION_PAGE_LABELS.checkoutErrorForbidden);
	}

	const tenantId = context.tenantId;

	const body = await request.json();
	const planId = body.planId;
	const returnPath: string | undefined = body.returnPath;
	// #2719 (Phase 7 PR-3b prerequisite): Phase 1 補強 2 FR-2 (年額廃止確定) 整合。
	// 新規購入経路は月額 2 種 (`MONTHLY` / `FAMILY_MONTHLY`) のみ受け付ける。
	// `SUBSCRIPTION_PLAN.YEARLY` / `FAMILY_YEARLY` は historical record (過去契約者の plan label)
	// として constants に残置されるが、新規 checkout の入力としては reject される。
	const validPlanIds: string[] = [SUBSCRIPTION_PLAN.MONTHLY, SUBSCRIPTION_PLAN.FAMILY_MONTHLY];
	if (!validPlanIds.includes(planId)) {
		// #4329: 顧客は plan の識別子を手で選ばない。ここに来るのは古い画面のまま操作した等の
		// **リクエスト側の噛み合わせ**であって「顧客が誤ったプランを選んだ」ではないので、
		// 顧客を責める文言 (旧「プランが正しくありません」) にしない (ADR-0062)。
		logger.warn(`[STRIPE] checkout に未対応の planId が送られました: planId=${String(planId)}`);
		error(400, SUBSCRIPTION_PAGE_LABELS.checkoutErrorStaleRequest);
	}

	const origin = url.origin;
	// #767: returnPath が指定された場合、Checkout 完了後にその画面に戻す
	// オープンリダイレクト防止: 相対パスのみ許可
	const safePath = validateReturnPath(returnPath);
	const successBase = returnPath ? safePath : '/admin/subscription';
	const successUrl = `${origin}${successBase}${successBase.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
	const cancelUrl = returnPath ? `${origin}${safePath}` : `${origin}/pricing`;

	const result = await createCheckoutSession({
		tenantId,
		planId,
		successUrl,
		cancelUrl,
	});

	if ('error' in result) {
		// #4329: status / 文言は「誰の側で何が起きたか」で決める。**サーバー側の異常を顧客の
		// 入力ミスとして表示しない** (原因の所在を偽ると、顧客は直しようのない操作を繰り返す)。
		// 文言はすべて labels.ts SSOT 経由 (直書き禁止、DESIGN.md §6)。
		const statusMap: Record<string, number> = {
			STRIPE_DISABLED: 503,
			// #4329: 認証済 context の tenant 不在はデータ側の異常。顧客の状態の説明 (404) にしない。
			TENANT_NOT_FOUND: 500,
			ALREADY_SUBSCRIBED: 409,
			// #4329: planId は上の許可リストを通過済なので、service 側の未解決 = 配備の設定不備。
			// #4286 の PRICE_UNRESOLVED と同じ理由で 4xx にしない。
			INVALID_PLAN: 503,
			// #4286: 配備の設定不備であって顧客の入力誤りではないので 4xx で返さない。
			PRICE_UNRESOLVED: 503,
		};
		const messageMap: Record<string, string> = {
			STRIPE_DISABLED: SUBSCRIPTION_PAGE_LABELS.checkoutErrorStripeDisabled,
			TENANT_NOT_FOUND: SUBSCRIPTION_PAGE_LABELS.checkoutErrorServer,
			ALREADY_SUBSCRIBED: SUBSCRIPTION_PAGE_LABELS.checkoutErrorAlreadySubscribed,
			INVALID_PLAN: SUBSCRIPTION_PAGE_LABELS.checkoutErrorServer,
			// #4286: STRIPE_DISABLED と同一文言だと「設定不備」か「機能停止」かを顧客が区別できず、
			// 再試行導線も無いまま離脱していた。原因の内部詳細は出さず次の行動だけを示す (ADR-0062)。
			PRICE_UNRESOLVED: SUBSCRIPTION_PAGE_LABELS.checkoutErrorPriceUnresolved,
		};
		error(
			statusMap[result.error] ?? 500,
			messageMap[result.error] ?? SUBSCRIPTION_PAGE_LABELS.checkoutErrorServer,
		);
	}

	return json({ url: result.url });
};
