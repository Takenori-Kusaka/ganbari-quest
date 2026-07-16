// src/lib/server/services/function-url-limit.ts
// #3694: AWS Lambda Function URL (BUFFERED) の request/response 各 6MB hard cap を、
// 「同期に body を運ぶ」全経路 (import ZIP 受信 / export ZIP 送信 / OCR base64 受信) の
// アプリ側上限 SSOT にする。
//
// 本番公開経路は CloudFront → Lambda Function URL (BUFFERED) で、request / response とも
// payload 上限は **6MB (hard limit)**。これを超える body は Lambda に到達せず edge で弾かれ
// (413 / 接続切断)、アプリのエラーハンドリングも UI feedback も効かない「沈黙のハング」になる。
// そこで各経路の上限を platform 実効値に整合させ、超過は edge 切断ではなくアプリの明示エラー
// (ADR-0062) に統一し、大容量はクラウド共有 (PIN) 経由の非同期経路へ誘導する。
//
// request-side の ZIP import 上限 (raw binary) は import-limit.ts が SSOT (AWS_MAX_IMPORT_BYTES)。
// 本 module は response-side (export ZIP) と base64 JSON body (OCR) の実効上限を追加で担う。

import { getEnv, type TypedEnv } from '$lib/runtime/env';
import { resolveRuntimeMode } from '$lib/runtime/runtime-mode';

/** Function URL (BUFFERED) の request/response hard cap = 6 MiB (AWS 固定値、platform 上限)。 */
export const FUNCTION_URL_PAYLOAD_CAP_BYTES = 6 * 1024 * 1024;

/**
 * hard cap に対する安全側 margin 比率。encoding / HTTP header / JSON wrapper 分を差し引いて
 * edge 拒否を確実に回避する。実効上限 = cap * (1 - margin)。
 */
const SAFETY_MARGIN_RATIO = 0.08;

/** AWS 実効の同期 payload 上限 (request/response 共通、bytes)。約 5.52MB。 */
export const AWS_EFFECTIVE_PAYLOAD_BYTES = Math.floor(
	FUNCTION_URL_PAYLOAD_CAP_BYTES * (1 - SAFETY_MARGIN_RATIO),
);

/**
 * base64 JSON body で運ぶバイナリ (OCR 画像) の**デコード後**実効上限。base64 は元データの
 * 約 4/3 に膨張するため、AWS 実効 payload を 3/4 して逆算する。約 4.14MB。
 */
export const AWS_EFFECTIVE_BASE64_DECODED_BYTES = Math.floor((AWS_EFFECTIVE_PAYLOAD_BYTES * 3) / 4);

/**
 * aws-prod のときのみ AWS 実効 response 上限 (bytes) を返す。他モード (NUC / local) は
 * Function URL 制約が無いため制約なし (Infinity) を返す。export ZIP 直 DL の response サイズ
 * 判定に使う。
 */
export function resolveMaxSyncResponseBytes(env: TypedEnv = getEnv()): number {
	return resolveRuntimeMode({ env }) === 'aws-prod'
		? AWS_EFFECTIVE_PAYLOAD_BYTES
		: Number.POSITIVE_INFINITY;
}

/**
 * aws-prod のとき、渡された localMax と AWS の base64 デコード後実効上限の小さい方を返す。
 * 他モードは localMax をそのまま返す。OCR 画像 (base64 JSON body) のデコード後サイズ判定に使う。
 */
export function resolveMaxBase64DecodedBytes(localMax: number, env: TypedEnv = getEnv()): number {
	return resolveRuntimeMode({ env }) === 'aws-prod'
		? Math.min(localMax, AWS_EFFECTIVE_BASE64_DECODED_BYTES)
		: localMax;
}
