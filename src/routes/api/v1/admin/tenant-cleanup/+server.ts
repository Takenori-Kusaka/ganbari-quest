// src/routes/api/v1/admin/tenant-cleanup/+server.ts
// 猶予期間満了テナントのデータ完全削除バッチ（EventBridge / 手動トリガー用）

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { notifyDeletionComplete } from '$lib/server/services/discord-notify-service';
import { sendDeletionCompleteEmail } from '$lib/server/services/email-service';
import { deleteByPrefix } from '$lib/server/storage';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
	const dryRun = body.dryRun ?? true;

	try {
		const result = await cleanupExpiredTenants(dryRun);
		logger.info('[tenant-cleanup] バッチ完了', {
			context: { ...result, dryRun },
		});
		return json({ success: true, dryRun, ...result });
	} catch (err) {
		logger.error('[tenant-cleanup] バッチ失敗', { error: String(err) });
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

interface CleanupResult {
	scanned: number;
	expired: number;
	deleted: number;
	details: Array<{ tenantId: string; items: number; files: number }>;
}

async function cleanupExpiredTenants(dryRun: boolean): Promise<CleanupResult> {
	const repos = getRepos();
	const now = new Date().toISOString();

	// grace_period テナントを検索（全テナントをスキャンして status=grace_period をフィルタ）
	// 注: 本番スケールが大きくなったら GSI にステータスインデックスを追加
	const allTenants = await findGracePeriodTenants();
	const expired = allTenants.filter((t) => t.planExpiresAt && t.planExpiresAt < now);

	const details: CleanupResult['details'] = [];
	let deletedCount = 0;

	for (const tenant of expired) {
		if (dryRun) {
			details.push({ tenantId: tenant.tenantId, items: 0, files: 0 });
			continue;
		}

		try {
			const result = await deleteTenantData(tenant.tenantId);
			details.push(result);
			deletedCount++;

			// テナントステータスを terminated に更新
			await repos.auth.updateTenantStatus(tenant.tenantId, 'terminated');

			// メンバー全員にメール通知
			const members = await repos.auth.findTenantMembers(tenant.tenantId);
			for (const member of members) {
				const user = await repos.auth.findUserById(member.userId);
				if (user?.email) {
					sendDeletionCompleteEmail(user.email).catch(() => {});
				}
			}

			// Discord 通知
			notifyDeletionComplete(tenant.tenantId, {
				items: result.items,
				files: result.files,
			}).catch(() => {});

			logger.info('[tenant-cleanup] テナントデータ削除完了', {
				context: { tenantId: tenant.tenantId, items: result.items, files: result.files },
			});
		} catch (err) {
			logger.error('[tenant-cleanup] テナントデータ削除失敗', {
				error: String(err),
				context: { tenantId: tenant.tenantId },
			});
		}
	}

	return {
		scanned: allTenants.length,
		expired: expired.length,
		deleted: deletedCount,
		details,
	};
}

interface TenantInfo {
	tenantId: string;
	planExpiresAt?: string;
}

async function findGracePeriodTenants(): Promise<TenantInfo[]> {
	// DynamoDB Scan for TENANT#* with status=grace_period
	const tenants: TenantInfo[] = [];

	// Scan approach: iterate known tenants via auth table
	// For now, use a simple approach - list all children to discover tenant IDs,
	// then check each tenant's status
	// Better approach: add a Scan to auth-repo, but for MVP we'll use storage listing
	try {
		const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
		const { getDocClient } = await import('$lib/server/db/dynamodb/client');

		const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? 'ganbari-quest';
		const doc = getDocClient();
		let lastKey: Record<string, unknown> | undefined;

		do {
			const result = await doc.send(
				new ScanCommand({
					TableName: TABLE_NAME,
					FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND #s = :status',
					ExpressionAttributeNames: { '#s': 'status' },
					ExpressionAttributeValues: {
						':prefix': 'TENANT#',
						':sk': 'META',
						':status': SUBSCRIPTION_STATUS.GRACE_PERIOD,
					},
					ExclusiveStartKey: lastKey,
				}),
			);

			for (const item of result.Items ?? []) {
				tenants.push({
					tenantId: item.tenantId as string,
					planExpiresAt: item.planExpiresAt as string | undefined,
				});
			}
			lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
		} while (lastKey);
	} catch {
		// ローカルモード（SQLite）の場合はスキップ
		logger.info('[tenant-cleanup] DynamoDB Scan 不可（ローカルモード？）');
	}

	return tenants;
}

async function deleteTenantData(
	tenantId: string,
): Promise<{ tenantId: string; items: number; files: number }> {
	const repos = getRepos();
	let itemsDeleted = 0;

	// 1. S3 ファイル削除
	const filesDeleted = await deleteByPrefix(`tenants/${tenantId}/`);

	// 2. 子供データ削除
	const children = await repos.child.findAllChildren(tenantId);
	for (const child of children) {
		await repos.child.deleteChild(child.id, tenantId);
		itemsDeleted++;
	}

	// 3. メンバーシップ削除
	const members = await repos.auth.findTenantMembers(tenantId);
	for (const member of members) {
		await repos.auth.deleteMembership(member.userId, tenantId);
		itemsDeleted++;
	}

	// 4. 招待リンク削除（ステータス更新で無効化）
	const invites = await repos.auth.findTenantInvites(tenantId);
	for (const invite of invites) {
		if (invite.status === 'pending') {
			await repos.auth.updateInviteStatus(invite.inviteCode, 'revoked');
			itemsDeleted++;
		}
	}

	return { tenantId, items: itemsDeleted, files: filesDeleted };
}
