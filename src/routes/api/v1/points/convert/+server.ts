import { json } from '@sveltejs/kit';
import { ConvertMode, convertPointsSchema } from '$lib/domain/validation/point';
import { requireChildAccess } from '$lib/server/auth/factory';
import { parentGateResponse } from '$lib/server/auth/owner-gate';
import { apiError, validationError } from '$lib/server/errors';
import { convertPoints } from '$lib/server/services/point-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const body = await request.json();
	// mode が未指定の場合はプリセットとして扱う（後方互換）
	const input = { mode: ConvertMode.PRESET, ...body };
	const parsed = convertPointsSchema.safeParse(input);
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}
	// PO 決裁 2026-09-10 決定 6: **親限定**。ポイントを現金・金券に換える操作で、
	// 家庭のお金が動く。子供が自分のポイントを勝手に換金できる状態にしておく理由が無い
	// (交換の申請は `reward-redemption-requests` 側にあり、そこは子供が使う)。
	// role 判定は単一 seam 経由 (#3528)。
	const roleGate = parentGateResponse(locals);
	if (roleGate) return roleGate;
	// childId は **body** で来る。親が他テナントの子 id を渡す経路も塞ぐ (tenant 跨ぎの IDOR)。
	requireChildAccess(locals, parsed.data.childId);

	const result = await convertPoints(
		parsed.data.childId,
		parsed.data.amount,
		tenantId,
		parsed.data.mode,
	);

	if ('error' in result) {
		if (result.error === 'NOT_FOUND') {
			return apiError('NOT_FOUND', 'こどもがみつかりません');
		}
		if (result.error === 'INSUFFICIENT_POINTS') {
			return apiError('INSUFFICIENT_POINTS', 'ポイントがたりません');
		}
	}

	return json(result);
};
