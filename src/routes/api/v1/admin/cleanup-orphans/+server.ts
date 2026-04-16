// src/routes/api/v1/admin/cleanup-orphans/+server.ts
// S3 孤立ファイル検出・削除（EventBridge / 手動トリガー用）

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { deleteFile, listFiles } from '$lib/server/storage';

export const POST: RequestHandler = async ({ request }) => {
	// 内部 cron 認証
	const cronSecret = process.env.CRON_SECRET;
	if (cronSecret) {
		const authHeader = request.headers.get('x-cron-secret');
		if (authHeader !== cronSecret) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
	} else if (process.env.AUTH_MODE !== 'local') {
		return json({ error: 'CRON_SECRET not configured' }, { status: 500 });
	}

	const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
	const dryRun = body.dryRun ?? true;

	try {
		const result = await detectAndCleanOrphans(dryRun);
		logger.info('[cleanup] 孤立ファイルクリーンアップ完了', {
			context: { ...result, dryRun },
		});
		return json({ success: true, dryRun, ...result });
	} catch (err) {
		logger.error('[cleanup] クリーンアップ失敗', { error: String(err) });
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

interface CleanupResult {
	scanned: number;
	orphaned: number;
	deleted: number;
	orphanedFiles: string[];
}

async function detectAndCleanOrphans(dryRun: boolean): Promise<CleanupResult> {
	const repos = getRepos();

	const allFiles = await listFiles('tenants/');
	const orphanedFiles: string[] = [];

	// テナント・子供の存在キャッシュ
	const tenantCache = new Map<string, boolean>();
	const childCache = new Map<string, boolean>();

	for (const key of allFiles) {
		// tenants/{tenantId}/{type}/{childId}/filename.ext
		const match = key.match(/^tenants\/([^/]+)\//);
		if (!match?.[1]) continue;
		const tenantId: string = match[1];

		// テナント存在チェック
		if (!tenantCache.has(tenantId)) {
			const tenant = await repos.auth.findTenantById(tenantId);
			const exists = !!tenant && tenant.status !== SUBSCRIPTION_STATUS.TERMINATED;
			tenantCache.set(tenantId, exists);
		}
		if (!tenantCache.get(tenantId)) {
			orphanedFiles.push(key);
			continue;
		}

		// 子供存在チェック（子供IDがある場合）
		const childMatch = key.match(/^tenants\/[^/]+\/[^/]+\/(\d+)\//);
		if (childMatch?.[1]) {
			const childId = Number(childMatch[1]);
			const cacheKey = `${tenantId}:${childId}`;
			if (!childCache.has(cacheKey)) {
				const children = await repos.child.findAllChildren(tenantId);
				for (const c of children) {
					childCache.set(`${tenantId}:${c.id}`, true);
				}
				if (!childCache.has(cacheKey)) {
					childCache.set(cacheKey, false);
				}
			}
			if (!childCache.get(cacheKey)) {
				orphanedFiles.push(key);
			}
		}
	}

	let deleted = 0;
	if (!dryRun) {
		for (const key of orphanedFiles) {
			try {
				await deleteFile(key);
				deleted++;
			} catch (err) {
				logger.warn('[cleanup] ファイル削除失敗', { error: String(err), context: { key } });
			}
		}
	}

	return {
		scanned: allFiles.length,
		orphaned: orphanedFiles.length,
		deleted,
		orphanedFiles: orphanedFiles.slice(0, 100),
	};
}
