/**
 * Marketplace export schema v2 SSOT — Issue #2372 (EPIC #2362 P4).
 *
 * 5 type 全 marketplace payload (activity-pack / reward-set / checklist /
 * rule-preset / challenge-set) の export 出力 envelope を統一する。
 *
 * 設計原則:
 *   - **v2 envelope**: `{ schemaVersion: 2, typeCode, exportedAt, payload, checksum }`
 *     一定の formal shape で全 type を統一。typeCode で `payload` 内部 schema を
 *     dispatch する。
 *   - **deterministic JSON**: `payload` は schema 定義準拠の structure を持ち、
 *     `checksum` は `computeChecksum(payload)` で計算される。
 *   - **後方互換 v1**: 旧 `/api/v1/activities/export` の 1.0 format も migration
 *     できるよう、`migrateV1ActivityPackToV2()` を提供する。
 *   - **round-trip 保証**: `parseExportEnvelope(JSON.parse(envelope))` で型安全に
 *     dispatch でき、`payload` を Strategy.parse() に渡せば apply まで完結する。
 *
 * 関連:
 *   - ADR-0052 (Marketplace Strategy + Registry)
 *   - ADR-0006 (後方互換性)
 *   - Issue #2372 / EPIC #2362
 */

import * as v from 'valibot';
import { computeChecksum, verifyChecksum } from './checksum.js';
import {
	ActivityPackPayloadSchema,
	ChallengeSetPayloadSchema,
	ChecklistPayloadSchema,
	MarketplacePayloadSchemaMap,
	type MarketplaceTypeId,
	RewardSetPayloadSchema,
	RulePresetPayloadSchema,
} from './schemas/index.js';

// ── 定数 ─────────────────────────────────────────────────────────

/** 現行 schema version。新規 export は常にこの値を使う */
export const EXPORT_SCHEMA_VERSION = 2 as const;

/** typeCode に対応する payload schema map (#2364 SSOT を再 export) */
export { MarketplacePayloadSchemaMap };

// ── v2 envelope schema ──────────────────────────────────────────

/**
 * payload 内部 schema は typeCode で分岐。Valibot `variant` で discriminated union を
 * 構築。Strategy 側の `parse()` は同じ schema を使うため round-trip で型が一致する。
 */
const TypedPayloadSchema = v.variant('typeCode', [
	v.object({
		typeCode: v.literal('activity-pack'),
		payload: ActivityPackPayloadSchema,
	}),
	v.object({
		typeCode: v.literal('reward-set'),
		payload: RewardSetPayloadSchema,
	}),
	v.object({
		typeCode: v.literal('checklist'),
		payload: ChecklistPayloadSchema,
	}),
	v.object({
		typeCode: v.literal('rule-preset'),
		payload: RulePresetPayloadSchema,
	}),
	v.object({
		typeCode: v.literal('challenge-set'),
		payload: ChallengeSetPayloadSchema,
	}),
]);

/**
 * v2 export envelope schema (Valibot)。
 *
 * - `schemaVersion`: 必ず `2`
 * - `typeCode` + `payload`: discriminated union (TypedPayloadSchema)
 * - `exportedAt`: ISO 8601 datetime (UTC 推奨)
 * - `checksum`: `computeChecksum(payload)` の SHA-256 hex (64 文字)
 */
export const ExportEnvelopeV2Schema = v.pipe(
	v.intersect([
		v.object({
			schemaVersion: v.literal(EXPORT_SCHEMA_VERSION),
			exportedAt: v.pipe(
				v.string('exportedAt は文字列で指定してください'),
				v.minLength(1, 'exportedAt は必須です'),
			),
			checksum: v.pipe(
				v.string('checksum は文字列で指定してください'),
				v.length(64, 'checksum は 64 文字 (SHA-256 hex) で指定してください'),
			),
		}),
		TypedPayloadSchema,
	]),
);

/** v2 envelope の TypeScript 型 */
export type ExportEnvelopeV2 = v.InferOutput<typeof ExportEnvelopeV2Schema>;

// ── v1 envelope (legacy: activity-pack 専用) ───────────────────

/**
 * 旧 `/api/v1/activities/export` の出力 schema (formatVersion '1.0')。
 *
 * `formatVersion: '1.0'` + activity-pack 構造をそのまま JSON 出力していた形式。
 * checksum も typeCode もないため、import 時に migration が必要。
 */
