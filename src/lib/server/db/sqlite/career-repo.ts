// src/lib/server/db/career-repo.ts
// キャリアプランニング関連のリポジトリ層

import { and, desc, eq, lte } from 'drizzle-orm';
import { db } from '../client';
import { careerFields, careerPlanHistory, careerPlans, pointLedger } from '../schema';

// ============================================================
// 職業分野マスタ
// ============================================================

/** 全職業分野を取得 */
export async function findAllCareerFields(_tenantId: string) {
	return db.select().from(careerFields).orderBy(careerFields.id).all();
}

/** 年齢に適合する職業分野を取得 */
export async function findCareerFieldsByAge(age: number, _tenantId: string) {
	return db
		.select()
		.from(careerFields)
		.where(lte(careerFields.minAge, age))
		.orderBy(careerFields.id)
		.all();
}

/** 職業分野を1件取得 */
export async function findCareerFieldById(id: number, _tenantId: string) {
	return db.select().from(careerFields).where(eq(careerFields.id, id)).get();
}

// ============================================================
// キャリアプラン
// ============================================================

/** アクティブなプランを取得 */
export async function findActiveCareerPlan(childId: number, _tenantId: string) {
	return db
		.select()
		.from(careerPlans)
		.where(and(eq(careerPlans.childId, childId), eq(careerPlans.isActive, 1)))
		.get();
}

/** 子供の全プランを取得 */
export async function findCareerPlansByChildId(childId: number, _tenantId: string) {
	return db
		.select()
		.from(careerPlans)
		.where(eq(careerPlans.childId, childId))
		.orderBy(desc(careerPlans.createdAt))
		.all();
}

/** プラン作成 */
export async function insertCareerPlan(
	input: {
		childId: number;
		careerFieldId?: number;
		dreamText?: string;
		mandalaChart?: string;
		timeline3y?: string;
		timeline5y?: string;
		timeline10y?: string;
	},
	_tenantId: string,
) {
	return db
		.insert(careerPlans)
		.values({
			childId: input.childId,
			careerFieldId: input.careerFieldId ?? null,
			dreamText: input.dreamText ?? null,
			mandalaChart: input.mandalaChart ?? '{}',
			timeline3y: input.timeline3y ?? null,
			timeline5y: input.timeline5y ?? null,
			timeline10y: input.timeline10y ?? null,
		})
		.returning()
		.get();
}

/** プラン更新 */
export async function updateCareerPlan(
	planId: number,
	input: {
		careerFieldId?: number;
		dreamText?: string;
		mandalaChart?: string;
		timeline3y?: string;
		timeline5y?: string;
		timeline10y?: string;
		version?: number;
	},
	_tenantId: string,
) {
	return db
		.update(careerPlans)
		.set({
			...(input.careerFieldId !== undefined && { careerFieldId: input.careerFieldId }),
			...(input.dreamText !== undefined && { dreamText: input.dreamText }),
			...(input.mandalaChart !== undefined && { mandalaChart: input.mandalaChart }),
			...(input.timeline3y !== undefined && { timeline3y: input.timeline3y }),
			...(input.timeline5y !== undefined && { timeline5y: input.timeline5y }),
			...(input.timeline10y !== undefined && { timeline10y: input.timeline10y }),
			...(input.version !== undefined && { version: input.version }),
			updatedAt: new Date().toISOString(),
		})
		.where(eq(careerPlans.id, planId))
		.returning()
		.get();
}

/** 既存プランを全て非アクティブ化 */
export async function deactivateCareerPlans(childId: number, _tenantId: string) {
	await db
		.update(careerPlans)
		.set({ isActive: 0 })
		.where(and(eq(careerPlans.childId, childId), eq(careerPlans.isActive, 1)))
		.run();
}

// ============================================================
// プラン更新履歴
// ============================================================

/** 履歴を挿入 */
export async function insertCareerPlanHistory(
	input: {
		careerPlanId: number;
		action: string;
		pointsEarned: number;
		snapshot?: string;
	},
	_tenantId: string,
) {
	return db
		.insert(careerPlanHistory)
		.values({
			careerPlanId: input.careerPlanId,
			action: input.action,
			pointsEarned: input.pointsEarned,
			snapshot: input.snapshot ?? '{}',
		})
		.returning()
		.get();
}

/** 指定アクションの最新履歴を取得（月1回制限チェック用） */
export async function findLatestHistoryByAction(
	careerPlanId: number,
	action: string,
	_tenantId: string,
) {
	return db
		.select()
		.from(careerPlanHistory)
		.where(
			and(eq(careerPlanHistory.careerPlanId, careerPlanId), eq(careerPlanHistory.action, action)),
		)
		.orderBy(desc(careerPlanHistory.createdAt))
		.limit(1)
		.get();
}

// ============================================================
// ポイント付与
// ============================================================

/** キャリアプランのポイントを付与 */
export async function insertCareerPointEntry(
	input: {
		childId: number;
		amount: number;
		description: string;
		referenceId?: number;
	},
	_tenantId: string,
) {
	return db
		.insert(pointLedger)
		.values({
			childId: input.childId,
			amount: input.amount,
			type: 'career_plan',
			description: input.description,
			referenceId: input.referenceId,
		})
		.returning()
		.get();
}
