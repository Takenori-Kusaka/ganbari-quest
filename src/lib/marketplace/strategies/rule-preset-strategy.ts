/**
 * rule-preset ImportStrategy — ADR-0052 (Issue #2368)
 *
 * 旧 `src/lib/server/services/rule-preset-import-service.ts` (390 行 / 4 ruleType 分岐 switch)
 * を `ImportStrategy<RulePresetPayload>` に rewrap した Strategy 実装。
 *
 * 設計原則 (ADR-0052 §3):
 *   - 4 ruleType (exchange / bonus / penalty / special) を **Strategy 内部 sub-dispatcher**
 *     に集約。ruleType 別の dispatch を interface contract で破られない設計
 *   - 各 ruleType の実装は `./rule-preset/<ruleType>.ts` に分離 (Strategy 内 OCP)
 *   - `parse()`: Valibot schema 経由で validation (#2364)
 *   - `preview()`: DB write 禁止、件数集計 + alreadyImported 判定
 *   - `apply()`: ruleType 別 sub-strategy に dispatch、結果を `ImportResult` に正規化
 *   - tenant 強制: `ctx.tenantId` を全メソッドで必須使用
 *
 * 4 ruleType 動作差異:
 *   - **exchange** → `special_rewards` に各 rule を挿入 (childId 必須)
 *   - **bonus**    → `settings.rule_preset_bonus_overrides` に preset 全体を追記
 *   - **penalty**  → ADR-0012 §6 で慎重審査中、no-op + audit log + warning
 *   - **special**  → 将来枠、no-op + audit log + warning
 *
 * Strangler Fig (ADR-0052 §3.4):
 *   - 本 Strategy は旧 `rule-preset-import-service.ts` の挙動を sub-strategy 群に
 *     分割しつつ等価機能を提供
 *   - 旧 service は 1 release 並行稼働 (@deprecated marker)
 *   - bonus state KVS の SSOT は `./rule-preset/bonus-state.ts` に集約済 — 旧 service
 *     の `loadBonusOverrides` は本 SSOT への薄い re-export に縮退
 *
 * rule-preset 固有戻り値 (warnings / ruleType / alreadyImported) は generic
 * `ImportResult` に収まらないため、registry 経由で本 Strategy を取得した callsite が
 * `previewRulePreset()` / `applyRulePreset()` 拡張 method を直接呼ぶ。
 *
 * 関連:
 *   - ADR-0052 (MarketplaceTypeRegistry + ImportStrategy)
 *   - ADR-0012 §6 (Anti-engagement の penalty 制限)
 *   - ADR-0023 archive (tenant isolation 強制)
 *   - $lib/marketplace/schemas/rule-preset-schema (#2364)
 *   - $lib/server/services/rule-preset-import-service (旧 service、@deprecated)
 */

import * as v from 'valibot';
import {
	type RulePresetPayload,
	RulePresetPayloadSchema,
} from '$lib/marketplace/schemas/rule-preset-schema.js';
import type {
	ImportContext,
	ImportPreview,
	ImportResult,
	ImportStrategy,
} from '$lib/marketplace/types.js';
import { logger } from '$lib/server/logger';
import { applyBonus, previewBonus } from './rule-preset/bonus.js';
import { applyExchange, previewExchange } from './rule-preset/exchange.js';
import { applyPenalty } from './rule-preset/penalty.js';
import { applySpecial } from './rule-preset/special.js';

/**
 * rule-preset の preset identity (preview / apply 拡張 method の追加引数 SSOT)。
 *
 * `ImportContext` には generic field しかないため、preset 単位の identity
 * (id / 表示名 / icon) を別 interface で渡す。callsite はこの interface を
 * 作って `previewRulePreset()` / `applyRulePreset()` を呼ぶ。
 */
export interface RulePresetIdentity {
	presetId: string;
	presetName: string;
	presetIcon: string;
}

/** rule-preset preview の拡張戻り値 (alreadyImported / ruleType を含む) */
export interface RulePresetPreviewResult {
	presetId: string;
	presetName: string;
	presetIcon: string;
	ruleType: RulePresetPayload['ruleType'];
	ruleCount: number;
	alreadyImported: boolean;
}

/** rule-preset apply の拡張戻り値 (warnings を含む) */
export interface RulePresetApplyResult {
	imported: number;
	skipped: number;
	warnings: string[];
	errors: string[];
}

/**
 * rule-preset Strategy 実装 (SSOT、Issue #2368)。
 *
 * generic `ImportStrategy<RulePresetPayload>` interface を満たしつつ、
 * rule-preset 固有戻り値 (warnings / ruleType / alreadyImported) を扱う
 * 拡張 method (`previewRulePreset` / `applyRulePreset`) を追加で提供する。
 */
