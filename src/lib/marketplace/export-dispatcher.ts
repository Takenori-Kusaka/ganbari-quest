/**
 * Marketplace export dispatcher — Issue #2372 (EPIC #2362 P4).
 *
 * 5 type 全 marketplace payload (activity-pack / reward-set / checklist /
 * rule-preset / challenge-set) を v2 envelope で export する統一 entry point。
 *
 * 設計原則:
 *   - **round-trip 保証**: `exportPayload(typeCode, payload)` → `parseExportEnvelopeV2()`
 *     → `marketplaceRegistry.get(typeCode).strategy.parse(envelope.payload)` の各
 *     step で同じ `payload` 構造を保つ。unit test `round-trip.test.ts` で全 type
 *     検証。
 *   - **deterministic checksum**: `buildExportEnvelopeV2()` 内部で
 *     `computeChecksum(normalizedPayload)` を計算するため、同一 payload は同一
 *     checksum。改竄検知 + corruption 検知。
 *   - **type 安全**: 戻り値は `ExportEnvelopeV2` だが、`typeCode` で discriminated
 *     union が分岐し、`payload` 型が type 別に推論される。
 *
 * 旧 v1 `/api/v1/activities/export` (formatVersion: '1.0') との互換は
 * `migrateV1ActivityPackToV2()` (export-schema.ts) で別経路担保。
 *
 * 関連:
 *   - ADR-0052 (Marketplace Strategy + Registry)
 *   - Issue #2372 / EPIC #2362
 *   - src/lib/marketplace/dispatcher.ts (import 側 dispatcher)
 */

import { buildExportEnvelopeV2, type ExportEnvelopeV2 } from './export-schema.js';
import type { MarketplaceTypeId } from './schemas/index.js';

/**
 * export 入力。
 *
 * @property typeCode     対象 MarketplaceTypeCode
 * @property payload      Strategy.parse() の output と同じ shape (DB から組み立てた値)
 * @property exportedAt   任意の ISO datetime (default: 現在時刻 UTC)
 */
export interface DispatchExportInput {
	typeCode: MarketplaceTypeId;
	payload: unknown;
	exportedAt?: string;
}

/**
 * type 別 payload を v2 envelope に詰めて返す。
 *
 * **DB → payload の組み立ては呼出側の責務**。本 dispatcher は (a) schema validation
 * + (b) checksum 計算 + (c) envelope 化のみを担当する純粋関数的 service。
 *
 * `payload` 引数が schema を満たさなければ `buildExportEnvelopeV2()` 内部の
 * `v.parse()` で throw する (fail-fast)。
 *
 * @returns v2 envelope (checksum 付き)
 * @throws  Error payload schema validation 失敗時
 */
export function dispatchExport(input: DispatchExportInput): ExportEnvelopeV2 {
	const { typeCode, payload, exportedAt } = input;
	return buildExportEnvelopeV2(typeCode, payload, exportedAt);
}

/**
 * payload を deterministic に envelope 化して JSON 文字列として返す。
 *
 * 主に HTTP response body (`Content-Type: application/json`) への直接書き出し
 * 用途。`JSON.stringify(dispatchExport(...))` と等価だが、改竄検知の安定性のため
 * envelope 内部 deterministic stringify (`computeChecksum()` 経路) と一貫した
 * 書式で出力したい場合に使う。
 */
export function dispatchExportToJson(input: DispatchExportInput): string {
	return JSON.stringify(dispatchExport(input));
}
