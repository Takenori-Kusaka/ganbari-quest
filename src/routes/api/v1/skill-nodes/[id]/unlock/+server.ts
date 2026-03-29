import { requireTenantId } from '$lib/server/auth/factory';
import { apiError, notFound, validationError } from '$lib/server/errors';
import { unlockSkillNode } from '$lib/server/services/skill-service';
import { getCategoryXpSummary } from '$lib/server/services/status-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const tenantId = requireTenantId(locals);
	const nodeId = Number(params.id);
	if (Number.isNaN(nodeId)) return validationError('IDが不正です');

	const body = await request.json().catch(() => null);
	const childId = Number(body?.childId);
	if (Number.isNaN(childId)) return validationError('childIdが必要です');

	// カテゴリレベルを取得
	const xpSummary = await getCategoryXpSummary(childId, tenantId);
	if (!xpSummary) return notFound('こどもがみつかりません');

	const categoryLevels: Record<number, number> = {};
	for (const [catId, info] of Object.entries(xpSummary)) {
		categoryLevels[Number(catId)] = info.level;
	}

	const result = await unlockSkillNode(childId, nodeId, categoryLevels, tenantId);

	if ('error' in result) {
		switch (result.error) {
			case 'NOT_FOUND':
				return notFound('スキルノードがみつかりません');
			case 'ALREADY_UNLOCKED':
				return apiError('VALIDATION_ERROR', 'このスキルはすでに解放済みです');
			case 'PREREQUISITE_NOT_MET':
				return apiError('VALIDATION_ERROR', '前提スキルが解放されていません');
			case 'INSUFFICIENT_SP':
				return apiError('INSUFFICIENT_POINTS', 'スキルポイントが足りません');
			case 'CATEGORY_LEVEL_NOT_MET':
				return apiError('VALIDATION_ERROR', 'カテゴリレベルが足りません');
		}
	}

	return json({ success: true, node: result.node });
};
