// src/routes/api/v1/export/cloud/[id]/download/+server.ts
// #3504 (async-backup-export.md §3.4): クラウドエクスポートの一時ダウンロード経路。
//
// 生成済 (status='ready') のバックアップを配信する。runtime により経路が分岐する:
//   - AWS (S3): storage.getDownloadUrl が presigned URL (短命 TTL) を返す → 302 redirect。
//     Lambda body 6MB / 30 秒制約を迂回する。
//   - NUC (ローカル FS): presigned 不在のため proxy → readFile を認証済で stream (static/ 直配信しない)。
//
// セキュリティ (CWE-598): 一時リンクは「リンクを持つ誰でも DL 可」になり得るため、
//   発行 route で ① 認証 (context 必須) ② role (owner/parent) ③ tenant 一致 (findById が tenantId 束縛)
//   を必須とし、presigned は対象 key 限定・短命 TTL、DL カウンタで消費上限を課す。

import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import { apiError, validationError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/** presigned URL の有効秒数 (§3.4: 60〜300 秒。DL route 発行直後に使われる想定で 300 秒)。 */
const DOWNLOAD_URL_TTL_SECONDS = 300;

/** GET /api/v1/export/cloud/:id/download — 生成済バックアップの一時ダウンロード */
export const GET: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	requireRole(locals, ['owner', 'parent']);

	const id = Number(params.id);
	if (Number.isNaN(id) || id <= 0) {
		return validationError('無効なIDです');
	}

	const repos = getRepos();
	// findById は tenantId 束縛のため、他 tenant のリソースは undefined (IDOR 遮断)。
	const record = await repos.cloudExport.findById(id, tenantId);
	if (!record) {
		return apiError('NOT_FOUND', 'エクスポートが見つかりません');
	}

	// 生成中 / 失敗 / 期限切れ / DL 上限は配信不可。
	if (record.status !== 'ready') {
		return apiError('VALIDATION_ERROR', 'このエクスポートはまだ準備できていません');
	}
	if (new Date(record.expiresAt) < new Date()) {
		return apiError('VALIDATION_ERROR', 'このエクスポートは有効期限切れです');
	}
	// DL 用カウンタ制御 (#3504 §3.4): import 用 consumeCloudExportDownload とは別の呼び出し経路で
	// 同一 download budget (downloadCount/maxDownloads) を消費する。上限到達で配信不可。
	if (record.downloadCount >= record.maxDownloads) {
		return apiError('VALIDATION_ERROR', 'このエクスポートはダウンロード回数の上限に達しています');
	}

	try {
		const dl = await repos.storage.getDownloadUrl(record.s3Key, {
			expiresIn: DOWNLOAD_URL_TTL_SECONDS,
		});
		const filename = record.s3Key.split('/').pop() || 'backup.zip';

		if (dl.kind === 'redirect') {
			// DL カウンタを消費してから presigned URL へ 302 redirect (S3/AWS 経路)。
			await repos.cloudExport.incrementDownloadCount(record.id, record.tenantId);
			logger.info('[cloud-export] DL redirect', { context: { id, tenantId } });
			return new Response(null, { status: 302, headers: { location: dl.url } });
		}

		// proxy 経路 (NUC): 認証済で readFile から stream する。
		const file = await repos.storage.readFile(record.s3Key);
		if (!file) {
			return apiError('NOT_FOUND', 'エクスポートデータが見つかりません');
		}
		await repos.cloudExport.incrementDownloadCount(record.id, record.tenantId);
		logger.info('[cloud-export] DL proxy stream', { context: { id, tenantId } });
		return new Response(new Uint8Array(file.data), {
			status: 200,
			headers: {
				'content-type': file.contentType,
				'content-length': String(file.data.length),
				'content-disposition': `attachment; filename="${filename}"`,
				'cache-control': 'no-store',
			},
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error('[cloud-export] DL 失敗', { error: msg, context: { id, tenantId } });
		return apiError('INTERNAL_ERROR', 'ダウンロードに失敗しました');
	}
};
