// #2321 (EPIC #2319 ②): account グループの load + action。
// 旧 /admin/settings/+page.server.ts から OYAKAGI 関連 (changePin action) を移行。
// accountDelete / logout は client-side fetch + a href 遷移なので server action 不要。

import { fail } from '@sveltejs/kit';
import { OYAKAGI_LABELS } from '$lib/domain/labels';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '$lib/domain/validation/auth';
import { requireTenantId } from '$lib/server/auth/factory';
import { changePin } from '$lib/server/services/auth-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// account は #1781 削除グレースピリオド banner 用 data を $page.data から
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
			return fail(400, { error: OYAKAGI_LABELS.allFieldsRequiredError });
		}

		// #4716 item 15: 旧実装は 4〜8 桁を受理していたが、/login の PIN 入力は
		// PIN_MAX_LENGTH (6) 桁固定セルであり 7〜8 桁を設定すると再ログインできなくなる。
		// 画面ラベル・pinSchema・本 action の 3 者を PIN_MIN_LENGTH〜PIN_MAX_LENGTH に揃える。
		if (newPin.length < PIN_MIN_LENGTH || newPin.length > PIN_MAX_LENGTH) {
			return fail(400, { error: OYAKAGI_LABELS.formatError });
		}

		if (!/^\d+$/.test(newPin)) {
			return fail(400, { error: OYAKAGI_LABELS.numberOnlyError });
		}

		if (newPin !== confirmPin) {
			return fail(400, { error: OYAKAGI_LABELS.mismatchError });
		}

		const result = await changePin(currentPin, newPin, tenantId);
		if ('error' in result) {
			if (result.error === 'INVALID_CURRENT_PIN') {
				return fail(400, { error: OYAKAGI_LABELS.currentPinInvalidError });
			}
			if (result.error === 'LOCKED_OUT') {
				return fail(429, { error: OYAKAGI_LABELS.lockedError });
			}
		}

		return { success: true };
	},
} satisfies Actions;
