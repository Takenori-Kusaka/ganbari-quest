/**
 * reward-set ImportStrategy — ADR-0052 (Issue #2366)
 *
 * 旧 `src/lib/server/services/reward-set-import-service.ts` (167 行) を
 * `ImportStrategy<RewardSetPayload>` に rewrap した Strategy 実装。
 *
 * 設計原則 (ADR-0052):
 *   - `parse()`: Valibot RewardSetPayloadSchema 経由で validation
 *   - `preview()`: DB write 禁止、件数集計のみ
 *   - `apply()`: importRewardSet を呼んで実 DB write、結果集計
 *   - tenant 強制: `ctx.tenantId` を全メソッドで必須使用
 *   - **childId 必須**: reward-set は子供毎に紐付くため、`ctx.childId` が必須。
 *     未指定時は明確な error throw (Descriptor.requiresChildId=true で表明済み)
 *
 * Strangler Fig (ADR-0052 §3.4):
 *   - 本 Strategy は旧 `importRewardSet` / `previewRewardSetImport` を内部 callee として参照
 *   - 旧 service は 1 release 並行稼働 → 別 Issue で撤去
 *   - 旧 service の callsite を `+page.server.ts` 3 ヶ所に集約 (本 PR)
 *
 * 関連:
 *   - ADR-0052
 *   - $lib/marketplace/schemas/reward-set-schema (#2364)
 *   - $lib/server/services/reward-set-import-service (旧 service、@deprecated)
 */

import * as v from 'valibot';
import {
	type RewardSetPayload,
	RewardSetPayloadSchema,
} from '$lib/marketplace/schemas/reward-set-schema.js';
import type {
	ImportContext,
	ImportPreview,
	ImportResult,
	ImportStrategy,
} from '$lib/marketplace/types.js';
import {
	importRewardSet,
	previewRewardSetImport,
	type RewardSetItem,
} from '$lib/server/services/reward-set-import-service.js';

/**
 * reward-set Strategy 実装 (SSOT)。
 *
 * UI 側は `marketplaceRegistry.get('reward-set').strategy` 経由で参照する
 * ことになるが、現段階 (#2366 / Strangler Fig 期間) は `+page.server.ts` の
 * `dispatchImport()` 経由で間接的に呼ばれるのみ。
 */
export const rewardSetStrategy: ImportStrategy<RewardSetPayload> = {
	parse(input: unknown): RewardSetPayload {
		const result = v.safeParse(RewardSetPayloadSchema, input);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.') ?? '(root)';
			throw new Error(
				`[reward-set-strategy] validation failed at "${path}": ${firstIssue?.message ?? 'unknown'}`,
			);
		}
		return result.output;
	},

	async preview(payload: RewardSetPayload, ctx: ImportContext): Promise<ImportPreview> {
		const { presetId, childId } = requireChildContext(ctx);
		const rewards = payload.rewards as RewardSetItem[];
		const raw = await previewRewardSetImport(rewards, presetId, childId, ctx.tenantId);
		return {
			total: raw.total,
			newItems: raw.newRewards,
			duplicates: raw.duplicates,
			duplicateNames: raw.duplicateTitles,
		};
	},

	async apply(payload: RewardSetPayload, ctx: ImportContext): Promise<ImportResult> {
		const { presetId, childId } = requireChildContext(ctx);

		// dry-run は preview と等価動作 (DB write 禁止)
		if (ctx.dryRun === true) {
			const preview = await this.preview(payload, ctx);
			return {
				imported: 0,
				skipped: preview.duplicates,
				errors: [],
			};
		}

		const rewards = payload.rewards as RewardSetItem[];
		const raw = await importRewardSet(rewards, ctx.tenantId, {
			presetId,
			childId,
		});
		return {
			imported: raw.imported,
			skipped: raw.skipped,
			errors: raw.errors,
		};
	},
};

/**
 * reward-set 固有の必須 context 検証。
 *
 * Descriptor.requiresChildId=true により呼出側 (dispatcher / +page.server.ts) で
 * childId 注入が期待されるが、interface レベルでは optional のため
 * Strategy 内で明示的に error を返して fail-fast する。
 *
 * presetId も sourcePresetId 重複検知 (#1254 G1) のため必須。
 */
function requireChildContext(ctx: ImportContext): { presetId: string; childId: number } {
	if (!ctx.childId) {
		throw new Error(
			'[reward-set-strategy] childId is required (Descriptor.requiresChildId=true). Pass ctx.childId in dispatchImport().',
		);
	}
	if (!ctx.presetId) {
		throw new Error(
			'[reward-set-strategy] presetId is required for sourcePresetId duplicate detection (#1254 G1). Pass ctx.presetId in dispatchImport().',
		);
	}
	return { presetId: ctx.presetId, childId: ctx.childId };
}
