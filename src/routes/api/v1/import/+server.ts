// src/routes/api/v1/import/+server.ts
// 家族データインポートAPI（JSON / ZIP対応）

import { json } from '@sveltejs/kit';
import { IMPORT_LABELS } from '$lib/domain/labels';
import { requireRole } from '$lib/server/auth/factory';
import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { type ParsedBackupZip, parseBackupZip } from '$lib/server/services/backup-archive';
import { resolveMaxImportBytes, toDisplayMb } from '$lib/server/services/import-limit';
import {
	countImportRows,
	importFamilyData,
	previewImport,
	validateExportData,
	verifyChecksum,
} from '$lib/server/services/import-service';
import {
	AtomicReplaceError,
	ReplaceRestoreFailedError,
	ReplaceSnapshotError,
	replaceImportAtomic,
} from '$lib/server/services/replace-import-service';
import type { RequestHandler } from './$types';

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
			// #3201: 内部フォーマット名 (JSON) を露出せず、checksum 不一致 (破損/改ざん) と
			// 区別できる「形式が正しくない」文言 SSOT を使う (旧: 'JSONの解析に失敗しました' 直書き)
			return { ok: false, error: IMPORT_LABELS.errorInvalidJson };
		}
	}

	// #3325 AC3: 実行環境の実効上限で受理判定する (AWS = Function URL 6MB 弱 / NUC・local = 100MB)。
	// 上限超過は「沈黙のハング」ではなく明示エラー + クラウド共有経由の復元案内を返す。
	const maxImportBytes = resolveMaxImportBytes();
	const buffer = await request.arrayBuffer();
	if (buffer.byteLength > maxImportBytes) {
		return {
			ok: false,
			error: IMPORT_LABELS.errorFileTooLargeCloudGuide(toDisplayMb(maxImportBytes)),
		};
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
	// #3692: restore 504 の段階別切り分け用 timing。logger.info が本番で出るようになった
	// (logger.ts 空 else 修正) ため、parse / checksum / preview / import の各所要を可視化する。
	const reqStart = Date.now();

	const parsed = await parseImportRequest(request);
	if (!parsed.ok) {
		return apiError('VALIDATION_ERROR', parsed.error);
	}
	const { body, staticFiles } = parsed.value;
	logger.info('[import] parsed', { context: { mode, parseMs: Date.now() - reqStart } });

	const validation = validateExportData(body);
	if (!validation.valid) {
		return apiError('VALIDATION_ERROR', validation.error);
	}

	// #1254 G4: checksum 検証 (tampering / corruption 検出)
	const checksumOk = await verifyChecksum(validation.data);
	if (!checksumOk) {
		return apiError('VALIDATION_ERROR', IMPORT_LABELS.errorChecksumMismatch);
	}
	logger.info('[import] validated', {
		context: { mode, elapsedMs: Date.now() - reqStart, rows: countImportRows(validation.data) },
	});

	if (mode === 'preview') {
		const previewStart = Date.now();
		const preview = await previewImport(validation.data, tenantId);
		logger.info('[import] preview 完了', {
			context: { previewMs: Date.now() - previewStart, totalMs: Date.now() - reqStart },
		});
		return json({ ok: true, preview });
	}

	if (mode === 'execute') {
		try {
			// #3692: 本番 restore timeout の切り分けで execute 経路が無ログだったため、
			// 開始 (取込行数) / 完了 (所要 ms) を記録する。Lambda 30s 制約下の消費時間を可視化。
			logger.info('[import] インポート開始', {
				context: { tenantId, rows: countImportRows(validation.data) },
			});
			const startedAt = Date.now();
			const result = await importFamilyData(validation.data, tenantId, staticFiles);
			logger.info('[import] インポート完了', {
				context: { tenantId, durationMs: Date.now() - startedAt, errors: result.errors.length },
			});
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
			logger.info('[import] 置換インポート開始 (原子化)', {
				context: { tenantId, rows: countImportRows(validation.data) },
			});
			const startedAt = Date.now();
			const result = await replaceImportAtomic(validation.data, tenantId, staticFiles);
			logger.info('[import] 置換インポート完了', {
				context: { tenantId, durationMs: Date.now() - startedAt, errors: result.errors.length },
			});
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
			if (err instanceof ReplaceSnapshotError || err instanceof ReplaceRestoreFailedError) {
				// #4720 pg 系: snapshot 取得失敗 (置換未開始、旧データ無傷) / 復元失敗 (手動復旧が必要) は
				// 「保全されています」と言わず実態の文言を返す。
				logger.error('[import] 置換インポート失敗 (pg snapshot 経路)', {
					error: String(err),
					context: { kind: err.name },
				});
				return apiError('INTERNAL_ERROR', err.message);
			}
			logger.error('[import] 置換インポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', '置換インポートに失敗しました');
		}
	}

	return apiError('VALIDATION_ERROR', 'mode は preview, execute, replace を指定してください');
};
