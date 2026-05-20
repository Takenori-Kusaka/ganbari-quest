// #2321 (EPIC #2319 ②): account グループの load + action。
// 旧 /admin/settings/+page.server.ts から OYAKAGI 関連 (changePin action) を移行。
// accountDelete / logout は client-side fetch + a href 遷移なので server action 不要。

import { fail } from '@sveltejs/kit';
import { OYAKAGI_LABELS } from '$lib/domain/labels';
import { requireTenantId } from '$lib/server/auth/factory';
import { changePin } from '$lib/server/services/auth-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// account は #1781 削除グレースピリオド bannar 用 data を $page.data から
	// 参照するため、ここでは追加 load 不要。
	return {};
};

export const actions = {
	changePin: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const currentPin = form.get('currentPin')?.toString() ?? '';
		const newPin = form.get('newPin')?.toString() ?? '';
		const confirmPin = form.get('confirmPin')?.toString() ?? '';

		if (!currentPin || !newPin || !confirmPin) {
			return fail(400, { error: 'すべてのフィールドを入力してください' });
		}

		if (newPin.length < 4 || newPin.length > 8) {
			return fail(400, { error: OYAKAGI_LABELS.formatError });
		}

		if (!/^\d+$/.test(newPin)) {
			return fail(400, { error: OYAKAGI_LABELS.numberOnlyError });
		}

		if (newPin !== confirmPin) {
			return fail(400, { error: `新しい${OYAKAGI_LABELS.name}が一致しません` });
		}

		const result = await changePin(currentPin, newPin, tenantId);
		if ('error' in result) {
			if (result.error === 'INVALID_CURRENT_PIN') {
				return fail(400, { error: `現在の${OYAKAGI_LABELS.name}が正しくありません` });
			}
			if (result.error === 'LOCKED_OUT') {
				return fail(429, { error: OYAKAGI_LABELS.lockedError });
			}
		}

		return { success: true };
	},
} satisfies Actions;
