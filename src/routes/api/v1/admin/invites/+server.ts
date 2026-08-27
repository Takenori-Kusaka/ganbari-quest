// POST /api/v1/admin/invites — 招待リンク作成
// GET  /api/v1/admin/invites — 招待一覧取得
// (#0129, #1111)

import { error, json } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { OWNER_GATE_LABELS, PLAN_GATE_LABELS } from '$lib/domain/labels';
import { createInviteSchema } from '$lib/domain/validation/auth';
import { requireAppUserId } from '$lib/server/auth/guards';
import { ownerGateResponse } from '$lib/server/auth/owner-gate';
import { validationError } from '$lib/server/errors';
import { createInvite, listInvites } from '$lib/server/services/invite-service';
import { checkFamilyMemberLimit } from '$lib/server/services/plan-limit-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const invites = await listInvites(tenantId);
	return json({ invites });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;

	// #3549 決裁 (a): 招待作成は owner 専用。#3726 (= #3673 same-class): 401→401 / 403→403 変換と
	// 文言 SSOT (OWNER_GATE_LABELS) を ownerGateResponse helper に集約 (401 の 500 化退行を構造排除)
	// #3552 ②: role-mutation の 403 拒否は監査ログに残す (招待濫用試行の追跡)。
	const gate = ownerGateResponse(locals, OWNER_GATE_LABELS.inviteCreate, {
		auditAction: 'invites.create',
	});
	if (gate) return gate;

	const identity = locals.identity;
	if (!identity || identity.type !== 'cognito') {
		error(401, 'Unauthorized');
	}
	// #4643: invites.invited_by は users.user_id。IdP の sub を入れていたため、受諾側の
	// 自己招待 guard (invite.invitedBy === userId) が一度も成立していなかった。
	const userId = requireAppUserId(locals);

	const body = await request.json();
	const parsed = createInviteSchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	// #1111: プラン別メンバー上限チェック
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const memberLimit = await checkFamilyMemberLimit(tenantId, licenseStatus);
	if (!memberLimit.allowed) {
		return json(
			{
				error: 'MEMBER_LIMIT_REACHED',
				// #4622: PlanLimitCheck が discriminated union になり、!allowed 側で max は number に確定する。
				// 旧 `?? 0` fallback は「メンバー上限（0人）」という別の嘘を出しうるため撤去した。
				message: PLAN_GATE_LABELS.memberLimitReached(memberLimit.max),
				current: memberLimit.current,
				max: memberLimit.max,
			},
			{ status: 403 },
		);
	}

	const invite = await createInvite(
		tenantId,
		userId,
		parsed.data.role,
		parsed.data.childId,
		parsed.data.email,
	);

	return json({ invite }, { status: 201 });
};
