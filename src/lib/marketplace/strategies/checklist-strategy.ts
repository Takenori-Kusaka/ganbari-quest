/**
 * checklist ImportStrategy — ADR-0052 (Issue #2367)
 *
 * 旧 `src/lib/server/services/checklist-template-import-service.ts` (193 行) を
 * `ImportStrategy<ChecklistPayload>` に rewrap した Strategy 実装。
 *
 * 設計原則 (ADR-0052):
 *   - `parse()`: Valibot schema 経由で validation
 *   - `preview()`: DB write 禁止、atomic unit (preset 全体) の重複判定のみ
 *   - `apply()`: importChecklistTemplate を呼んで実 DB write、結果集計
 *   - tenant 強制: `ctx.tenantId` を全メソッドで必須使用
 *   - **atomic unit 重複検知**: 同一 (childId × sourcePresetId) で
 *     既存 template があれば preset 丸ごとスキップ (per-item 重複検知ではない)
 *   - **childId 必須**: `requiresChildId: true` (reward-set と同型)
 *
 * 設計上の差分（activity-pack との比較）:
 *   - activity-pack: per-item 重複検知 (name 完全一致)、childId 不要
 *   - checklist: per-preset atomic 重複検知 (sourcePresetId)、childId 必須
 *   - 本差分は Strategy 内部に閉じ込め、外部 interface は
 *     ImportPreview / ImportResult で統一 (Strangler Fig 期間の UI 不変性)
 *
 * Strangler Fig (ADR-0052 §3.4):
 *   - 本 Strategy は旧 `importChecklistTemplate` / `previewChecklistImport` を
 *     内部 callee として参照
 *   - 旧 service は 1 release 並行稼働 → 別 Issue で撤去
 *   - 旧 service の callsite を `+page.server.ts` 2 ヶ所 (marketplace + admin) に集約
 *
 * 関連:
 *   - ADR-0052
 *   - $lib/marketplace/schemas/checklist-schema (#2364)
 *   - $lib/server/services/checklist-template-import-service (旧 service、@deprecated)
 */

import * as v from 'valibot';
import {
	type ChecklistPayload,
	ChecklistPayloadSchema,
} from '$lib/marketplace/schemas/checklist-schema.js';
import type {
	ImportContext,
	ImportPreview,
	ImportResult,
	ImportStrategy,
} from '$lib/marketplace/types.js';
import {
	importChecklistTemplate,
	importChecklistTemplateForFamily,
	previewChecklistImport,
} from '$lib/server/services/checklist-template-import-service.js';

/**
 * checklist Strategy 実装 (SSOT)。
 *
 * UI 側は `marketplaceRegistry.get('checklist').strategy` 経由で参照する
 * ことになるが、現段階 (#2367 / Strangler Fig 期間) は `+page.server.ts` の
 * `dispatchImport()` 経由で間接的に呼ばれるのみ。
 *
 * **ctx 拡張**: checklist は preset 単位の atomic unit のため、
 * `ctx.presetId` (sourcePresetId) と `ctx.childId` (取込先) の両方が必須。
 * 旧 service は presetId を第 1 引数として直接受け取っていたが、新 Strategy では
 * `ctx.presetId` 経由で渡す (5 type 統一の ImportContext 形)。
 */
export const checklistStrategy: ImportStrategy<ChecklistPayload> = {
	parse(input: unknown): ChecklistPayload {
		const result = v.safeParse(ChecklistPayloadSchema, input);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.') ?? '(root)';
			throw new Error(
				`[checklist-strategy] validation failed at "${path}": ${firstIssue?.message ?? 'unknown'}`,
			);
		}
		return result.output;
	},

	async preview(payload: ChecklistPayload, ctx: ImportContext): Promise<ImportPreview> {
		const presetId = ctx.presetId;
		// #2362 PR-5: family master 化後、preview の重複判定は family scope (tenant)。
		// childId / childIds は preview には不要だが、Phase 1 後方互換のため childId は引き続き
		// 受け取れる (内部で legacy preview API に渡す)。childIds 経由が優先。
		const hintChildId = ctx.childId ?? ctx.childIds?.[0] ?? 0;
		if (!presetId) {
			throw new Error('[checklist-strategy] ctx.presetId は必須です');
		}

		const raw = await previewChecklistImport(presetId, hintChildId, ctx.tenantId);
		if (!raw) {
			throw new Error(`[checklist-strategy] preset "${presetId}" が見つかりません`);
		}

		// atomic unit 重複検知: 既に取込済なら全 items が duplicate、未取込なら全 items が new
		const total = payload.items.length;
		if (raw.alreadyImported) {
			return {
				total,
				newItems: 0,
				duplicates: total,
				duplicateNames: raw.existingTemplateName ? [raw.existingTemplateName] : [raw.presetName],
			};
		}
		return {
			total,
			newItems: total,
			duplicates: 0,
			duplicateNames: [],
		};
	},

	async apply(payload: ChecklistPayload, ctx: ImportContext): Promise<ImportResult> {
		const presetId = ctx.presetId;
		if (!presetId) {
			throw new Error('[checklist-strategy] ctx.presetId は必須です');
		}

		// #2362 PR-5 (ADR-0055): ctx に対応する 2 つの取込モードを内部で分岐 (discriminated union 風)。
		//   - family-master-with-distribution: ctx.childIds (複数 child 配信)
		//   - legacy-single-binding: ctx.childId (単一 child 互換、Phase 2 admin UX 移行後撤去予定)
		// どちらも family master template + assignment(s) 1 回作成で同 schema に着地する。
		const kind: 'family-master-with-distribution' | 'legacy-single-binding' =
			ctx.childIds && ctx.childIds.length > 0
				? 'family-master-with-distribution'
				: 'legacy-single-binding';

		if (kind === 'legacy-single-binding' && !ctx.childId) {
			throw new Error('[checklist-strategy] ctx.childId または ctx.childIds のいずれかが必須です');
		}

		// dry-run は preview と等価動作 (DB write 禁止)
		if (ctx.dryRun === true) {
			const preview = await this.preview(payload, ctx);
			return {
				imported: 0,
				skipped: preview.duplicates,
				errors: [],
			};
		}

		const raw =
			kind === 'family-master-with-distribution'
				? await importChecklistTemplateForFamily(presetId, ctx.tenantId, {
						childIds: ctx.childIds as readonly number[],
					})
				: await importChecklistTemplate(presetId, ctx.childId as number, ctx.tenantId);

		return {
			imported: raw.imported,
			skipped: raw.skipped,
			errors: raw.errors,
		};
	},
};
