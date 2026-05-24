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
	importRewardSetToChildren,
	previewRewardSetImport,
	type RewardSetItem,
} from '$lib/server/services/reward-set-import-service.js';

/**
 * reward-set Strategy 固有の per-child context narrowing (#2362 PR-4、ADR-0055)。
 *
 * Discriminated union により `childIds` (per-child 配信) と `childId` (legacy 単一) を
 * 明確に区別する。呼出側 (dispatchImport / +page.server.ts) は以下のいずれかを必ず注入:
 *
 *   - `child-selection`: `ctx.childIds` 配列 (新規、PR-4 の admin/rewards ChildSelectionDialog 経由)
 *   - `legacy-single`:   `ctx.childId` 単一 (既存、backward compat for 旧 admin/rewards form)
 *
 * 両方欠落時は明確に error throw (Descriptor.requiresChildId=true の保証)。
 */
export type RewardSetChildContext =
	| { kind: 'child-selection'; presetId: string; childIds: readonly number[] }
	| { kind: 'legacy-single'; presetId: string; childId: number };

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
		const narrowed = narrowChildContext(ctx);
		const rewards = payload.rewards as RewardSetItem[];
		// preview は重複検知が child 単位で意味を持つため、複数 child 時は
		// 最初の child について preview を返す (件数提示は概算で十分、ADR-0055 §3.2)。
		const previewChildId =
			narrowed.kind === 'legacy-single' ? narrowed.childId : (narrowed.childIds[0] ?? 0);
		const raw = await previewRewardSetImport(
			rewards,
			narrowed.presetId,
			previewChildId,
			ctx.tenantId,
		);
		return {
			total: raw.total,
			newItems: raw.newRewards,
			duplicates: raw.duplicates,
			duplicateNames: raw.duplicateTitles,
		};
	},

	async apply(payload: RewardSetPayload, ctx: ImportContext): Promise<ImportResult> {
		const narrowed = narrowChildContext(ctx);

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
		if (narrowed.kind === 'child-selection') {
			// #2362 PR-4 (ADR-0055): per-child fan-out (admin/rewards ChildSelectionDialog 経由)
			const raw = await importRewardSetToChildren(rewards, ctx.tenantId, {
				presetId: narrowed.presetId,
				childIds: narrowed.childIds,
			});
			return {
				imported: raw.imported,
				skipped: raw.skipped,
				errors: raw.errors,
			};
		}
		// legacy-single: 既存 admin/rewards 手動 form 互換
		const raw = await importRewardSet(rewards, ctx.tenantId, {
			presetId: narrowed.presetId,
			childId: narrowed.childId,
		});
		return {
			imported: raw.imported,
			skipped: raw.skipped,
			errors: raw.errors,
		};
	},
};

/**
 * reward-set 固有の必須 context 検証 + discriminated union narrowing。
 *
 * Descriptor.requiresChildId=true により呼出側 (dispatcher / +page.server.ts) で
 * childId / childIds 注入が期待されるが、interface (`ImportContext`) レベルでは
 * 両方 optional のため Strategy 内で discriminated union に narrow して fail-fast する。
 *
 * - `ctx.childIds` が non-empty なら `child-selection` (PR-4 新規動線)
 * - `ctx.childId` が存在すれば `legacy-single` (既存 admin form 互換)
 * - 両方欠落時は throw (取込ダイアログを抜けたとき必ずどちらかが入る保証)
 *
 * presetId も sourcePresetId 重複検知 (#1254 G1) のため必須。
 */
export function narrowChildContext(ctx: ImportContext): RewardSetChildContext {
	if (!ctx.presetId) {
		throw new Error(
			'[reward-set-strategy] presetId is required for sourcePresetId duplicate detection (#1254 G1). Pass ctx.presetId in dispatchImport().',
		);
	}
	if (ctx.childIds && ctx.childIds.length > 0) {
		return { kind: 'child-selection', presetId: ctx.presetId, childIds: ctx.childIds };
	}
	if (ctx.childId && ctx.childId > 0) {
		return { kind: 'legacy-single', presetId: ctx.presetId, childId: ctx.childId };
	}
	throw new Error(
		'[reward-set-strategy] childIds (per-child selection) or childId (legacy) is required (Descriptor.requiresChildId=true). Pass ctx.childIds or ctx.childId in dispatchImport().',
	);
}
