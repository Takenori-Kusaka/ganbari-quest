// Demo IEvaluationRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
// #2097 Phase B-5b: 週次評価 fixture を返すことで「週次レポート / グラフ用集計が空」のバグを解消。

import { DEMO_CHILDREN, DEMO_EVALUATIONS } from '$lib/server/demo/demo-data';
import type {
	CategoryActivityCount,
	CategoryLastDate,
	Child,
	Evaluation,
	InsertEvaluationInput,
	RestDay,
} from '../types';

export async function countActivitiesByCategory(
	_childId: number,
	_weekStart: string,
	_weekEnd: string,
	_tenantId: string,
): Promise<CategoryActivityCount[]> {
	return [];
}

export async function insertEvaluation(
	input: InsertEvaluationInput,
	_tenantId: string,
): Promise<Evaluation> {
	return {
		id: 0,
		childId: input.childId,
		weekStart: input.weekStart,
		weekEnd: input.weekEnd,
		scoresJson: input.scoresJson,
		bonusPoints: input.bonusPoints,
		createdAt: new Date().toISOString(),
	};
}

export async function findAllChildren(_tenantId: string): Promise<Child[]> {
	return DEMO_CHILDREN.filter((c) => c.isArchived === 0);
}

export async function findEvaluationsByChild(
	childId: number,
	limit: number,
	_tenantId: string,
): Promise<Evaluation[]> {
	// 新しい順 (weekStart DESC) で返す
	return DEMO_EVALUATIONS.filter((e) => e.childId === childId)
		.slice()
		.sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0))
		.slice(0, limit);
}

export async function hasDecayRunToday(
	_childId: number,
	_today: string,
	_tenantId: string,
): Promise<boolean> {
	return false;
}

export async function findWeekEvaluation(
	childId: number,
	weekStart: string,
	_tenantId: string,
): Promise<{ id: number } | undefined> {
	const found = DEMO_EVALUATIONS.find((e) => e.childId === childId && e.weekStart === weekStart);
	return found ? { id: found.id } : undefined;
}

export async function findLastActivityDateByCategory(
	_childId: number,
	_tenantId: string,
): Promise<CategoryLastDate[]> {
	return [];
}

export async function insertRestDay(
	childId: number,
	date: string,
	reason: string,
	_tenantId: string,
): Promise<RestDay | undefined> {
	return {
		id: 0,
		childId,
		date,
		reason,
		createdAt: new Date().toISOString(),
	};
}

export async function deleteRestDay(
	_childId: number,
	_date: string,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function isRestDay(
	_childId: number,
	_date: string,
	_tenantId: string,
): Promise<boolean> {
	return false;
}

export async function countRestDaysInMonth(
	_childId: number,
	_yearMonth: string,
	_tenantId: string,
): Promise<number> {
	return 0;
}

export async function findRestDays(
	_childId: number,
	_yearMonth: string,
	_tenantId: string,
): Promise<RestDay[]> {
	return [];
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
