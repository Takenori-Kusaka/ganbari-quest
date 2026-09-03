// src/routes/api/v1/children/[id]/activities/[activityId]/pin/+server.ts
// 活動ピン留めトグルAPI

import { json } from '@sveltejs/kit';
import { asActivityId, asChildId } from '$lib/domain/ids';
import { OWNER_GATE_LABELS } from '$lib/domain/labels';
import { apiError, type ErrorCode } from '$lib/server/errors';
import {
	ActivityPinError,
	type ActivityPinErrorCode,
	toggleActivityPin,
} from '$lib/server/services/activity-pin-service';
import type { RequestHandler } from './$types';

/**
 * service 層の拒否理由 → API のエラー種別 (ADR-0062、PO 回答 2026-09-03 §4 #2 follow-up)。
 *
 * 旧実装は `ActivityPinError` を code に関わらず `VALIDATION_ERROR` (400) に畳んでいた。
 * そのため **この endpoint は `NOT_FOUND` を返せず**、client は「上限」という顧客向け文言の
 * 部分一致で上限超過を見分けるしかなかった (文言を変えた瞬間に外れる)。code を 1:1 で写像し、
 * client が `error.code` だけで分岐できるようにする。
 *
 * `Record<ActivityPinErrorCode, ErrorCode>` なので、service に拒否理由を足すと**ここが
 * コンパイルエラーになる** (分類漏れが黙って 400 に落ちない)。同型の先例:
 * `src/routes/api/v1/import/cloud/+server.ts` の `FETCH_FAILURE_TO_ERROR_CODE`。
 */
const PIN_ERROR_TO_ERROR_CODE: Record<ActivityPinErrorCode, ErrorCode> = {
	ACTIVITY_NOT_FOUND: 'NOT_FOUND',
	PIN_LIMIT_EXCEEDED: 'PIN_LIMIT_EXCEEDED',
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const context = locals.context;
	if (!context) {
		// PO 回答 (2026-09-03) §4 #2 / ADR-0062: 401 も他のエラーと同じ統一形
		// ({ error: { code, message, userMessage, severity, action } }) で返す。旧実装は
		// error が文字列だけの独自形を直接 json で組んでいて、client の `error.code` 分岐に
		// 乗らず、文言も labels SSOT を経由していなかった。
		return apiError('UNAUTHORIZED', OWNER_GATE_LABELS.authRequired);
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.id);
	const activityId = asActivityId(params.activityId);

	if (!childId || !activityId) {
		return apiError('VALIDATION_ERROR', '不正なIDです');
	}

	let pinned = true;
	try {
		const body = await request.json();
		pinned = body.pinned !== false;
	} catch {
		// body なしの場合はピン留めとして扱う
	}

	try {
		const result = await toggleActivityPin(childId, activityId, pinned, tenantId);
		return json(result);
	} catch (err) {
		// #4716 / ADR-0062: 拒否理由 (ActivityPinError) のみ返し、想定外例外の内部 message は返さない。
		if (err instanceof ActivityPinError) {
			return apiError(PIN_ERROR_TO_ERROR_CODE[err.code], err.message);
		}
		// #4716 (QM): 想定外例外を VALIDATION_ERROR に畳むと、DB 障害が「入力内容に問題があります」
		// という 400 になり、顧客には誤った原因が出て運用側は warn 1 行しか残らない。
		// 種別 (顧客の入力ミス / システム障害) を取り違えないよう INTERNAL_ERROR (500) に倒す。
		return apiError('INTERNAL_ERROR', 'ピン留めに失敗しました', {
			childId,
			activityId,
			cause: err instanceof Error ? err.message : String(err),
		});
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		// PO 回答 (2026-09-03) §4 #2 / ADR-0062: 401 も他のエラーと同じ統一形
		// ({ error: { code, message, userMessage, severity, action } }) で返す。旧実装は
		// error が文字列だけの独自形を直接 json で組んでいて、client の `error.code` 分岐に
		// 乗らず、文言も labels SSOT を経由していなかった。
		return apiError('UNAUTHORIZED', OWNER_GATE_LABELS.authRequired);
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.id);
	const activityId = asActivityId(params.activityId);

	if (!childId || !activityId) {
		return apiError('VALIDATION_ERROR', '不正なIDです');
	}

	try {
		const result = await toggleActivityPin(childId, activityId, false, tenantId);
		return json(result);
	} catch (err) {
		if (err instanceof ActivityPinError) {
			return apiError(PIN_ERROR_TO_ERROR_CODE[err.code], err.message);
		}
		// POST 側と同じ理由で、想定外例外は 400 ではなく INTERNAL_ERROR (500) に倒す。
		return apiError('INTERNAL_ERROR', 'ピン留め解除に失敗しました', {
			childId,
			activityId,
			cause: err instanceof Error ? err.message : String(err),
		});
	}
};
