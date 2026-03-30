import { requireTenantId } from '$lib/server/auth/factory';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	STAMP_PRESETS,
	getMessageHistory,
	sendMessage,
} from '$lib/server/services/message-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);

	const childrenWithMessages = await Promise.all(
		children.map(async (child) => {
			const messages = await getMessageHistory(child.id, tenantId, 5);
			return { ...child, recentMessages: messages };
		}),
	);

	return { children: childrenWithMessages, stamps: STAMP_PRESETS };
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

		if (messageType === 'stamp' && !stampCode) {
			return fail(400, { error: 'スタンプを選択してください' });
		}
		if (messageType === 'text' && !body) {
			return fail(400, { error: 'メッセージを入力してください' });
		}
		if (messageType === 'text' && body.length > 30) {
			return fail(400, { error: 'メッセージは30文字以内で入力してください' });
		}

		const result = await sendMessage(
			{
				childId,
				messageType,
				stampCode: messageType === 'stamp' ? stampCode : null,
				body: messageType === 'text' ? body : null,
			},
			tenantId,
		);

		return { sent: true, message: result };
	},
};
