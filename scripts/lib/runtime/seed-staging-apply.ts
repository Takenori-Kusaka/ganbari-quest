// scripts/lib/runtime/seed-staging-apply.ts — 合成 staging dataset の pg-core backend 流し込み (#3412)
//
// buildSyntheticStagingDataset (src/lib/server/demo/synthetic-staging-dataset.ts) の出力を
// PGlite / DSQL (pg-core 新 schema) へ seed する共通 core。呼び出し側 (CLI / vitest) が
// DATA_SOURCE と接続 (initPgliteConnection 等) を確立してから呼ぶ。
//
// 既存資産の再利用 (#1442 / ADR-0066):
//   - 家族データの流し込みは importFamilyData (backup wire format) を verbatim mode で再利用
//     (nuc-pglite-cutover.ts import と同型。専用 insert 経路は作らない)
//   - 件数突合は nuc-cutover-verify (summarizeExportCounts / collectImportedCounts) を再利用
//   - trial 行は factory の trialHistory repo (ITrialHistoryRepo.insert) を再利用
//
// tenant メタ (families 行) のみ本 module が drizzle 直 insert する (auth repo の createTenant は
// owner user 前提のため合成 seed には過剰。ownerUserId は nullable で families 単独 insert 可能)。

import type { SqlExecutor } from '../../../src/lib/server/db/dsql/sql-executor';
import type {
	SyntheticStagingDataset,
	SyntheticTenant,
} from '../../../src/lib/server/demo/synthetic-staging-dataset';
import {
	collectImportedCounts,
	diffCutoverCounts,
	summarizeExportCounts,
} from './nuc-cutover-verify';

export interface SeedTenantResult {
	key: string;
	tenantUuid: string;
	children: number;
	importedCounts: Record<string, number> | null;
	trial: { startDate: string; endDate: string; tier: string } | null;
}

export interface SeedApplyResult {
	anchorDate: string;
	tenants: SeedTenantResult[];
}

/**
 * 合成 dataset を pg-core backend へ seed する。
 * 前提: 呼び出し側で DATA_SOURCE (pglite/dsql) と接続が確立済み。fresh DB (空 tenant) を想定し
 * verbatim import する (既存データがある DB への merge は本 seed の対象外)。
 * import error / 件数突合不一致は throw する (部分成功の silent 継続はしない)。
 *
 * db は drizzle pg db (PGlite / DSQL 共通 schema)。公開型は件数突合が要求する SqlExecutor に
 * 留め、families insert のみ内部で構造的 cast する (drizzle の insert builder generics を
 * 公開 contract に持ち込むと backend 別 db 型 (PgliteDatabase 等) が variance で不適合になるため)。
 */
export async function applySyntheticDataset(
	dataset: SyntheticStagingDataset,
	db: SqlExecutor,
): Promise<SeedApplyResult> {
	const insertDb = db as unknown as {
		insert(table: unknown): { values(v: Record<string, unknown>): PromiseLike<unknown> };
	};
	const { families } = await import('../../../src/lib/server/db/dsql/schema');
	const { getRepos } = await import('../../../src/lib/server/db/factory');
	const { importFamilyData } = await import('../../../src/lib/server/services/import-service');
	const { resolveTrialWindow } = await import(
		'../../../src/lib/server/demo/synthetic-staging-dataset'
	);
	const repos = getRepos();

	const results: SeedTenantResult[] = [];
	for (const tenant of dataset.tenants) {
		const trialWindow = tenant.trial ? resolveTrialWindow(tenant.trial, dataset.anchorDate) : null;

		// 1. tenant メタ (families 行)。plan / trialUsedAt が plan 軸 (D4) / trial 軸 (D6) の実データ
		await insertDb.insert(families).values({
			familyId: tenant.tenantUuid,
			name: tenant.family.name,
			ownerUserId: null,
			status: tenant.family.status,
			plan: tenant.family.plan,
			trialUsedAt: trialWindow ? `${trialWindow.startDate}T00:00:00.000Z` : null,
		});

		// 2. trial 履歴 (D6: active / expired は start/end offset の解決値で表現)
		if (tenant.trial && trialWindow) {
			await repos.trialHistory.insert({
				tenantId: tenant.tenantUuid,
				startDate: trialWindow.startDate,
				endDate: trialWindow.endDate,
				tier: tenant.trial.tier,
				source: 'synthetic-seed',
				trialStartSource: 'synthetic-seed',
			});
		}

		// 3. 家族データ (wire format → importFamilyData verbatim、cutover import と同型)
		let importedCounts: Record<string, number> | null = null;
		if (tenant.data && tenant.data.family.children.length > 0) {
			const result = await importFamilyData(tenant.data, tenant.tenantUuid, undefined, {
				mode: 'verbatim',
			});
			if (result.errors.length > 0) {
				throw new Error(
					`[seed-staging] tenant ${tenant.key} の import で hard error (${result.errors.length} 件): ${result.errors.join(' / ')}`,
				);
			}
			// 4. 件数突合 (nuc-cutover-verify 再利用、1 件でも不一致なら abort)
			const expected = summarizeExportCounts(tenant.data);
			const actual = await collectImportedCounts(db, tenant.tenantUuid);
			const mismatches = diffCutoverCounts(expected, actual);
			if (mismatches.length > 0) {
				throw new Error(
					`[seed-staging] tenant ${tenant.key} の件数突合が不一致 (${mismatches.length} 軸): ${mismatches.join(' / ')}`,
				);
			}
			importedCounts = actual;
		}

		results.push({
			key: tenant.key,
			tenantUuid: tenant.tenantUuid,
			children: tenant.data?.family.children.length ?? 0,
			importedCounts,
			trial: trialWindow && tenant.trial ? { ...trialWindow, tier: tenant.trial.tier } : null,
		});
	}

	return { anchorDate: dataset.anchorDate, tenants: results };
}

/** SyntheticTenant の再 export (CLI 側の型参照用)。 */
export type { SyntheticTenant };
