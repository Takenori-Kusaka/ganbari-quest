// src/lib/server/services/career-service.ts
// キャリアプランニング機能のサービス層

import { CAREER_POINTS } from '$lib/domain/validation/career';
import type { CreateCareerPlanInput, UpdateCareerPlanInput } from '$lib/domain/validation/career';
import {
	deactivateCareerPlans,
	findActiveCareerPlan,
	findAllCareerFields,
	findCareerFieldById,
	findCareerFieldsByAge,
	findLatestHistoryByAction,
	insertCareerPlan,
	insertCareerPlanHistory,
	insertCareerPointEntry,
	updateCareerPlan as updateCareerPlanRepo,
} from '$lib/server/db/career-repo';

// ============================================================
// 職業分野
// ============================================================

/** 職業分野一覧を取得（年齢フィルタあり） */
export async function getCareerFields(age?: number) {
	if (age !== undefined) {
		return await findCareerFieldsByAge(age);
	}
	return await findAllCareerFields();
}

/** 職業分野を1件取得 */
export async function getCareerField(id: number) {
	return await findCareerFieldById(id);
}

// ============================================================
// キャリアプラン
// ============================================================

/** アクティブなプランを取得（職業分野情報付き） */
export async function getActiveCareerPlan(childId: number) {
	const plan = await findActiveCareerPlan(childId);
	if (!plan) return null;

	const field = plan.careerFieldId ? await findCareerFieldById(plan.careerFieldId) : null;
	return { ...plan, careerField: field };
}

/** 新規プラン作成 + ポイント付与 */
export async function createCareerPlan(childId: number, input: CreateCareerPlanInput) {
	// 既存のアクティブプランを非アクティブ化
	await deactivateCareerPlans(childId);

	const plan = await insertCareerPlan({
		childId,
		careerFieldId: input.careerFieldId,
		dreamText: input.dreamText,
		mandalaChart: input.mandalaChart ? JSON.stringify(input.mandalaChart) : '{}',
		timeline3y: input.timeline3y,
		timeline5y: input.timeline5y,
		timeline10y: input.timeline10y,
	});

	let totalPoints = 0;

	// マンダラチャート作成ポイント
	if (input.mandalaChart?.center) {
		await insertCareerPointEntry({
			childId,
			amount: CAREER_POINTS.MANDALA_CREATE,
			description: 'マンダラチャートを作成',
			referenceId: plan.id,
		});
		await insertCareerPlanHistory({
			careerPlanId: plan.id,
			action: 'mandala_create',
			pointsEarned: CAREER_POINTS.MANDALA_CREATE,
			snapshot: JSON.stringify(input.mandalaChart),
		});
		totalPoints += CAREER_POINTS.MANDALA_CREATE;
	}

	// タイムライン設定ポイント
	if (input.timeline3y || input.timeline5y || input.timeline10y) {
		await insertCareerPointEntry({
			childId,
			amount: CAREER_POINTS.TIMELINE_CREATE,
			description: 'みらいのタイムラインを設定',
			referenceId: plan.id,
		});
		await insertCareerPlanHistory({
			careerPlanId: plan.id,
			action: 'timeline_create',
			pointsEarned: CAREER_POINTS.TIMELINE_CREATE,
		});
		totalPoints += CAREER_POINTS.TIMELINE_CREATE;
	}

	return { plan, pointsAwarded: totalPoints };
}

/** プラン更新 + 条件付きポイント付与（月1回制限） */
export async function updateCareerPlanWithPoints(
	planId: number,
	childId: number,
	input: UpdateCareerPlanInput,
) {
	const existing = await findActiveCareerPlan(childId);
	if (!existing || existing.id !== planId) {
		throw new Error('Active career plan not found');
	}

	const updateData: Parameters<typeof updateCareerPlanRepo>[1] = {
		version: existing.version + 1,
	};
	if (input.careerFieldId !== undefined) updateData.careerFieldId = input.careerFieldId;
	if (input.dreamText !== undefined) updateData.dreamText = input.dreamText;
	if (input.mandalaChart !== undefined)
		updateData.mandalaChart = JSON.stringify(input.mandalaChart);
	if (input.timeline3y !== undefined) updateData.timeline3y = input.timeline3y;
	if (input.timeline5y !== undefined) updateData.timeline5y = input.timeline5y;
	if (input.timeline10y !== undefined) updateData.timeline10y = input.timeline10y;

	const plan = await updateCareerPlanRepo(planId, updateData);

	let totalPoints = 0;

	// マンダラ更新ポイント（月1回制限）
	if (input.mandalaChart) {
		const pts = await awardMonthlyPoints(
			planId,
			childId,
			'mandala_update',
			CAREER_POINTS.MANDALA_UPDATE,
			'マンダラチャートを更新',
		);
		totalPoints += pts;
	}

	// タイムライン更新ポイント（月1回制限）
	if (
		input.timeline3y !== undefined ||
		input.timeline5y !== undefined ||
		input.timeline10y !== undefined
	) {
		const pts = await awardMonthlyPoints(
			planId,
			childId,
			'timeline_update',
			CAREER_POINTS.TIMELINE_UPDATE,
			'タイムラインを更新',
		);
		totalPoints += pts;
	}

	return { plan, pointsAwarded: totalPoints };
}

// ============================================================
// 内部ヘルパー
// ============================================================

/** 月1回制限付きポイント付与。付与した場合はポイント額を、制限内なら0を返す */
async function awardMonthlyPoints(
	planId: number,
	childId: number,
	action: string,
	points: number,
	description: string,
): Promise<number> {
	const latest = await findLatestHistoryByAction(planId, action);

	if (latest) {
		// 同月チェック (YYYY-MM 比較)
		const latestMonth = latest.createdAt.slice(0, 7);
		const currentMonth = new Date().toISOString().slice(0, 7);
		if (latestMonth === currentMonth) {
			// 今月すでに付与済み
			await insertCareerPlanHistory({
				careerPlanId: planId,
				action,
				pointsEarned: 0,
			});
			return 0;
		}
	}

	await insertCareerPointEntry({
		childId,
		amount: points,
		description,
		referenceId: planId,
	});
	await insertCareerPlanHistory({
		careerPlanId: planId,
		action,
		pointsEarned: points,
	});
	return points;
}
