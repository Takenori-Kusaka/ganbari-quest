// tests/unit/server/db/demo/evaluation-repo.test.ts
// #2097 Phase B-5b: 週次評価 fixture が読み出せること、demo 環境で
// 週次レポート / グラフ表示が空にならないことを検証。

import { describe, expect, it } from 'vitest';
import * as evaluationRepo from '../../../../../src/lib/server/db/demo/evaluation-repo';
import { DEMO_CHILDREN, DEMO_EVALUATIONS } from '../../../../../src/lib/server/demo/demo-data';

describe('demo/evaluation-repo (Phase B-5b)', () => {
	it('DEMO_EVALUATIONS fixture は全 5 子供 × 4 週分 = 20 件以上', () => {
		expect(DEMO_EVALUATIONS.length).toBeGreaterThanOrEqual(20);
	});

	it('DEMO_EVALUATIONS は全アクティブ child を網羅', () => {
		const activeChildIds = DEMO_CHILDREN.filter((c) => c.isArchived === 0).map((c) => c.id);
		for (const childId of activeChildIds) {
			const childEvaluations = DEMO_EVALUATIONS.filter((e) => e.childId === childId);
			expect(childEvaluations.length).toBeGreaterThanOrEqual(4);
		}
	});

	it('findAllChildren は demo Children (アーカイブ除く) を返す', async () => {
		const children = await evaluationRepo.findAllChildren('demo');
		expect(children.length).toBeGreaterThan(0);
		expect(children.every((c) => c.isArchived === 0)).toBe(true);
	});

	it('findEvaluationsByChild は 904 (junior) で 4 週分を新しい順に返す', async () => {
		const result = await evaluationRepo.findEvaluationsByChild(904, 10, 'demo');
		expect(result.length).toBeGreaterThanOrEqual(4);
		expect(result.every((e) => e.childId === 904)).toBe(true);
		// weekStart DESC 順
		for (let i = 0; i < result.length - 1; i++) {
			const current = result[i];
			const next = result[i + 1];
			if (current && next) {
				expect(current.weekStart >= next.weekStart).toBe(true);
			}
		}
	});

	it('findEvaluationsByChild は limit で件数を絞る', async () => {
		const result = await evaluationRepo.findEvaluationsByChild(904, 2, 'demo');
		expect(result.length).toBe(2);
	});

	it('findEvaluationsByChild は未登録 child で空配列', async () => {
		expect(await evaluationRepo.findEvaluationsByChild(99999, 10, 'demo')).toEqual([]);
	});

	it('findWeekEvaluation は existing (childId, weekStart) で id を返す', async () => {
		const first = DEMO_EVALUATIONS[0];
		expect(first).toBeDefined();
		if (!first) return;
		const found = await evaluationRepo.findWeekEvaluation(first.childId, first.weekStart, 'demo');
		expect(found).toBeDefined();
		expect(found?.id).toBe(first.id);
	});

	it('findWeekEvaluation は未該当 weekStart で undefined', async () => {
		expect(await evaluationRepo.findWeekEvaluation(904, '2099-01-01', 'demo')).toBeUndefined();
	});

	it('insertEvaluation は input を Evaluation として返す (no-op、fixture immutable)', async () => {
		const before = DEMO_EVALUATIONS.length;
		const evaluation = await evaluationRepo.insertEvaluation(
			{
				childId: 904,
				weekStart: '2026-04-01',
				weekEnd: '2026-04-07',
				scoresJson: '{}',
				bonusPoints: 10,
			},
			'demo',
		);
		expect(evaluation.childId).toBe(904);
		expect(evaluation.bonusPoints).toBe(10);
		expect(DEMO_EVALUATIONS.length).toBe(before);
	});

	it('countActivitiesByCategory / findLastActivityDateByCategory は空 (別 fixture 対象)', async () => {
		expect(
			await evaluationRepo.countActivitiesByCategory(904, '2026-03-23', '2026-03-29', 'demo'),
		).toEqual([]);
		expect(await evaluationRepo.findLastActivityDateByCategory(904, 'demo')).toEqual([]);
	});

	it('isRestDay は false / countRestDaysInMonth は 0', async () => {
		expect(await evaluationRepo.isRestDay(904, '2026-04-01', 'demo')).toBe(false);
		expect(await evaluationRepo.countRestDaysInMonth(904, '2026-04', 'demo')).toBe(0);
	});

	it('insertRestDay は input を RestDay として返す (no-op)', async () => {
		const restDay = await evaluationRepo.insertRestDay(904, '2026-04-01', 'お休み', 'demo');
		expect(restDay).toBeDefined();
		expect(restDay?.childId).toBe(904);
		expect(restDay?.date).toBe('2026-04-01');
	});
});
