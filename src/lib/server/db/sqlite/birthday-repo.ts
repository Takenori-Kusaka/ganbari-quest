// src/lib/server/db/birthday-repo.ts
// 誕生日レビュー関連のリポジトリ層

import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { birthdayReviews } from '../schema';

/** 指定年の誕生日レビューを取得 */
export async function findBirthdayReviewByYear(childId: number, year: number) {
	return db
		.select({ id: birthdayReviews.id })
		.from(birthdayReviews)
		.where(and(eq(birthdayReviews.childId, childId), eq(birthdayReviews.reviewYear, year)))
		.get();
}

/** 誕生日レビューを挿入 */
export async function insertBirthdayReview(input: {
	childId: number;
	reviewYear: number;
	ageAtReview: number;
	healthChecks: string;
	aspirationText: string | null;
	aspirationCategories: string;
	basePoints: number;
	healthPoints: number;
	aspirationPoints: number;
	totalPoints: number;
}) {
	return db.insert(birthdayReviews).values(input).returning().get();
}

/** 子供の全誕生日レビューを取得 */
export async function findBirthdayReviews(childId: number) {
	return db
		.select()
		.from(birthdayReviews)
		.where(eq(birthdayReviews.childId, childId))
		.orderBy(birthdayReviews.reviewYear)
		.all();
}
