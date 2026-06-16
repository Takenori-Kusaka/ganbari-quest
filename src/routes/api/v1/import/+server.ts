// src/routes/api/v1/import/+server.ts
// 家族データインポートAPI（JSON / ZIP対応）

import { json } from '@sveltejs/kit';
import { IMPORT_LABELS } from '$lib/domain/labels';
import { requireRole } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { clearAllFamilyData } from '$lib/server/services/data-service';
import {
	importFamilyData,
	previewImport,
	validateExportData,
	verifyChecksum,
} from '$lib/server/services/import-service';
import type { RequestHandler } from './$types';

// #3077: ZIP インポートの上限。export ZIP (export/+server.ts MAX_ZIP_SIZE) と整合させる。
const MAX_IMPORT_BYTES = 100 * 1024 * 1024; // 100MB

interface ParsedImport {
	body: unknown;
	/** #3077: ZIP 同梱の静的ファイル (相対パス → bytes)。JSON-only では undefined。 */
	staticFiles?: Record<string, Uint8Array>;
}

/**
 * リクエスト本文を JSON / ZIP のいずれかとして解析する (#3077)。
 * - `application/zip`: `fflate.unzipSync` で展開し、`data.json` を export body に、
 *   それ以外 (`avatars/**` / `voices/**` 等) を静的ファイルとして返す。
 * - それ以外: JSON として解析 (後方互換)。
 */
async function parseImportRequest(
	request: Request,
): Promise<{ ok: true; value: ParsedImport } | { ok: false; error: string }> {
	const contentType = request.headers.get('content-type') ?? '';
	const isZip =
		contentType.includes('application/zip') || contentType.includes('application/octet-stream');

	if (!isZip) {
		try {
			return { ok: true, value: { body: await request.json() } };
		} catch {
			return { ok: false, error: 'JSONの解析に失敗しました' };
		}
	}

	const buffer = await request.arrayBuffer();
	if (buffer.byteLength > MAX_IMPORT_BYTES) {
		return { ok: false, error: 'ファイルサイズが大きすぎます（最大100MB）' };
	}

	let entries: Record<string, Uint8Array>;
	try {
		const { unzipSync } = await import('fflate');
		entries = unzipSync(new Uint8Array(buffer));
	} catch {
		return { ok: false, error: 'ZIPの解凍に失敗しました' };
	}

	const dataJson = entries['data.json'];
	if (!dataJson) {
		return { ok: false, error: 'ZIP内に data.json が見つかりません' };
	}

	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(dataJson));
	} catch {
		return { ok: false, error: 'data.json の解析に失敗しました' };
	}

	const staticFiles: Record<string, Uint8Array> = {};
	for (const [path, bytes] of Object.entries(entries)) {
		if (path === 'data.json') continue;
		// ディレクトリエントリ (末尾 /) や空ファイルは無視
		if (path.endsWith('/') || bytes.length === 0) continue;
		staticFiles[path] = bytes;
	}

	return { ok: true, value: { body, staticFiles } };
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
			logger.info('[import] 置換インポート開始: データクリア実行', { context: { tenantId } });
			const clearResult = await clearAllFamilyData(tenantId);
			logger.info('[import] データクリア完了、インポート開始');
			const result = await importFamilyData(validation.data, tenantId, staticFiles);
			return json({ ok: true, result, cleared: clearResult.deleted });
		} catch (err) {
			logger.error('[import] 置換インポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', '置換インポートに失敗しました');
		}
	}

	return apiError('VALIDATION_ERROR', 'mode は preview, execute, replace を指定してください');
};
