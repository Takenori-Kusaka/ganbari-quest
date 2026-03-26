import { achievementQuerySchema } from '$lib/domain/validation/achievement';
import { requireTenantId } from '$lib/server/auth/factory';
import { validationError } from '$lib/server/errors';
import { getChildAchievements } from '$lib/server/services/achievement-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const tenantId = requireTenantId(locals);
	const parsed = achievementQuerySchema.safeParse({ childId: params.childId });
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	const achievements = await getChildAchievements(parsed.data.childId, tenantId);
	return json({ achievements });
};
