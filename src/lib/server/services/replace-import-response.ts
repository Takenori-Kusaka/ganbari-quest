// src/lib/server/services/replace-import-response.ts
// #4752: 置換インポート (復元) の失敗 → HTTP レスポンス変換の単一箇所。
//
// PO 回答 (2026-09-03) の顧客条件は「文言が実際のデータ状態と一致すること」と
// 「補償が半端に終わったら、その旨と復旧手段が顧客に出ること」。この対応表が /api/v1/import と
// /api/v1/import/cloud (ZIP / JSON の 2 経路) に 3 copy されていると、片方だけ直って割れる。
// 3 経路が本 helper を経由することで、状態 → HTTP 種別 → 文言の対応を 1 箇所で保つ。
//
// | 失敗 | HTTP | 実際のデータ | 顧客に出す文言 |
// |---|---|---|---|
// | 取込 hard error (復元済) | 400 VALIDATION_ERROR | 旧データが復元済 | 「既存データは保全されています」 |
// | 置換前 snapshot 取得不能 | 500 INTERNAL_ERROR | 旧データ無傷 (置換未開始) | 再試行案内 (client が汎用文言に落とす) |
// | 自動復元も失敗 (二次故障) | 409 IMPORT_RESTORE_FAILED | **半端な状態** | 半端である旨 + 運営連絡 + 復旧コード |
//
// 二次故障を 500 にしてはならない: client (error-notify / ADR-0062 §2) は 500 の body を捨てて
// 「時間をおいて再度お試しください」を出すため、半端な状態も復旧手段も顧客に届かない。

import { apiError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import {
	AtomicReplaceError,
	ReplaceRestoreFailedError,
	ReplaceSnapshotError,
} from './replace-import-service';

/**
 * 置換インポートの既知失敗を HTTP レスポンスに変換する。未知の例外は `null` を返す
 * (呼び出し側が従来どおり 500 汎用エラーにする)。
 *
 * @param logPrefix ログ prefix (`[import]` / `[cloud-import]`)
 */
export function replaceImportErrorResponse(err: unknown, logPrefix: string): Response | null {
	if (err instanceof AtomicReplaceError) {
		// 原子境界を中止し旧データを復元済。取込失敗の内訳は log にだけ残す (顧客向け文言に
		// 生の例外文字列を連結すると client の echo hardening が汎用文言に落とし、保全の事実が届かない)。
		logger.error(`${logPrefix} 置換インポート中止 (既存データ保全)`, {
			context: { errors: err.result.errors.slice(0, 3) },
		});
		return apiError('VALIDATION_ERROR', err.message);
	}
	if (err instanceof ReplaceRestoreFailedError) {
		logger.error(`${logPrefix} 置換インポート失敗 (自動復元も失敗、手動復旧が必要)`, {
			error: String(err),
			context: {
				kind: err.name,
				recoveryKey: err.recoveryKey,
				recoveryCode: err.recoveryCode,
				cause: String(err.cause),
				originalError: String(err.originalError),
			},
		});
		return apiError('IMPORT_RESTORE_FAILED', err.message, { recoveryCode: err.recoveryCode });
	}
	if (err instanceof ReplaceSnapshotError) {
		// 置換未開始 = 旧データ無傷。「保全されています」とは言わない (置換していないため)。
		logger.error(`${logPrefix} 置換インポート失敗 (pg snapshot 経路)`, {
			error: String(err),
			context: { kind: err.name, cause: String(err.cause) },
		});
		return apiError('INTERNAL_ERROR', err.message);
	}
	return null;
}
