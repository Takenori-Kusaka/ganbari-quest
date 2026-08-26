// GET /auth/oauth/trial-start — Google 登録経路のトライアル自動開始 (#4702)
//
// なぜ独立 route が要るか: `/auth/callback` の時点ではまだテナントが存在しない
// (初回ログインのテナント自動プロビジョニングは hooks の `resolveContext` が行う)。
// callback から本 route に遷移させることで、hooks がテナントを作った**後**の
// `locals.context.tenantId` を使ってメール登録経路と同じ `startTrial` を呼べる。
//
// 料金ページ「無料体験をはじめる」→ `/auth/signup?plan=standard|family` の顧客が、
// Google で登録したときだけ無料プランに着地する不整合 (#4702 症状 3) をここで塞ぐ。

import { redirect } from '@sveltejs/kit';
import { resolveSafeNextPath } from '$lib/domain/validation/login-redirect';
import { OAUTH_PLAN_COOKIE_NAME, parseSignupPlanParam } from '$lib/domain/validation/signup-plan';
import { logger } from '$lib/server/logger';
import { startTrial, TRIAL_TIER } from '$lib/server/services/trial-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, locals, url }) => {
	// cookie は 1 回限り。以降のリクエストで再度トライアル開始を試みない (冪等)
	const planCookie = cookies.get(OAUTH_PLAN_COOKIE_NAME);
	cookies.delete(OAUTH_PLAN_COOKIE_NAME, { path: '/' });

	const target = resolveSafeNextPath(url.searchParams.get('next')) ?? '/admin';
	const tenantId = locals.context?.tenantId;
	// #4501: `?plan=` は「どのプランを見て来たか」だけを表し、トライアルの tier は決めない
	// (FR-2 により常に TRIAL_TIER = premium)。メール登録経路 (signup ?/confirm) と同じ規則
	const planInterest = parseSignupPlanParam(planCookie);

	if (!tenantId || !planInterest) {
		// 未認証 / テナント未解決 / plan 無効 → 何もせず通常の着地へ (dead-end を作らない)
		redirect(302, target);
	}

	// 失敗 (既に使用済み等) は best-effort でログのみ。メール登録経路 (signup ?/confirm) と同じ扱い
	try {
		const started = await startTrial({ tenantId, source: 'user_initiated', tier: TRIAL_TIER });
		logger.info(
			started
				? '[SIGNUP] Trial auto-started from Google signup flow'
				: '[SIGNUP] Trial auto-start rejected (already used/active) — Google signup flow',
			{ context: { tenantId, tier: TRIAL_TIER, planInterest } },
		);
	} catch (err) {
		logger.error('[SIGNUP] Trial auto-start threw (Google signup flow)', {
			context: {
				error: err instanceof Error ? err.message : String(err),
				tenantId,
				tier: TRIAL_TIER,
			},
		});
	}

	redirect(302, target);
};
