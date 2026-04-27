// src/routes/(parent)/admin/analytics/+page.server.ts
// #1591 (ADR-0023 I2): umami / Sentry プロバイダ削除に伴い、本ページは
// 「Coming soon」表示に縮退する。DynamoDB ベースの可視化（activation funnel /
// 解約理由 / Sean Ellis 等）は follow-up Issue で実装する。

import { requireTenantId } from '$lib/server/auth/factory';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireTenantId(locals);
	return {};
};
