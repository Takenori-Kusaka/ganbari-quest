import { fail } from '@sveltejs/kit';
import { ConvertMode } from '$lib/domain/validation/point';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { getAllChildren } from '$lib/server/services/child-service';
import {
	convertPoints,
	getPointBalance,
	getPointHistory,
} from '$lib/server/services/point-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);
	const children = await getAllChildren(tenantId);
	const childrenWithBalance = await Promise.all(
		children.map(async (child) => {
			const balance = await getPointBalance(child.id, tenantId);
			if ('error' in balance) {
				logger.warn('[admin/points] ポイント取得フォールバック', {
					context: { childId: child.id, error: balance.error },
				});
			}
			// 変換履歴（type=convert）を取得
			const historyResult = await getPointHistory(child.id, { limit: 50, offset: 0 }, tenantId);
			const convertHistory = !('error' in historyResult)
				? historyResult.history.filter((h) => h.type === 'convert')
				: [];
			return {
				...child,
				balance: 'error' in balance ? null : balance,
				convertHistory,
			};
		}),
	);
	return { children: childrenWithBalance };
};

export const actions: Actions = {
	convert: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const amount = Number(formData.get('amount'));
		const mode = (formData.get('mode') as string) || ConvertMode.PRESET;

		if (!childId || !amount || amount < 1) {
			return fail(400, { error: '入力が不正です' });
		}

		if (!Number.isInteger(amount)) {
			return fail(400, { error: 'ポイントは整数で入力してください' });
		}

		// プリセットモードは500P単位の制約を維持
		if (mode === ConvertMode.PRESET && (amount < 500 || amount % 500 !== 0)) {
			return fail(400, { error: 'ポイントは500単位で変換できます' });
		}

		const result = await convertPoints(childId, amount, tenantId, mode as ConvertMode);
		if ('error' in result) {
			const messages: Record<string, string> = {
				NOT_FOUND: 'こどもが見つかりません',
				INSUFFICIENT_POINTS: 'ポイントが足りません',
				INVALID_AMOUNT: '金額が不正です',
			};
			return fail(400, { error: messages[result.error] ?? result.error });
		}

		return {
			converted: true,
			message: result.message,
			convertedAmount: result.convertedAmount,
			remainingBalance: result.remainingBalance,
		};
	},
};
