// src/routes/api/v1/admin/account/delete/+server.ts
// 統一アカウント削除エンドポイント (#458, #1781)
// pattern パラメータで5つの削除パターンを分岐
// (owner-only / owner-with-transfer / owner-full-delete / child / member)
//
// #1781: owner-only / owner-full-delete はプラン別グレースピリオドを適用する。
//   - free       → 即時物理削除（従来動作）
//   - standard   → 7 日 soft-delete（settings に soft_deleted_at 等を記録 + Stripe キャンセル）
//   - family     → 30 日 soft-delete（同上）
// 物理削除は cron `/api/cron/grace-period-deletion` が `purgeExpiredSoftDeletedTenants`
// 経由で実行する。
//
// トランザクション順序（#1811 Re-Review 修正）:
// 有料プランの soft-delete 経路では Stripe キャンセルを **先に** 実行し、成功した場合のみ
// settings への soft-delete 記録を行う。Stripe 側のエラーで早期リターンすることで、
// 「DB は soft-delete 済み + Stripe 側は課金継続」という不整合を防ぐ。
// 詳細: docs/design/account-deletion-flow.md §3 / §4.2 (#741 Stripe キャンセル先行原則)。

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
import {
	DELETION_GRACE_PERIOD_DAYS,
	softDeleteTenant,
} from '$lib/server/services/grace-period-service';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
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
				// 経路選択は plan tier で決まる（free=即時 / standard=7d / family=30d）。
				//
				// #1811 Re-Review: トランザクション順序の整合性を維持するため、
				// 有料プランでは Stripe キャンセル → soft-delete 記録の順序で実行する。
				// Stripe 失敗時は settings への記録を行わず early return することで、
				// 「DB soft-delete 済み + Stripe 課金継続」の不整合を防ぐ。
				const planTier = await resolveFullPlanTier(
					tenantId,
					context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
					context.plan,
				);
				const graceDays = DELETION_GRACE_PERIOD_DAYS[planTier];

				if (graceDays > 0) {
					// 有料プラン: Stripe を先にキャンセル（失敗時は throw され catch で 500）。
					await cancelSubscription(tenantId);

					// Stripe 成功後にのみ settings に soft-delete 状態を記録。
					const soft = await softDeleteTenant(
						tenantId,
						context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
						context.plan,
					);
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

				// free プラン: 即時物理削除（deleteOwnerOnlyAccount 内で cancelSubscription を呼ぶ）
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
				//
				// #1811 Re-Review: owner-only と同じく、Stripe キャンセル先行で整合性を維持。
				const planTier = await resolveFullPlanTier(
					tenantId,
					context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
					context.plan,
				);
				const graceDays = DELETION_GRACE_PERIOD_DAYS[planTier];

				if (graceDays > 0) {
					// 有料プラン: Stripe を先にキャンセル（失敗時は throw され catch で 500）。
					// 他メンバーへのメール通知も物理削除時にまとめて行う（restore 可能性を残すため）。
					await cancelSubscription(tenantId);

					// Stripe 成功後にのみ settings に soft-delete 状態を記録。
					const soft = await softDeleteTenant(
						tenantId,
						context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
						context.plan,
					);
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

				// free プラン: 即時物理削除（deleteOwnerFullDelete 内で cancelSubscription を呼ぶ）
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
