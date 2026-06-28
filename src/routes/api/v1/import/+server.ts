// src/routes/api/v1/import/+server.ts
// 家族データインポートAPI（JSON / ZIP対応）

import { json } from '@sveltejs/kit';
import { IMPORT_LABELS } from '$lib/domain/labels';
import { requireRole } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import {
	BACKUP_MANIFEST_FILENAME,
	parseBackupManifest,
	verifyBackupManifest,
} from '$lib/server/services/backup-manifest';
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

// #3078 zip-bomb 防御: 圧縮入力 (MAX_IMPORT_BYTES) だけでなく、展開後 (uncompressed) のサイズも制限する。
//   fflate.unzipSync は圧縮入力サイズしか見ないため、高圧縮率の ZIP で巨大展開 → OOM を招きうる。
const MAX_ENTRY_UNCOMPRESSED_BYTES = 25 * 1024 * 1024; // エントリ単体上限 25MB
const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 展開後合計上限 200MB

interface ParsedImport {
	body: unknown;
	/** #3077: ZIP 同梱の静的ファイル (相対パス → bytes)。JSON-only では undefined。 */
	staticFiles?: Record<string, Uint8Array>;
}

/**
 * #3375: 展開済み ZIP エントリに manifest.json があれば整合性照合する。
 * data.json + 全静的ファイルの SHA-256 / バイト数を manifest と突き合わせ、偶発的破損 (転送/保存中の
 * 破損) と集合不一致 (manifest 記載ファイルの欠落 / 記載外ファイルの混入) を復元前に検出する。
 * manifest は未署名のため意図的改竄の防止は対象外 (将来スコープ、backup-manifest.ts 冒頭参照)。
 * manifest が無い旧 ZIP は検証スキップ (後方互換) で ok を返す。
 */
async function verifyManifestIfPresent(
	entries: Record<string, Uint8Array>,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const manifestBytes = entries[BACKUP_MANIFEST_FILENAME];
	if (!manifestBytes) return { ok: true };

	const manifest = parseBackupManifest(manifestBytes);
	if (!manifest) {
		return { ok: false, error: 'バックアップの manifest.json が壊れています' };
	}

	const entriesForVerify: Record<string, Uint8Array> = {};
	for (const [path, bytes] of Object.entries(entries)) {
		if (path === BACKUP_MANIFEST_FILENAME) continue;
		entriesForVerify[path] = bytes;
	}

	const verdict = await verifyBackupManifest(entriesForVerify, manifest);
	if (!verdict.ok) {
		const detail =
			verdict.reason === 'unexpected-file'
				? `manifest に記載のないファイルが含まれています（${verdict.path}）`
				: `バックアップが破損しています（${verdict.path}: ${verdict.reason}）`;
		return { ok: false, error: `${detail}。再エクスポートしてください` };
	}
	return { ok: true };
}

/**
 * 展開済み ZIP エントリから復元対象の静的ファイル (相対パス → bytes) を抽出する。
 * data.json / manifest.json (整合性メタ) / ディレクトリエントリ / 空ファイルは除外する。
 */
function collectStaticFiles(entries: Record<string, Uint8Array>): Record<string, Uint8Array> {
	const staticFiles: Record<string, Uint8Array> = {};
	for (const [path, bytes] of Object.entries(entries)) {
		if (path === 'data.json' || path === BACKUP_MANIFEST_FILENAME) continue;
		if (path.endsWith('/') || bytes.length === 0) continue;
		staticFiles[path] = bytes;
	}
	return staticFiles;
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
		// #3078 zip-bomb 防御: filter で central directory の originalSize を見て、
		//   per-entry 上限を超えるエントリは展開せず弾く (高圧縮率の巨大展開 → OOM 阻止)。
		entries = unzipSync(new Uint8Array(buffer), {
			filter: (file) => file.originalSize <= MAX_ENTRY_UNCOMPRESSED_BYTES,
		});
	} catch {
		return { ok: false, error: 'ZIPの解凍に失敗しました' };
	}

	// #3078 zip-bomb 防御: 展開後合計サイズが上限を超える ZIP を拒否する。
	let totalUncompressed = 0;
	for (const bytes of Object.values(entries)) {
		totalUncompressed += bytes.length;
		if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
			return { ok: false, error: '展開後のファイルサイズが大きすぎます（最大200MB）' };
		}
	}

	const dataJson = entries['data.json'];
	if (!dataJson) {
		return { ok: false, error: 'ZIP内に data.json が見つかりません' };
	}

	// #3375: 整合性 manifest 検証 (manifest が無い旧 ZIP は検証スキップ = 後方互換)。
	const manifestCheck = await verifyManifestIfPresent(entries);
	if (!manifestCheck.ok) {
		return { ok: false, error: manifestCheck.error };
	}

	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(dataJson));
	} catch {
		return { ok: false, error: 'data.json の解析に失敗しました' };
	}

	return { ok: true, value: { body, staticFiles: collectStaticFiles(entries) } };
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
