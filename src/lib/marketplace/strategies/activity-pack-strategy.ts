/**
 * activity-pack ImportStrategy — ADR-0052 (Issue #2365)
 *
 * 旧 `src/lib/server/services/activity-import-service.ts` (151 行) を
 * `ImportStrategy<ActivityPackPayload>` に rewrap した Strategy 実装。
 *
 * 設計原則 (ADR-0052):
 *   - `parse()`: Valibot schema 経由で validation
 *   - `preview()`: DB write 禁止、件数集計のみ
 *   - `apply()`: importActivities を呼んで実 DB write、結果集計
 *   - tenant 強制: `ctx.tenantId` を全メソッドで必須使用
 *
 * Strangler Fig (ADR-0052 §3.4):
 *   - 本 Strategy は旧 `importActivities` / `previewActivityImport` を内部 callee として参照
 *   - 旧 service は 1 release 並行稼働 → 別 Issue で撤去
 *   - 旧 service の callsite を `+page.server.ts` 1 ヶ所に集約 (本 PR)
 *
 * 関連:
 *   - ADR-0052
 *   - $lib/marketplace/schemas/activity-pack-schema (#2364)
 *   - $lib/server/services/activity-import-service (旧 service、@deprecated)
 */

import * as v from 'valibot';
import type { ActivityPackItem } from '$lib/domain/activity-pack';
import {
	type ActivityPackPayload,
	ActivityPackPayloadSchema,
} from '$lib/marketplace/schemas/activity-pack-schema.js';
import type {
	ImportContext,
	ImportPreview,
	ImportResult,
	ImportStrategy,
} from '$lib/marketplace/types.js';
import {
	importActivities,
	previewActivityImport,
} from '$lib/server/services/activity-import-service.js';

/**
 * activity-pack Strategy 実装 (SSOT)。
 *
 * UI 側は `marketplaceRegistry.get('activity-pack').strategy` 経由で参照する
 * ことになるが、現段階 (#2365 / Strangler Fig 期間) は `+page.server.ts` の
 * `dispatchImport()` 経由で間接的に呼ばれるのみ。
 */
export const activityPackStrategy: ImportStrategy<ActivityPackPayload> = {
	parse(input: unknown): ActivityPackPayload {
		const result = v.safeParse(ActivityPackPayloadSchema, input);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.') ?? '(root)';
			throw new Error(
				`[activity-pack-strategy] validation failed at "${path}": ${firstIssue?.message ?? 'unknown'}`,
			);
		}
		return result.output;
	},

	async preview(payload: ActivityPackPayload, ctx: ImportContext): Promise<ImportPreview> {
		const activities = payload.activities as ActivityPackItem[];
		const raw = await previewActivityImport(activities, ctx.tenantId);
		return {
			total: raw.total,
			newItems: raw.newActivities,
			duplicates: raw.duplicates,
			duplicateNames: raw.duplicateNames,
			byCategory: raw.byCategory,
		};
	},

	async apply(payload: ActivityPackPayload, ctx: ImportContext): Promise<ImportResult> {
		// dry-run は preview と等価動作 (DB write 禁止)
		if (ctx.dryRun === true) {
			const preview = await this.preview(payload, ctx);
			return {
				imported: 0,
				skipped: preview.duplicates,
				errors: [],
			};
		}

		const activities = payload.activities as ActivityPackItem[];
		const raw = await importActivities(activities, ctx.tenantId, {
			presetId: ctx.presetId,
			applyMustDefault: ctx.applyMustDefault,
		});
		return {
			imported: raw.imported,
			skipped: raw.skipped,
			errors: raw.errors,
		};
	},
};
