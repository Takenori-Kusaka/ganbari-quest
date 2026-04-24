// src/routes/api/v1/admin/account/delete/+server.ts
// 統一アカウント削除エンドポイント (#458)
// pattern パラメータで4つの削除パターンを分岐

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import {
	deleteChildAccount,
	deleteMemberAccount,
	deleteOwnerFullDelete,
	deleteOwnerOnlyAccount,
	transferOwnershipAndLeave,
} from '$lib/server/services/account-deletion-service';

interface DeleteRequestBody {
	pattern: 'owner-only' | 'owner-with-transfer' | 'owner-full-delete' | 'child' | 'member';
	/** Pattern 2a のみ: 移譲先ユーザーID */
	newOwnerId?: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 既存コード、別Issueで対応予定
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
				const result = await deleteOwnerOnlyAccount(tenantId, identity.userId);
				logger.info('[account-delete] Pattern 1 完了', { context: { tenantId } });
				return json(result);
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
				const result = await deleteOwnerFullDelete(tenantId, identity.userId);
				logger.info('[account-delete] Pattern 2b 完了', { context: { tenantId } });
				return json(result);
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
