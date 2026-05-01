// src/routes/api/v1/admin/account/delete/+server.ts
// 統一アカウント削除エンドポイント (#458, #1781)
// pattern パラメータで4つの削除パターンを分岐
//
// #1781: owner-only / owner-full-delete はプラン別グレースピリオドを適用する。
//   - free       → 即時物理削除（従来動作）
//   - standard   → 7 日 soft-delete（settings に soft_deleted_at 等を記録 + Stripe キャンセル）
//   - family     → 30 日 soft-delete（同上）
// 物理削除は cron `/api/cron/grace-period-deletion` が `purgeExpiredSoftDeletedTenants`
// 経由で実行する。

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { logger } from '$lib/server/logger';
import {
	deleteChildAccount,
	deleteMemberAccount,
	deleteOwnerFullDelete,
	deleteOwnerOnlyAccount,
	transferOwnershipAndLeave,
} from '$lib/server/services/account-deletion-service';
import { softDeleteTenant } from '$lib/server/services/grace-period-service';
import { cancelSubscription } from '$lib/server/services/stripe-service';

interface DeleteRequestBody {
	pattern: 'owner-only' | 'owner-with-transfer' | 'owner-full-delete' | 'child' | 'member';
	/** Pattern 2a のみ: 移譲先ユーザーID */
	newOwnerId?: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 複雑なビジネスロジックのため、別 Issue でリファクタ予定
export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	const identity = locals.identity;

	if (!context || !identity || identity.type !== 'cognito') {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const tenantId = context.tenantId;

	let body: DeleteRequestBody;
	try {
		body = (await request.json()) as DeleteRequestBody;
	} catch {
		return json({ error: 'リクエストボディが不正です' }, { status: 400 });
	}

	const { pattern, newOwnerId } = body;

	if (!pattern) {
		return json({ error: 'pattern パラメータが必要です' }, { status: 400 });
	}

	try {
		switch (pattern) {
			case 'owner-only': {
				if (context.role !== 'owner') {
					return json({ error: 'owner のみ実行できます' }, { status: 403 });
				}

				// #1781: プラン別グレースピリオド配線。
				// soft-delete 経路に進むかは plan tier で決まる（free=即時 / standard=7d / family=30d）。
				const soft = await softDeleteTenant(
					tenantId,
					context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
					context.plan,
				);

				if (!soft.requiresImmediateDeletion) {
					// 有料プラン: Stripe を即キャンセルして請求停止 (ADR-0022)、
					// データはグレースピリオド期間中保持（cron が物理削除）。
					await cancelSubscription(tenantId);
					logger.info('[account-delete] Pattern 1 soft-deleted (grace period)', {
						context: {
							tenantId,
							gracePeriodDays: soft.gracePeriodDays,
							physicalDeletionDate: soft.physicalDeletionDate,
						},
					});
					return json({
						success: true,
						pattern: 'owner-only',
						softDeleted: true,
						gracePeriodDays: soft.gracePeriodDays,
						physicalDeletionDate: soft.physicalDeletionDate,
					});
				}

				// free プラン: 即時物理削除
				const result = await deleteOwnerOnlyAccount(tenantId, identity.userId);
				logger.info('[account-delete] Pattern 1 完了 (immediate deletion / free)', {
					context: { tenantId },
				});
				return json({ ...result, softDeleted: false });
			}

			case 'owner-with-transfer': {
				if (context.role !== 'owner') {
					return json({ error: 'owner のみ実行できます' }, { status: 403 });
				}
				if (!newOwnerId) {
					return json({ error: '移譲先 (newOwnerId) が必要です' }, { status: 400 });
				}
				const result = await transferOwnershipAndLeave(tenantId, identity.userId, newOwnerId);
				logger.info('[account-delete] Pattern 2a 完了', {
					context: { tenantId, newOwnerId },
				});
				return json(result);
			}

			case 'owner-full-delete': {
				if (context.role !== 'owner') {
					return json({ error: 'owner のみ実行できます' }, { status: 403 });
				}

				// #1781: 全削除パターンも同様にグレースピリオドを適用する。
				// 有料プランでは soft-delete のみ実施し、cron が物理削除時に
				// 全メンバーの Cognito 削除と他メンバーへのメール通知を行う。
				const soft = await softDeleteTenant(
					tenantId,
					context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
					context.plan,
				);

				if (!soft.requiresImmediateDeletion) {
					// 有料プラン: Stripe を即キャンセルしてデータ保持（cron が物理削除）。
					// 他メンバーへのメール通知も物理削除時にまとめて行う（restore 可能性を残すため）。
					await cancelSubscription(tenantId);
					logger.info('[account-delete] Pattern 2b soft-deleted (grace period)', {
						context: {
							tenantId,
							gracePeriodDays: soft.gracePeriodDays,
							physicalDeletionDate: soft.physicalDeletionDate,
						},
					});
					return json({
						success: true,
						pattern: 'owner-full-delete',
						softDeleted: true,
						gracePeriodDays: soft.gracePeriodDays,
						physicalDeletionDate: soft.physicalDeletionDate,
					});
				}

				// free プラン: 即時物理削除
				const result = await deleteOwnerFullDelete(tenantId, identity.userId);
				logger.info('[account-delete] Pattern 2b 完了 (immediate deletion / free)', {
					context: { tenantId },
				});
				return json({ ...result, softDeleted: false });
			}

			case 'child': {
				// child は自分自身を削除のみ。owner が child パターンを使うのは禁止
				// （owner は owner-only / owner-with-transfer / owner-full-delete を使用すべき）
				if (context.role === 'owner') {
					return json({ error: 'Owner cannot use child deletion pattern' }, { status: 403 });
				}
				if (context.role !== 'child') {
					return json({ error: 'child 本人のみ実行できます' }, { status: 403 });
				}
				const result = await deleteChildAccount(tenantId, identity.userId);
				logger.info('[account-delete] Pattern 3 完了', { context: { tenantId } });
				return json(result);
			}

			case 'member': {
				// parent(非owner) は自分自身を削除。owner / child は使用不可
				if (context.role === 'owner') {
					return json(
						{
							error:
								'owner はこのパターンで削除できません。owner-only または owner-with-transfer を使用してください。',
						},
						{ status: 400 },
					);
				}
				if (context.role !== 'parent') {
					return json({ error: 'Only parent/owner can use member deletion' }, { status: 403 });
				}
				const result = await deleteMemberAccount(tenantId, identity.userId);
				logger.info('[account-delete] Pattern 4 完了', { context: { tenantId } });
				return json(result);
			}

			default:
				return json({ error: `不明な pattern: ${pattern}` }, { status: 400 });
		}
	} catch (err) {
		logger.error('[account-delete] 削除処理失敗', {
			error: String(err),
			context: { tenantId, pattern },
		});
		return json(
			{ error: err instanceof Error ? err.message : 'アカウント削除に失敗しました' },
			{ status: 500 },
		);
	}
};
