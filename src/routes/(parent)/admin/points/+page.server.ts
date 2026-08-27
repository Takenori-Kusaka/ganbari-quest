import { fail } from '@sveltejs/kit';
import { formIdString } from '$lib/domain/form-value';
import { asChildId } from '$lib/domain/ids';
import { ConvertMode } from '$lib/domain/validation/point';
import { requireTenantId } from '$lib/server/auth/factory';
import { logger } from '$lib/server/logger';
import { getAllChildren } from '$lib/server/services/child-service';
import { resolveMaxBase64DecodedBytes } from '$lib/server/services/function-url-limit';
import { toDisplayMb } from '$lib/server/services/import-limit';
import {
	convertPoints,
	getConvertSummary,
	getPointBalance,
} from '$lib/server/services/point-service';
import { RECEIPT_MAX_IMAGE_BYTES } from '$lib/server/services/receipt-ocr-service';
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
			// #4682 F2: 変換履歴と累計は DB 側で絞る / 合計する。
			// 旧実装は「直近 50 行の台帳」を取ってから convert を filter していたため、
			// 活動が多い子では変換履歴セクションと累計が丸ごと消えていた。
			const summary = await getConvertSummary(child.id, tenantId);
			if ('error' in summary) {
				logger.warn('[admin/points] 変換履歴取得フォールバック', {
					context: { childId: child.id, error: summary.error },
				});
			}
			return {
				...child,
				balance: 'error' in balance ? null : balance,
				convertHistory: 'error' in summary ? [] : summary.history,
				convertTotals:
					'error' in summary
						? { allTime: 0, thisMonth: 0, lastMonth: 0 }
						: {
								allTime: summary.allTimeTotal,
								thisMonth: summary.thisMonthTotal,
								lastMonth: summary.lastMonthTotal,
							},
			};
		}),
	);
	// #3775 ②: 領収書撮影ボタン note が「実効の受理上限」と一致するよう、OCR route と同一の
	// 実効値 (aws-prod ~4.1MB / NUC・local 5MB) を server 側で解決して渡す。
	const maxReceiptImageMb = String(
		toDisplayMb(resolveMaxBase64DecodedBytes(RECEIPT_MAX_IMAGE_BYTES)),
	);

	return { children: childrenWithBalance, maxReceiptImageMb };
};

export const actions: Actions = {
	convert: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const childId = asChildId(formIdString(formData.get('childId')));
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
