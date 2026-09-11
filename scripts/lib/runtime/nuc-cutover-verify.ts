// scripts/lib/runtime/nuc-cutover-verify.ts
// EPIC #3620 AC-C4 後段 — NUC cutover (旧 sqlite → PGlite) の件数突合 safety net。
//
// 役割: cutover CLI の import 完了後に「export した件数 = 新 backend に入った件数」を機械突合し、
// 1 件でも不一致なら abort (errors>0 abort、ADR-0064 §ロールバック保証) の判定材料を返す。
// 内容の正当性 (フィールド保全 / 自然キー再結合) は cross-backend round-trip test
// (tests/unit/services/pglite-cutover-roundtrip.test.ts) が担保済みのため、本 module は
// **件数の完全性**に限定する (実データは家庭ごとに中身が違うため、実 cutover 時の検証は件数軸)。
//
// 軸の選定: ExportTransactionData の主要 per-child 実体 + family master。settings /
// checklistLogs 等は import 側で allowlist filter / dedup が正当に件数を変えうるため対象外
// (突合軸は「import が 1:1 で書くことが round-trip test で実証済みの実体」に限る)。

import type { ExportData } from '../../../src/lib/domain/export-format';
import type { SqlExecutor } from '../../../src/lib/server/db/dsql/sql-executor';

/** 突合軸: export 側 field → 新 backend (pg-core) のテーブル。 */
export const CUTOVER_COUNT_AXES = [
	{ key: 'children', table: 'children' },
	{ key: 'childActivities', table: 'child_activities' },
	{ key: 'activityLogs', table: 'activity_logs' },
	{ key: 'pointLedger', table: 'point_ledger' },
	{ key: 'specialRewards', table: 'special_rewards' },
	{ key: 'rewardRedemptions', table: 'reward_redemption_requests' },
	{ key: 'childChallenges', table: 'child_challenges' },
	{ key: 'stampCards', table: 'stamp_cards' },
	{ key: 'evaluations', table: 'evaluations' },
	{ key: 'loginStreaks', table: 'login_streaks' },
	{ key: 'checklistTemplates', table: 'checklist_templates' },
	{ key: 'parentMessages', table: 'parent_messages' },
] as const;

export type CutoverCounts = Record<(typeof CUTOVER_COUNT_AXES)[number]['key'], number>;

/** export JSON から突合軸の件数を集計する。 */
export function summarizeExportCounts(data: ExportData): CutoverCounts {
	const tx = data.data;
	return {
		children: data.family.children.length,
		childActivities: tx.childActivities.length,
		activityLogs: tx.activityLogs.length,
		pointLedger: tx.pointLedger.length,
		specialRewards: tx.specialRewards.length,
		rewardRedemptions: tx.rewardRedemptions.length,
		childChallenges: tx.childChallenges.length,
		stampCards: tx.stampCards.length,
		evaluations: tx.evaluations.length,
		loginStreaks: tx.loginStreaks.length,
		checklistTemplates: tx.checklistTemplates.length,
		parentMessages: tx.parentMessages.length,
	};
}

/** import 先 (pg-core backend) から同じ軸の件数を tenant 限定で収集する。 */
export async function collectImportedCounts(
	db: SqlExecutor,
	tenantId: string,
): Promise<CutoverCounts> {
	const { sql } = await import('drizzle-orm');
	const counts = {} as Record<string, number>;
	for (const axis of CUTOVER_COUNT_AXES) {
		const res = await db.execute(
			sql`SELECT count(*)::int AS c FROM ${sql.raw(axis.table)} WHERE family_id = ${tenantId}`,
		);
		counts[axis.key] = Number((res.rows[0] as { c: number }).c);
	}
	return counts as CutoverCounts;
}

/** 期待 (export) と実測 (imported) を突合し、不一致の説明文一覧を返す (空 = 完全一致)。 */
export function diffCutoverCounts(expected: CutoverCounts, actual: CutoverCounts): string[] {
	const mismatches: string[] = [];
	for (const axis of CUTOVER_COUNT_AXES) {
		const e = expected[axis.key];
		const a = actual[axis.key];
		if (e !== a) {
			mismatches.push(`${axis.key} (${axis.table}): export=${e} imported=${a}`);
		}
	}
	return mismatches;
}
