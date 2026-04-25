// src/routes/api/v1/reward-redemption-requests/[id]/+server.ts
// ごほうびショップ申請 承認/却下 API (#1337)
// PATCH: 親が申請を承認または却下

import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	approveRedemption,
	rejectRedemption,
} from '$lib/server/services/reward-redemption-service';
import type { RequestHandler } from './$types';

const NOT_FOUND_BODY = { error: 'REQUEST_NOT_FOUND', message: '申請が見つかりません' };
const INVALID_STATUS_BODY = { error: 'INVALID_STATUS', message: '既に処理済みの申請です' };
const INSUFFICIENT_POINTS_BODY = {
	error: 'INSUFFICIENT_POINTS',
	message: 'ポイントが不足しています',
};

async function handleApprove(requestId: number, tenantId: string) {
	// parentId は resolved_by_parent_id に記録する追跡用。AuthContext に userId が無いため 0 をフォールバック
	const result = await approveRedemption(requestId, 0, tenantId);
	if (!('error' in result)) return json(result);

	switch (result.error) {
		case 'INVALID_STATUS':
			return json(INVALID_STATUS_BODY, { status: 400 });
		case 'INSUFFICIENT_POINTS':
			return json(INSUFFICIENT_POINTS_BODY, { status: 400 });
		case 'REQUEST_NOT_FOUND':
			return json(NOT_FOUND_BODY, { status: 404 });
	}
}

async function handleReject(requestId: number, parentNote: string | undefined, tenantId: string) {
	const note = typeof parentNote === 'string' ? parentNote : null;
	const result = await rejectRedemption(requestId, note, tenantId);
	if (!('error' in result)) return json(result);

	switch (result.error) {
		case 'INVALID_STATUS':
			return json(INVALID_STATUS_BODY, { status: 400 });
		case 'REQUEST_NOT_FOUND':
			return json(NOT_FOUND_BODY, { status: 404 });
	}
}

/** 申請を承認または却下 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const role = context.role;
	if (role !== 'owner' && role !== 'parent') {
		return json({ error: '権限がありません' }, { status: 403 });
	}

	const tenantId = requireTenantId(locals);
	const requestId = Number(params.id);
	if (!requestId || Number.isNaN(requestId)) {
		return json({ error: '不正なリクエストIDです' }, { status: 400 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: '不正なリクエストです' }, { status: 400 });
	}

	if (typeof body !== 'object' || body === null) {
		return json({ error: 'action は必須です' }, { status: 400 });
	}

	const { action, parentNote } = body as { action: unknown; parentNote?: string };

	if (action === 'approve') {
		return handleApprove(requestId, tenantId);
	}

	if (action === 'reject') {
		return handleReject(requestId, parentNote, tenantId);
	}

	return json(
		{ error: 'action は "approve" または "reject" である必要があります' },
		{ status: 400 },
	);
};
