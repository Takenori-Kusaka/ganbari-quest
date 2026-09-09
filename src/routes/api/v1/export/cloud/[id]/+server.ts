// src/routes/api/v1/export/cloud/[id]/+server.ts
// クラウドエクスポート個別操作API（削除）

import { json } from '@sveltejs/kit';
import { redactStorageKeysInText } from '$lib/domain/storage-key-redaction';
import { requireRole } from '$lib/server/auth/factory';
import { apiError, validationError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import {
	CloudExportDeleteFailedError,
	CloudExportNotFoundError,
	deleteCloudExport,
} from '$lib/server/services/cloud-export-service';
import type { RequestHandler } from './$types';

/** DELETE /api/v1/export/cloud/:id — クラウドエクスポート削除 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	requireRole(locals, ['owner', 'parent']);

	const id = params.id;
	if (!id) {
		return validationError('無効なIDです');
	}

	try {
		await deleteCloudExport(id, tenantId);
		return json({ ok: true });
	} catch (err) {
		// #4767: 失敗の種類は **型で** 見分ける。旧実装は `msg.includes('見つかりません')` で 404 を
		// 決めていたため、顧客向け文言を 1 文字直すだけで 404 が 500 に化ける形だった
		// (本 PR が 403 の文言で潰したのと同じ class)。
		if (err instanceof CloudExportNotFoundError) {
			// pin-sink-ok: 型付きドメインエラーの顧客向け文言 (#4767 で型で見分ける形にした)。
			//   生の例外ではなく、`CloudExportNotFoundError` が自分で組み立てた文で PIN を含まない。
			return apiError('NOT_FOUND', err.message);
		}
		// #4767 QM should: 保管実体の削除に失敗して中断した場合 (DB 行は残っている)。
		// 「システムに問題が発生しました」で終わらせず、データが残っていること + 再試行を伝える。
		if (err instanceof CloudExportDeleteFailedError) {
			logger.error('[cloud-export] 削除中断 (実体削除に失敗)', { context: { id, tenantId } });
			// pin-sink-ok: 型付きドメインエラーの顧客向け文言 (「データは残っています」の案内)。
			return apiError('EXPORT_DELETE_FAILED', err.message);
		}
		const msg = err instanceof Error ? err.message : String(err);
		// #4867: 例外 message は PIN / s3Key を含みうるので伏せてから出す。
		logger.error('[cloud-export] 削除失敗', { error: redactStorageKeysInText(msg) });
		return apiError('INTERNAL_ERROR', 'クラウドエクスポートの削除に失敗しました');
	}
};
