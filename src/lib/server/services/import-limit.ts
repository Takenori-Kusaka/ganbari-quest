// src/lib/server/services/import-limit.ts
// #3325 AC3: バックアップ import 受理上限の実態整合 SSOT。
//
// AWS 本番の公開経路は CloudFront → Lambda Function URL (BUFFERED) で、Function URL の
// request payload 上限は **6MB (hard limit)**。旧実装のアプリ側 100MB 許容は実態と乖離し、
// 6MB 超の body はハンドラに到達せず edge で弾かれ「沈黙のハング」になっていた。
// 本 module は実行環境 (runtime mode) に応じた実効上限を 1 箇所で解決する:
//   - aws-prod  : 6MB 弱 (5.5MB、multipart/encoding overhead margin) — 超過時は API が
//                 明示エラー + クラウド経由の復元導線を案内する (NN/G error prevention)。
//   - nuc-prod / local-debug / それ以外 : Function URL 制約が無いため従来上限
//                 (export ZIP の MAX_ZIP_SIZE = 100MB と整合) を維持する。
//
// UI (settings/data) は load 経由で本値を受け取り、送信前 client-side pre-check にも使う。

import { getEnv, type TypedEnv } from '$lib/runtime/env';
import { resolveRuntimeMode } from '$lib/runtime/runtime-mode';
import { MAX_ZIP_SIZE } from '$lib/server/services/backup-archive';

// #3694: platform cap (6MB) の SSOT は function-url-limit.ts。本 module は request-side (ZIP 受信)
// の実効上限を担い、response-side (export ZIP) / base64 (OCR) は function-url-limit.ts が担う。
// FUNCTION_URL_PAYLOAD_CAP_BYTES との関係は tests/unit/services/function-url-limit.test.ts が
// fitness assert する (AWS_MAX_IMPORT_BYTES < platform cap)。
/** AWS Lambda Function URL (BUFFERED) の 6MB hard cap に対する安全側の実効上限 (5.5MB)。 */
export const AWS_MAX_IMPORT_BYTES = Math.floor(5.5 * 1024 * 1024);

/** NUC / local の受理上限。export ZIP 構築上限 (backup-archive MAX_ZIP_SIZE) と整合させる。 */
export const LOCAL_MAX_IMPORT_BYTES = MAX_ZIP_SIZE;

/**
 * 実行環境に応じた import 受理上限 (bytes) を返す。
 * env を明示注入できる純関数寄りの形にし、unit test で runtime mode 分岐を検証可能にする。
 */
export function resolveMaxImportBytes(env: TypedEnv = getEnv()): number {
	const mode = resolveRuntimeMode({ env });
	return mode === 'aws-prod' ? AWS_MAX_IMPORT_BYTES : LOCAL_MAX_IMPORT_BYTES;
}

/** bytes → ユーザー向け MB 表示 (小数 1 桁。例: 5767168 → 5.5)。 */
export function toDisplayMb(maxBytes: number): number {
	return Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
}
