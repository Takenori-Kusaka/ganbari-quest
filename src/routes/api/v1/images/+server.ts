import { requireTenantId } from '$lib/server/auth/factory';
// POST /api/v1/images - Generate avatar or favicon
// GET /api/v1/images?type=favicon - Get favicon path

import { notFound, validationError } from '$lib/server/errors';
import {
	generateAvatar,
	generateFavicon,
	getFaviconPath,
} from '$lib/server/services/image-service';
import { getChildStatus } from '$lib/server/services/status-service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const tenantId = requireTenantId(locals);
	const type = url.searchParams.get('type');

	if (type === 'favicon') {
		const path = await getFaviconPath(tenantId);
		return json({ faviconPath: path || null });
	}

	return validationError('type パラメータを指定してください（favicon）');
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const tenantId = requireTenantId(locals);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return validationError('リクエストボディが不正です');
	}

	const { type } = body as { type?: string };

	if (type === 'avatar') {
		const { childId } = body as { childId?: number };
		if (!childId || typeof childId !== 'number') {
			return validationError('childId を指定してください');
		}

		const status = await getChildStatus(childId, tenantId);
		if ('error' in status) {
			return notFound('子供が見つかりません');
		}

		const result = await generateAvatar(
			childId,
			{
				characterType: status.characterType,
				level: status.level,
			},
			tenantId,
		);

		if ('error' in result) {
			return notFound(result.error);
		}

		return json({
			filePath: result.filePath,
			isGenerated: result.isGenerated,
		});
	}

	if (type === 'favicon') {
		const result = await generateFavicon(tenantId);
		return json({
			filePath: result.filePath,
			isGenerated: result.isGenerated,
		});
	}

	return validationError('type は avatar または favicon を指定してください');
};