export const rulePresetStrategy: ImportStrategy<RulePresetPayload> & {
	previewRulePreset: (
		identity: RulePresetIdentity,
		payload: RulePresetPayload,
		ctx: ImportContext,
	) => Promise<RulePresetPreviewResult>;
	applyRulePreset: (
		identity: RulePresetIdentity,
		payload: RulePresetPayload,
		ctx: ImportContext,
	) => Promise<RulePresetApplyResult>;
} = {
	parse(input: unknown): RulePresetPayload {
		const result = v.safeParse(RulePresetPayloadSchema, input);
		if (!result.success) {
			const firstIssue = result.issues[0];
			const path = firstIssue?.path?.map((p) => p.key).join('.') ?? '(root)';
			throw new Error(
				`[rule-preset-strategy] validation failed at "${path}": ${firstIssue?.message ?? 'unknown'}`,
			);
		}
		return result.output;
	},

	/**
	 * generic preview: identity 情報を持たない呼び出し用に簡易版を提供する。
	 * 通常は `previewRulePreset()` を使う。
	 */
	async preview(payload: RulePresetPayload, _ctx: ImportContext): Promise<ImportPreview> {
		return {
			total: payload.rules.length,
			newItems: payload.rules.length,
			duplicates: 0,
			duplicateNames: [],
		};
	},

	/**
	 * generic apply: identity 情報を持たない呼び出し用の縮退版。
	 * 通常は `applyRulePreset()` を使う (warnings / alreadyImported 検知のため)。
	 *
	 * ctx.presetId が無い場合は `errors` で fail-fast (rule-preset は identity 必須)。
	 */
	async apply(payload: RulePresetPayload, ctx: ImportContext): Promise<ImportResult> {
		if (ctx.dryRun === true) {
			return { imported: 0, skipped: 0, errors: [], failed: 0 };
		}
		if (!ctx.presetId) {
			return {
				imported: 0,
				skipped: 0,
				errors: [
					'[rule-preset-strategy] apply() には ctx.presetId が必要です — 通常は applyRulePreset() を使ってください',
				],
				// #2830: presetId 欠落は 1 件の構成エラー (取込対象 0)。
				failed: 1,
			};
		}
		const result = await this.applyRulePreset(
			{ presetId: ctx.presetId, presetName: ctx.presetId, presetIcon: '' },
			payload,
			ctx,
		);
		return {
			imported: result.imported,
			skipped: result.skipped,
			errors: [...result.errors, ...result.warnings],
			// #2830: errors 配列は warnings (already-imported 等の非失敗) を畳み込むため、
			//   実失敗件数は genuine error のみ (warnings を除外) で算出する。
			failed: result.errors.length,
		};
	},

	// =====================================================
	// 拡張 method: rule-preset 固有 戻り値 (warnings / ruleType / alreadyImported)
	// =====================================================

	async previewRulePreset(
		identity: RulePresetIdentity,
		payload: RulePresetPayload,
		ctx: ImportContext,
	): Promise<RulePresetPreviewResult> {
		const ruleType = payload.ruleType;
		const base = {
			presetId: identity.presetId,
			presetName: identity.presetName,
			presetIcon: identity.presetIcon,
			ruleType,
			ruleCount: payload.rules.length,
		};

		if (ruleType === 'exchange') {
			const r = await previewExchange(identity.presetId, payload, ctx.tenantId, ctx.childId);
			return { ...base, alreadyImported: r.alreadyImported };
		}
		if (ruleType === 'bonus') {
			const r = await previewBonus(identity.presetId, payload, ctx.tenantId);
			return { ...base, alreadyImported: r.alreadyImported };
		}
		// penalty / special: 常に false (取込試行のたびに warning が積まれる)
		return { ...base, alreadyImported: false };
	},

	async applyRulePreset(
		identity: RulePresetIdentity,
		payload: RulePresetPayload,
		ctx: ImportContext,
	): Promise<RulePresetApplyResult> {
		const ruleType = payload.ruleType;
		const tenantId = ctx.tenantId;

		// dryRun: DB write 禁止、preview と等価な空結果
		if (ctx.dryRun === true) {
			return { imported: 0, skipped: 0, warnings: [], errors: [] };
		}

		// sub-dispatcher: ruleType 別の処理を内部で完結させる
		let result: RulePresetApplyResult;

		if (ruleType === 'exchange') {
			const r = await applyExchange(identity.presetId, payload, tenantId, ctx.childId);
			result = { imported: r.imported, skipped: r.skipped, warnings: [], errors: r.errors };
		} else if (ruleType === 'bonus') {
			const r = await applyBonus(
				identity.presetId,
				identity.presetName,
				identity.presetIcon,
				payload,
				tenantId,
			);
			result = { imported: r.imported, skipped: r.skipped, warnings: [], errors: r.errors };
		} else if (ruleType === 'penalty') {
			const r = await applyPenalty(identity.presetId, tenantId);
			result = {
				imported: r.imported,
				skipped: r.skipped,
				warnings: r.warnings,
				errors: r.errors,
			};
		} else {
			// special
			const r = await applySpecial(identity.presetId, tenantId);
			result = {
				imported: r.imported,
				skipped: r.skipped,
				warnings: r.warnings,
				errors: r.errors,
			};
		}

		logger.info('[rule-preset-strategy] インポート完了', {
			context: {
				tenantId,
				presetId: identity.presetId,
				ruleType,
				imported: result.imported,
				skipped: result.skipped,
				warnings: result.warnings.length,
				errors: result.errors.length,
			},
		});

		return result;
	},
};
