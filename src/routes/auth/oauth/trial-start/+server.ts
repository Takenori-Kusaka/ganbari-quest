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
	const planCookie = cookies.get(OAUTH_PLAN_COOKIE_NAME);
	const target = resolveSafeNextPath(url.searchParams.get('next')) ?? '/admin';
	const tenantId = locals.context?.tenantId;
	// #4501: `?plan=` は「どのプランを見て来たか」だけを表し、トライアルの tier は決めない
	// (FR-2 により常に TRIAL_TIER = premium)。メール登録経路 (signup ?/confirm) と同じ規則
	const planInterest = parseSignupPlanParam(planCookie);

	// #4702 (QM): **cookie の破棄は「開始を試みた後」に限る**。
	// テナント自動プロビジョニング (hooks の resolveContext) が初回リクエストで
	// 間に合わない / 失敗すると tenantId が取れないが、その時点で cookie を消していると
	// 「無料体験をはじめる」を押した顧客のトライアルが**再試行不能なまま永久に失われる**
	// (顧客にもサポートにも見えず、サーバログにしか残らない)。
	// plan が無効なときは再試行しても意味が無いので、そこは消す。
	if (!planInterest) {
		cookies.delete(OAUTH_PLAN_COOKIE_NAME, { path: '/' });
		redirect(302, target);
	}
	if (!tenantId) {
		// cookie は残す。次のリクエスト (リロード / 後続の遷移) で再試行できる。
		logger.warn('[SIGNUP] Trial auto-start deferred — tenant unresolved (Google signup flow)', {
			context: { planInterest },
		});
		redirect(302, target);
	}

	// #4702 (QM #4748): `/auth` 配下は isPublicRoute で全ロール allowed になるため、ここでロールを見る。
	// 世帯の課金状態を変える操作は owner にしか許さない (Google 連携の child / 招待で合流した parent が
	// ?plan= 付きで Google ログインしても、世帯の 1 回限りのトライアルを消費させない)。
	// callback 側で「初回 provisioning のときだけ本 route へ来る」ようにしているので、通常は
	// 新規テナントの作成者 (owner) だけがここに到達する。二重防御。
	const role = locals.context?.role;
	if (role !== 'owner') {
		cookies.delete(OAUTH_PLAN_COOKIE_NAME, { path: '/' });
		logger.warn('[SIGNUP] Trial auto-start skipped — non-owner role (Google signup flow)', {
			context: { tenantId, role: role ?? null, planInterest },
		});
		redirect(302, target);
	}
	// ここから先は「開始を試みた」ので cookie を落とす (冪等。多重開始は startTrial 側も拒否する)
	cookies.delete(OAUTH_PLAN_COOKIE_NAME, { path: '/' });

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
