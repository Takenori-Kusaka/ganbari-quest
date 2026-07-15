// tests/unit/scripts/nuc-cutover-verify.test.ts
// EPIC #3620 AC-C4 後段 — cutover 件数突合 (nuc-cutover-verify.ts) のテスト。
//
//   [CV1] summarizeExportCounts: ExportData から全 14 軸の件数を集計する
//   [CV2] collectImportedCounts: pg backend から tenant 限定 count を全軸収集する (fake executor)
//   [CV3] diffCutoverCounts: 不一致軸のみを人間可読で列挙 (完全一致 = 空)
//
// CLI 本体 (export→import orchestration) は実プロセス E2E で検証する (PR 記載の実機ログ)。

import { describe, expect, it } from 'vitest';
import {
	CUTOVER_COUNT_AXES,
	type CutoverCounts,
	collectImportedCounts,
	diffCutoverCounts,
	summarizeExportCounts,
} from '../../../scripts/lib/runtime/nuc-cutover-verify';
import type { ExportData } from '../../../src/lib/domain/export-format';
import type { SqlExecutor } from '../../../src/lib/server/db/dsql/sql-executor';

/** 全軸 0 件の ExportData 骨格に、指定 field だけ n 件の placeholder を入れる。 */
function makeExportData(overrides: Partial<Record<string, number>> = {}): ExportData {
	const arr = (key: string): unknown[] => new Array(overrides[key] ?? 0).fill({}) as unknown[];
	return {
		family: { children: arr('children') },
		data: {
			childActivities: arr('childActivities'),
			activityLogs: arr('activityLogs'),
			pointLedger: arr('pointLedger'),
			specialRewards: arr('specialRewards'),
			rewardRedemptions: arr('rewardRedemptions'),
			childChallenges: arr('childChallenges'),
			stampCards: arr('stampCards'),
			evaluations: arr('evaluations'),
			loginBonuses: arr('loginBonuses'),
			checklistTemplates: arr('checklistTemplates'),
			parentMessages: arr('parentMessages'),
			siblingCheers: arr('siblingCheers'),
			restDays: arr('restDays'),
		},
	} as unknown as ExportData;
}

describe('nuc-cutover-verify (#3620 AC-C4 後段、件数突合 safety net)', () => {
	it('[CV1] summarizeExportCounts: 全 14 軸を集計する', () => {
		const counts = summarizeExportCounts(
			makeExportData({ children: 2, activityLogs: 5, restDays: 1 }),
		);
		expect(counts.children).toBe(2);
		expect(counts.activityLogs).toBe(5);
		expect(counts.restDays).toBe(1);
		expect(counts.pointLedger).toBe(0);
		expect(Object.keys(counts).sort()).toEqual(CUTOVER_COUNT_AXES.map((a) => a.key).sort());
	});

	it('[CV2] collectImportedCounts: 全軸に 1 query ずつ発行し count を全軸へ写像する', async () => {
		let calls = 0;
		const fake: SqlExecutor = {
			execute: async () => {
				calls += 1;
				return { rows: [{ c: calls }] }; // 呼び出し順の値を返し「軸ごとに独立 query」を検出可能にする
			},
		};
		const counts = await collectImportedCounts(fake, 'tenant-x');
		expect(calls).toBe(CUTOVER_COUNT_AXES.length);
		// 全軸が埋まり、各軸が独立した query 結果 (1..N) を保持する = 使い回し/取り違えなし
		const values = CUTOVER_COUNT_AXES.map((a) => counts[a.key]);
		expect(values).toEqual(CUTOVER_COUNT_AXES.map((_, i) => i + 1));
	});

	it('[CV3] diffCutoverCounts: 不一致軸のみ列挙、完全一致は空', () => {
		const base = summarizeExportCounts(makeExportData({ children: 2, pointLedger: 10 }));
		expect(diffCutoverCounts(base, { ...base })).toEqual([]);

		const drifted: CutoverCounts = { ...base, pointLedger: 9, stampCards: 1 };
		const diff = diffCutoverCounts(base, drifted);
		expect(diff).toHaveLength(2);
		expect(diff.join('\n')).toContain('pointLedger (point_ledger): export=10 imported=9');
		expect(diff.join('\n')).toContain('stampCards (stamp_cards): export=0 imported=1');
	});
});
