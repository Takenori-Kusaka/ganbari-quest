import { getAllChildren } from '$lib/server/services/child-service';
import { convertPoints, getPointBalance } from '$lib/server/services/point-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const children = getAllChildren();
	const childrenWithBalance = children.map((child) => {
		const balance = getPointBalance(child.id);
		return {
			...child,
			balance: 'error' in balance ? null : balance,
		};
	});
	return { children: childrenWithBalance };
};

export const actions: Actions = {
	convert: async ({ request }) => {
		const formData = await request.formData();
		const childId = Number(formData.get('childId'));
		const amount = Number(formData.get('amount'));

		if (!childId || !amount) {
			return fail(400, { error: '入力が不正です' });
		}

		if (amount < 500 || amount % 500 !== 0) {
			return fail(400, { error: 'ポイントは500単位で変換できます' });
		}

		const result = convertPoints(childId, amount);
		if ('error' in result) {
			const messages: Record<string, string> = {
				NOT_FOUND: 'こどもが見つかりません',
				INSUFFICIENT_BALANCE: 'ポイントが足りません',
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
