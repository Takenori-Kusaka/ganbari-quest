import { json } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { isFreeTextMessageUnlocked } from '$lib/domain/free-text-message-gate';
import { CHEER_LABELS, PLAN_GATE_LABELS } from '$lib/domain/labels';
import { messageQuerySchema, sendMessageSchema } from '$lib/domain/validation/message';
import { planLimitError, validationError } from '$lib/server/errors';
import {
	getMessageHistory,
	getUnshownMessage,
	getUnshownMessageCount,
	sendMessage,
} from '$lib/server/services/message-service';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const parsed = messageQuerySchema.safeParse({ childId: params.childId });
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? 'パラメータが不正です');
	}

	const mode = url.searchParams.get('mode');

	if (mode === 'unshown') {
		const message = await getUnshownMessage(parsed.data.childId, tenantId);
		const count = await getUnshownMessageCount(parsed.data.childId, tenantId);
		return json({ message: message ?? null, unshownCount: count });
	}

	const limit = Number(url.searchParams.get('limit') ?? '20');
	const messages = await getMessageHistory(parsed.data.childId, tenantId, limit);
	return json({ messages });
};

export const POST: RequestHandler = async ({ request, params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const body = await request.json();

	const parsed = sendMessageSchema.safeParse({
		...body,
		childId: params.childId,
	});
	if (!parsed.success) {
		return validationError(parsed.error.issues[0]?.message ?? '入力が不正です');
	}

	// #4504: 自由テキストは premium 限定 (LP の訴求どおり)。UI を隠すだけでは直接 POST を
	// 素通しするため server で強制する (AI 提案の validateSuggestRequest と同型)。
	// 定型スタンプ (`messageType: 'stamp'`) は全プランのままにする。
	if (parsed.data.messageType === 'text') {
		const licenseStatus = context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
		const tier = await resolveFullPlanTier(tenantId, licenseStatus, context.plan);
		if (!isFreeTextMessageUnlocked(tier)) {
			// #4710: 自由テキストは premium 限定。要求 tier を伴わない 403 は
			// 「スタンダード以上でご利用いただけます」しか言えず、既にスタンダードな顧客が
			// 次の行動を選べない。planLimitError で要求 tier を明示する。
			return planLimitError(
				'family',
				PLAN_GATE_LABELS.familyOnlyFor(CHEER_LABELS.freeTextFeatureName),
				{ tenantId, tier },
			);
		}
	}

	const message = await sendMessage(parsed.data, tenantId);
	return json(message, { status: 201 });
};