export const LegacyV1ActivityPackEnvelopeSchema = v.object({
	formatVersion: v.literal('1.0'),
	packId: v.optional(v.string()),
	packName: v.optional(v.string()),
	description: v.optional(v.string()),
	icon: v.optional(v.string()),
	targetAgeMin: v.optional(v.number()),
	targetAgeMax: v.optional(v.number()),
	tags: v.optional(v.array(v.string())),
	activities: v.array(v.unknown()),
});
export type LegacyV1ActivityPackEnvelope = v.InferOutput<typeof LegacyV1ActivityPackEnvelopeSchema>;

// ── 公開 API ────────────────────────────────────────────────────

/**
 * 新規 v2 export envelope を生成する。
 *
 * @param typeCode   marketplace typeCode
 * @param payload    parse 済み payload (Strategy.parse() の output と同じ shape)
 * @param exportedAt 任意の ISO datetime (default: `new Date().toISOString()`)
 * @returns          v2 envelope (checksum 自動付与)
 */
export function buildExportEnvelopeV2<T extends MarketplaceTypeId>(
	typeCode: T,
	payload: unknown,
	exportedAt: string = new Date().toISOString(),
): ExportEnvelopeV2 {
	// 念のため payload を schema 経由で正規化 (omitted field の除去等で
	// checksum 安定性を担保)
	const schema = MarketplacePayloadSchemaMap[typeCode];
	const normalized = v.parse(schema, payload);
	const checksum = computeChecksum(normalized);

	return {
		schemaVersion: EXPORT_SCHEMA_VERSION,
		typeCode,
		exportedAt,
		payload: normalized,
		checksum,
		// biome-ignore lint/suspicious/noExplicitAny: discriminated union の各 variant が要求する payload 型は typeCode に応じて異なるが、上で v.parse() 済のため runtime 整合
	} as any;
}

/**
 * 任意 JSON 入力を v2 envelope として parse + checksum 検証する。
 *
 * @param input  外部 JSON (typeof = 'object')
 * @returns      parse 済み envelope (checksum 検証 PASS の保証つき)
 * @throws Error parse 失敗 / checksum 不一致時
 */
export function parseExportEnvelopeV2(input: unknown): ExportEnvelopeV2 {
	const result = v.safeParse(ExportEnvelopeV2Schema, input);
	if (!result.success) {
		const firstIssue = result.issues[0];
		const path = firstIssue?.path?.map((p) => p.key).join('.') ?? '(root)';
		throw new Error(
			`[export-schema-v2] validation failed at "${path}": ${firstIssue?.message ?? 'unknown'}`,
		);
	}
	const envelope = result.output;
	if (!verifyChecksum(envelope.payload, envelope.checksum)) {
		throw new Error('[export-schema-v2] checksum mismatch — payload may be corrupted or tampered.');
	}
	return envelope;
}

/**
 * v1 (activity-pack 専用) → v2 envelope への migration。
 *
 * 旧 `/api/v1/activities/export` の出力をそのまま新 import dispatcher に渡せる
 * ようにする後方互換アダプタ。
 *
 * @param input  `{ formatVersion: '1.0', activities: [...] }` 形式
 * @returns      `typeCode: 'activity-pack'` の v2 envelope
 * @throws Error parse 失敗 / activities が空
 */
export function migrateV1ActivityPackToV2(input: unknown): ExportEnvelopeV2 {
	const v1Parsed = v.safeParse(LegacyV1ActivityPackEnvelopeSchema, input);
	if (!v1Parsed.success) {
		throw new Error(
			'[export-schema-v2] migrateV1ActivityPackToV2: input is not a valid v1 activity-pack envelope.',
		);
	}
	const v1 = v1Parsed.output;
	return buildExportEnvelopeV2(
		'activity-pack',
		{ activities: v1.activities },
		new Date().toISOString(),
	);
}

/**
 * 入力が v2 envelope か v1 activity-pack か自動判別して v2 として返す統一 entry。
 *
 * dispatcher 側 (`/api/v1/import` 等) で「version 不明な外部 JSON」を受け取った時に
 * 使う。v2 ならそのまま検証、v1 なら migration 適用。
 *
 * @throws Error どちらの形式でもない場合 / checksum 不一致 (v2)
 */
export function parseAnyExportEnvelope(input: unknown): ExportEnvelopeV2 {
	if (input && typeof input === 'object') {
		const obj = input as Record<string, unknown>;
		if (obj.schemaVersion === EXPORT_SCHEMA_VERSION) {
			return parseExportEnvelopeV2(input);
		}
		if (obj.formatVersion === '1.0') {
			return migrateV1ActivityPackToV2(input);
		}
	}
	throw new Error(
		'[export-schema-v2] unknown envelope format. expected schemaVersion=2 or formatVersion=1.0.',
	);
}
