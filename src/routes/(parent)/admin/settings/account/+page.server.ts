// #2321 (EPIC #2319 ②): account グループの load + action。
// 旧 /admin/settings/+page.server.ts から OYAKAGI 関連 (changePin action) を移行。
// accountDelete / logout は client-side fetch + a href 遷移なので server action 不要。

import { fail } from '@sveltejs/kit';
import { isValidPinFormat } from '$lib/domain/constants/oyakagi';
import { OYAKAGI_LABELS, SETTINGS_LABELS } from '$lib/domain/labels';
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
			return fail(400, { error: SETTINGS_LABELS.oyakagiAllFieldsRequired });
		}

		// #4661 / #4698: 桁数は constants/oyakagi.ts の PIN_LENGTH が SSOT。以前ここだけが 4〜8 桁を
		// 受理していたため、5 桁以上に変更すると /switch の入力欄 (ちょうど 4 桁) から二度と
		// 送れず見守り画面に入れなくなった。入口 (PinInput) と同じ形式でしか受け付けない。
		// currentPin は桁数検証しない — 旧ポリシーで 5〜8 桁を保存した世帯が、現コードを入れて
		// 4 桁へ移行できる救済経路を残すため (#4698 AC3)。
		if (!/^\d+$/.test(newPin)) {
			return fail(400, { error: OYAKAGI_LABELS.numberOnlyError });
		}

		if (!isValidPinFormat(newPin)) {
			return fail(400, { error: OYAKAGI_LABELS.formatError });
		}

		if (newPin !== confirmPin) {
			return fail(400, { error: OYAKAGI_LABELS.confirmMismatchError });
		}

		const result = await changePin(currentPin, newPin, tenantId);
		if ('error' in result) {
			if (result.error === 'INVALID_CURRENT_PIN') {
				return fail(400, { error: OYAKAGI_LABELS.currentInvalidError });
			}
			if (result.error === 'LOCKED_OUT') {
				return fail(429, { error: OYAKAGI_LABELS.lockedError });
			}
		}

		return { success: true };
	},
} satisfies Actions;
