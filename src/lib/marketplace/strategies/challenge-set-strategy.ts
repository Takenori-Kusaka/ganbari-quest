/**
 * challenge-set ImportStrategy — ADR-0052 (Issue #2369、EPIC #2362 P3)
 *
 * **新規実装** (Issue #2369): 既存 4 type (activity-pack / reward-set / checklist /
 * rule-preset) と異なり、challenge-set は service 不存在の type 漏れ状態だったため、
 * 本 Strategy と同時に `src/lib/server/services/challenge-set-import-service.ts` を
 * 新規実装した。「新 type 追加 1 ファイル増分」設計 (ADR-0052 §3.4) の最初の検証ケース。
 *
 * 設計原則 (ADR-0052):
 *   - `parse()`: Valibot schema (#2364 で導入済) 経由で validation
 *   - `preview()`: DB write 禁止、件数集計のみ (重複判定は title ベース)
 *   - `apply()`: importChallengeSet を呼んで実 DB write、結果集計
 *   - tenant 強制: `ctx.tenantId` を全メソッドで必須使用
 *   - `requiresChildId: false` — sibling_challenges は family scope (全子供を自動エンロール)
 *
 * EPIC #2294 案 B-γ 整合:
 *   - 日本ローカライズ wedge の輸送経路 (日本年間行事パック 15 件入り) を本 Strategy が支える
 *   - 競争タイプ撤去 (#2296) に従い challengeType は cooperative 固定
 *
 * 関連:
 *   - ADR-0052
 *   - $lib/marketplace/schemas/challenge-set-schema (#2364)
 *   - $lib/server/services/challenge-set-import-service (新規 service、本 Strategy が唯一の callsite)
 */

import * as v from 'valibot';
import {
	type ChallengeSetPayload,
	ChallengeSetPayloadSchema,
} from '$lib/marketplace/schemas/challenge-set-schema.js';
import type {
	ImportContext,
	ImportPreview,
	ImportResult,
	ImportStrategy,
} from '$lib/marketplace/types.js';
import {
	importChallengeSet,
	previewChallengeSetImport,
} from '$lib/server/services/challenge-set-import-service.js';

/**
 * challenge-set Strategy 実装 (SSOT)。
 *
 * UI 側は `marketplaceRegistry.get('challenge-set').strategy` 経由で参照する
 * ことになるが、現段階は `+page.server.ts` の `dispatchImport()` 経由で
 * 間接的に呼ばれる。
 */
export const challengeSetStrategy: ImportStrategy<ChallengeSetPayload> = {
	parse(input: unknown): ChallengeSetPayload {
		const result = v.safeParse(ChallengeSetPayloadSchema, input);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.') ?? '(root)';
			throw new Error(
				`[challenge-set-strategy] validation failed at "${path}": ${firstIssue?.message ?? 'unknown'}`,
			);
		}
		return result.output;
	},

	async preview(payload: ChallengeSetPayload, ctx: ImportContext): Promise<ImportPreview> {
		const raw = await previewChallengeSetImport(payload.challenges, ctx.tenantId);
		return {
			total: raw.total,
			newItems: raw.newChallenges,
			duplicates: raw.duplicates,
			duplicateNames: raw.duplicateNames,
			byCategory: raw.byCategory,
		};
	},

	async apply(payload: ChallengeSetPayload, ctx: ImportContext): Promise<ImportResult> {
		// dry-run は preview と等価動作 (DB write 禁止)
		if (ctx.dryRun === true) {
			const preview = await this.preview(payload, ctx);
			return {
				imported: 0,
				skipped: preview.duplicates,
				errors: [],
			};
		}

		const raw = await importChallengeSet(payload.challenges, ctx.tenantId, {
			presetId: ctx.presetId,
			// #2362 PR-7 (User §6): per-child instance 配信
			childIds: ctx.childIds,
		});
		return {
			imported: raw.imported,
			skipped: raw.skipped,
			errors: raw.errors,
		};
	},
};
