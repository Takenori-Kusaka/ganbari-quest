// src/routes/api/v1/import/+server.ts
// 家族データインポートAPI（JSON / ZIP対応）

import { json } from '@sveltejs/kit';
import { IMPORT_LABELS } from '$lib/domain/labels';
import { requireRole } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { type ParsedBackupZip, parseBackupZip } from '$lib/server/services/backup-archive';
import {
	importFamilyData,
	previewImport,
	validateExportData,
	verifyChecksum,
} from '$lib/server/services/import-service';
import {
	AtomicReplaceError,
	replaceImportAtomic,
} from '$lib/server/services/replace-import-service';
import type { RequestHandler } from './$types';

// #3077: ZIP インポートの上限。export ZIP (backup-archive MAX_ZIP_SIZE) と整合させる。
const MAX_IMPORT_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * リクエスト本文を JSON / ZIP のいずれかとして解析する (#3077)。
 * - `application/zip`: #3376 で共通化した `parseBackupZip` で展開 + zip-bomb 防御 +
 *   #3375 manifest 整合性検証を行い、`data.json` を body に、静的ファイルを staticFiles に返す。
 * - それ以外: JSON として解析 (後方互換)。
 */
async function parseImportRequest(
	request: Request,
): Promise<{ ok: true; value: ParsedBackupZip } | { ok: false; error: string }> {
	const contentType = request.headers.get('content-type') ?? '';
	const isZip =
		contentType.includes('application/zip') || contentType.includes('application/octet-stream');

	if (!isZip) {
		try {
			return { ok: true, value: { body: await request.json(), staticFiles: {} } };
		} catch {
			return { ok: false, error: 'JSONの解析に失敗しました' };
		}
	}

	const buffer = await request.arrayBuffer();
	if (buffer.byteLength > MAX_IMPORT_BYTES) {
		return { ok: false, error: 'ファイルサイズが大きすぎます（最大100MB）' };
	}

	return parseBackupZip(new Uint8Array(buffer));
}

/** POST /api/v1/import?mode=preview|execute|replace */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	requireRole(locals, ['owner', 'parent']);

	const mode = url.searchParams.get('mode') ?? 'preview';

	const parsed = await parseImportRequest(request);
	if (!parsed.ok) {
		return apiError('VALIDATION_ERROR', parsed.error);
	}
	const { body, staticFiles } = parsed.value;

	const validation = validateExportData(body);
	if (!validation.valid) {
		return apiError('VALIDATION_ERROR', validation.error);
	}

	// #1254 G4: checksum 検証 (tampering / corruption 検出)
	const checksumOk = await verifyChecksum(validation.data);
	if (!checksumOk) {
		return apiError('VALIDATION_ERROR', IMPORT_LABELS.errorChecksumMismatch);
	}

	if (mode === 'preview') {
		const preview = await previewImport(validation.data, tenantId);
		return json({ ok: true, preview });
	}

	if (mode === 'execute') {
		try {
			const result = await importFamilyData(validation.data, tenantId, staticFiles);
			return json({ ok: true, result });
		} catch (err) {
			logger.error('[import] インポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', 'インポートに失敗しました');
		}
	}

	if (mode === 'replace') {
		requireRole(locals, ['owner', 'parent']);
		try {
			// #3326: clear + import を原子境界で実行。途中失敗時は旧データを必ず復元する
			// (SQLite=BEGIN/ROLLBACK / DynamoDB=backup-before-clear)。clear 先行の永久喪失を廃止。
			logger.info('[import] 置換インポート開始 (原子化)', { context: { tenantId } });
			const result = await replaceImportAtomic(validation.data, tenantId, staticFiles);
			return json({ ok: true, result });
		} catch (err) {
			if (err instanceof AtomicReplaceError) {
				// 原子境界を中止し旧データを保全済。インポート失敗の旨を返す。
				logger.error('[import] 置換インポート中止 (既存データ保全)', {
					context: { errors: err.result.errors.slice(0, 3) },
				});
				return apiError(
					'VALIDATION_ERROR',
					`インポートに失敗したため中止しました（既存データは保全されています）: ${err.result.errors[0] ?? ''}`,
				);
			}
			logger.error('[import] 置換インポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', '置換インポートに失敗しました');
		}
	}

	return apiError('VALIDATION_ERROR', 'mode は preview, execute, replace を指定してください');
};
