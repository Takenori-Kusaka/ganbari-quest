import { fail } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { createPlanLimitError } from '$lib/domain/errors';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import {
	MESSAGE_TEXT_MAX_LENGTH,
	SENDABLE_MESSAGE_TYPES,
	type SendableMessageType,
} from '$lib/domain/validation/message';
import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	getMessageHistory,
	STAMP_PRESETS,
	sendMessage,
} from '$lib/server/services/message-service';
import { getPlanLimits, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const parentData = await parent();
	const planTier = parentData.planTier ?? 'free';
	const limits = getPlanLimits(planTier);

	// ADR-0039 Phase 2 (#2097): デモ実行モード時は demo data。
	if (locals.isDemo) {
		const { DEMO_CHILDREN: demoChildren } = await import('$lib/server/demo/demo-data');
		return {
			children: demoChildren.map((c) => ({ ...c, recentMessages: [] })),
			stamps: STAMP_PRESETS,
			canFreeTextMessage: limits.canFreeTextMessage,
			planTier,
		};
	}

	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);

	const childrenWithMessages = await Promise.all(
		children.map(async (child) => {
			const messages = await getMessageHistory(child.id, tenantId, 5);
			return { ...child, recentMessages: messages };
		}),
	);

	return {
		children: childrenWithMessages,
		stamps: STAMP_PRESETS,
		canFreeTextMessage: limits.canFreeTextMessage,
		planTier,
	};
};

export const actions: Actions = {
	send: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const messageType = String(formData.get('messageType') ?? 'stamp');
		const stampCode = String(formData.get('stampCode') ?? '');
		const body = String(formData.get('body') ?? '').trim();

		if (!childId) return fail(400, { error: 'こどもを選択してください' });

		// messageType バリデーション: stamp / text のみ許可
		if (!(SENDABLE_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
			return fail(400, { error: 'メッセージ種別が不正です' });
		}
		const validType = messageType as SendableMessageType;

		if (validType === 'stamp' && !stampCode) {
			return fail(400, { error: 'スタンプを選択してください' });
		}
		if (validType === 'text') {
			// PLAN_LABELS.family 限定チェック（トライアル状態も考慮）
			const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
			const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
			const limits = getPlanLimits(tier);
			if (!limits.canFreeTextMessage) {
				// #787: PlanLimitError 形式に統一 / #1932: PLAN_GATE_LABELS 経由で SSOT 化
				return fail(403, {
					error: createPlanLimitError(
						tier,
						'family',
						PLAN_GATE_LABELS.familyLimitedFor('自由テキストメッセージ'),
					),
				});
			}
			if (!body) {
				return fail(400, { error: 'メッセージを入力してください' });
			}
			if (body.length > MESSAGE_TEXT_MAX_LENGTH) {
				return fail(400, {
					error: `メッセージは${MESSAGE_TEXT_MAX_LENGTH}文字以内で入力してください`,
				});
			}
		}

		const result = await sendMessage(
			{
				childId,
				messageType: validType,
				stampCode: validType === 'stamp' ? stampCode : null,
				body: validType === 'text' ? body : null,
			},
			tenantId,
		);

		return { sent: true, message: result };
	},
};
