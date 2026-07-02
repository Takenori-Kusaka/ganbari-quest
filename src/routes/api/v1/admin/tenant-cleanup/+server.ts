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
	// #3184 item4: route から raw DynamoDB Scan を撤去し、auth repo facade (listAllTenants) +
	// client-side filter に置換 (route↔DB 境界 fitness function / ADR-0061)。tenant 数は Pre-PMF
	// 規模で小さく、server-side FilterExpression を client filter に変えても実害なし。SQLite/demo は
	// listAllTenants が各 backend 実装を返すため try/catch の backend 分岐も不要になる。
	try {
		const all = await getRepos().auth.listAllTenants();
		return all
			.filter((t) => t.status === SUBSCRIPTION_STATUS.GRACE_PERIOD)
			.map((t) => ({ tenantId: t.tenantId, planExpiresAt: t.planExpiresAt }));
	} catch {
		// backend 未初期化等の場合はスキップ (掃除対象なしとして扱う)
		logger.info('[tenant-cleanup] listAllTenants 不可（backend 未初期化？）');
		return [];
	}
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
