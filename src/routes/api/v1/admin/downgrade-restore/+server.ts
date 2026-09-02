// POST /api/v1/admin/downgrade-restore — アーカイブ済みリソースの復元 (#738)
//
// #4708: 復元は **有料プラン (standard / family) のときだけ** 通す。無料プランのまま復元できると
// 無料プランの上限で archive した意味が無くなる (上限の素通り)。有料化時の自動復元は Stripe webhook
// (W1 checkout / W2 invoice.paid / W4 subscription.updated=active) が担い、本 API は有料契約中に
// 何らかの理由で archive が残った場合の手動復元 (運用 / E2E のクリーンアップ) 用。

import { json } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { requireTenantId } from '$lib/server/auth/factory';
import { requireRole } from '$lib/server/auth/guards';
import { planLimitError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { isPaidTier, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import { restoreArchivedResources } from '$lib/server/services/resource-archive-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	requireRole(locals, ['owner', 'parent']);
	const tenantId = requireTenantId(locals);

	const tier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
	);
	if (!isPaidTier(tier)) {
		return planLimitError('standard', 'restore requires a paid plan', { tenantId, tier });
	}

	await restoreArchivedResources(tenantId);

	logger.info('[DOWNGRADE-RESTORE] Archived resources restored', {
		context: { tenantId, tier },
	});

	return json({ ok: true });
};
