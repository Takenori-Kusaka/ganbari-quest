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

// #3320: 承認/却下した保護者の認証 userId を監査証跡 (resolved_by_parent_id) に記録する。
// cognito / anonymous(demo) は userId(sub) を持つ。local 実行モードは null (= 解決者不明)。
function resolverUserId(locals: App.Locals): string | null {
	const id = locals.identity;
	if (id && (id.type === 'cognito' || id.type === 'anonymous')) return id.userId;
	return null;
}

async function handleApprove(requestId: number, tenantId: string, parentUserId: string | null) {
	// #3320: 認証済み identity の userId を監査証跡として記録 (旧: 0 ハードコード)
	const result = await approveRedemption(requestId, parentUserId, tenantId);
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

async function handleReject(
	requestId: number,
	parentNote: string | undefined,
	tenantId: string,
	parentUserId: string | null,
) {
	const note = typeof parentNote === 'string' ? parentNote : null;
	const result = await rejectRedemption(requestId, note, tenantId, parentUserId);
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

	const parentUserId = resolverUserId(locals);

	if (action === 'approve') {
		return handleApprove(requestId, tenantId, parentUserId);
	}

	if (action === 'reject') {
		return handleReject(requestId, parentNote, tenantId, parentUserId);
	}

	return json(
		{ error: 'action は "approve" または "reject" である必要があります' },
		{ status: 400 },
	);
};
