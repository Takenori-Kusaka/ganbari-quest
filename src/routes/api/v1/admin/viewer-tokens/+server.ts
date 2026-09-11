// POST /api/v1/admin/viewer-tokens — 閲覧トークン発行
// GET  /api/v1/admin/viewer-tokens — 閲覧トークン一覧
// (#371)

import { error, json } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import { createViewerToken, listViewerTokens } from '$lib/server/services/viewer-token-service';
import type { RequestHandler } from './$types';

async function requireFamily(locals: App.Locals): Promise<string> {
	const context = locals.context;
	if (!context) {
		throw error(401, '認証が必要です');
	}
	const tenantId = context.tenantId;
	const tier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
	);
	if (tier !== 'family') {
		throw error(403, { message: PLAN_GATE_LABELS.viewerTokenFamilyOnly });
	}
	return tenantId;
}

export const GET: RequestHandler = async ({ locals }) => {
	const tenantId = await requireFamily(locals);
	const tokens = await listViewerTokens(tenantId);
	// **`token` 列を一覧に載せない。** `/view/<token>` は `isPublicRoute`
	// (`authorization.ts:199`) の**無認証**ページで、家族全員のニックネーム・年齢・
	// ポイント・レベルを描く (`src/routes/view/[token]/+page.server.ts:31`)。
	// `duration:'unlimited'` は `expiresAt=null` で失効しないため、token は
	// 親 PIN gate も logout も越えて生き残る恒久的な資格になる。
	//
	// この GET は書き込みでも一括 PII 読み取りでもないので親 PIN gate の外
	// ([G2] 描画のための読み取り) にある。**描画に token は要らない** —
	// `/admin/members` の load は既にこの形で返しており
	// (`src/routes/(parent)/admin/members/+page.server.ts:69-76`)、
	// token は発行直後の POST 応答から 1 度だけリンクと QR に使う。
	return json({
		tokens: tokens.map((t) => ({
			id: t.id,
			label: t.label,
			expiresAt: t.expiresAt,
			createdAt: t.createdAt,
			revokedAt: t.revokedAt,
		})),
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const tenantId = await requireFamily(locals);

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ message: '不正なJSONです' }, { status: 400 });
	}

	const label = typeof body.label === 'string' ? body.label.slice(0, 50) : undefined;
	const validDurations = ['7d', '30d', 'unlimited'] as const;
	type Duration = (typeof validDurations)[number];
	const duration: Duration = validDurations.includes(body.duration as Duration)
		? (body.duration as Duration)
		: '30d';

	const token = await createViewerToken(tenantId, { label, duration });
	return json({ token }, { status: 201 });
};
