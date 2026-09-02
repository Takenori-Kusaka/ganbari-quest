// src/routes/(parent)/admin/cheer/+page.server.ts
// 応援機能 (cheer) — EPIC #2266 / Issue #2267
//
// PO 定義 (2026-05-19): 「応援 = 任意の理由で直接子供にポイント付与 (運動会一位等)、
// スタンプ/メッセージは P 付与に付随する理由表現」。
// 旧 /admin/messages はスタンプ/テキストのみ (P 付与なし) で存在意義なし → 本機能に統合。

import { fail } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { getErrorMessage } from '$lib/domain/errors';
import { formIdString } from '$lib/domain/form-value';
import { isFreeTextMessageUnlocked } from '$lib/domain/free-text-message-gate';
import { asChildId } from '$lib/domain/ids';
// #4512: エラー文言は labels SSOT 経由 (docs/DESIGN.md §6 / ADR-0045)。
// 上限値そのものは cheer-service.ts が SSOT で、labels 側は引数で受ける。
import { ADMIN_FORM_ERROR_LABELS, CHEER_LABELS } from '$lib/domain/labels';
import { requireTenantId } from '$lib/server/auth/factory';
import {
	CHEER_CATEGORIES,
	CHEER_POINTS_MAX,
	CHEER_POINTS_MIN,
	CHEER_REASON_MAX_LENGTH,
	type CheerCategory,
	grantCheer,
} from '$lib/server/services/cheer-service';
import { getAllChildren } from '$lib/server/services/child-service';
import { getMessageHistory, STAMP_PRESETS } from '$lib/server/services/message-service';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);
	// #4504: 自由テキストのロック表示に使う。UI と server が同じ述語 (isFreeTextMessageUnlocked)
	// を読むようにして、表示と認可がずれた状態を作れなくする (ai-suggest-gate と同型)。
	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const planTier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);

	const childrenWithMessages = await Promise.all(
		children.map(async (child) => {
			const messages = await getMessageHistory(child.id, tenantId, 10);
			return { ...child, recentMessages: messages };
		}),
	);

	return {
		children: childrenWithMessages,
		planTier,
		stamps: STAMP_PRESETS,
		categories: CHEER_CATEGORIES,
		reasonMaxLength: CHEER_REASON_MAX_LENGTH,
		pointsMin: CHEER_POINTS_MIN,
		pointsMax: CHEER_POINTS_MAX,
	};
};

// 入力バリデーションエラーメッセージ表 (route + service 層で共通利用)
const POINTS_ERROR_MSG = CHEER_LABELS.errorPointsRange(CHEER_POINTS_MIN, CHEER_POINTS_MAX);
const REASON_TOO_LONG_MSG = CHEER_LABELS.errorReasonTooLong(CHEER_REASON_MAX_LENGTH);

/** form input をパースして validation 結果を返す (フォーム / service 層エラーいずれにも対応する分岐回避) */
function parseAndValidateForm(
	formData: FormData,
):
	| { ok: true; data: Parameters<typeof grantCheer>[0] }
	| { ok: false; status: 400 | 404; error: string } {
	const childId = asChildId(formIdString(formData.get('childId')));
	const reason = String(formData.get('reason') ?? '').trim();
	const points = Number(formData.get('points'));
	const category = String(formData.get('category') ?? '');
	const icon = String(formData.get('icon') ?? '🎉');
	const stampCodeRaw = String(formData.get('stampCode') ?? '').trim();
	const bodyRaw = String(formData.get('body') ?? '').trim();

	if (!childId || childId === asChildId(0))
		return { ok: false, status: 400, error: CHEER_LABELS.errorChildRequired };
	if (!reason) return { ok: false, status: 400, error: CHEER_LABELS.errorReasonRequired };
	if (reason.length > CHEER_REASON_MAX_LENGTH) {
		return { ok: false, status: 400, error: REASON_TOO_LONG_MSG };
	}
	if (!Number.isFinite(points) || points < CHEER_POINTS_MIN || points > CHEER_POINTS_MAX) {
		return { ok: false, status: 400, error: POINTS_ERROR_MSG };
	}
	if (!CHEER_CATEGORIES.includes(category as CheerCategory)) {
		return { ok: false, status: 400, error: CHEER_LABELS.errorCategoryRequired };
	}
	return {
		ok: true,
		data: {
			childId,
			reason,
			points,
			category,
			icon,
			stampCode: stampCodeRaw || null,
			body: bodyRaw || null,
		},
	};
}

const SERVICE_ERROR_MESSAGES: Record<string, { status: 400 | 404; message: string }> = {
	NOT_FOUND: { status: 404, message: CHEER_LABELS.errorChildNotFound },
	INVALID_REASON: { status: 400, message: CHEER_LABELS.errorReasonRequired },
	INVALID_POINTS: { status: 400, message: POINTS_ERROR_MSG },
	INVALID_CATEGORY: { status: 400, message: CHEER_LABELS.errorCategoryRequired },
};

export const actions: Actions = {
	grant: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();

		const validation = parseAndValidateForm(formData);
		if (!validation.ok) {
			return fail(validation.status, { error: validation.error });
		}

		// #4504: 入力欄を隠すだけでは form を直接 POST されると素通しするため server で強制する。
		// スタンプ (stampCode) とポイント付与は全プランのままで、落とすのは body だけ。
		if (validation.data.body) {
			const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
			const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
			if (!isFreeTextMessageUnlocked(tier)) {
				return fail(403, { error: CHEER_LABELS.freeTextLockedNote });
			}
		}

		const result = await grantCheer(validation.data, tenantId);

		if ('error' in result) {
			const mapped = SERVICE_ERROR_MESSAGES[result.error];
			if (mapped) {
				return fail(mapped.status, {
					error: mapped.status === 404 ? getErrorMessage(mapped.message) : mapped.message,
				});
			}
			return fail(400, { error: ADMIN_FORM_ERROR_LABELS.genericError });
		}

		return {
			granted: true,
			points: validation.data.points,
			reason: validation.data.reason,
			category: validation.data.category,
			icon: validation.data.icon,
		};
	},
};
