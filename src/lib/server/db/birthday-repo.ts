// src/lib/server/db/birthday-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertBirthdayReviewInput } from './types';

export async function findBirthdayReviewByYear(childId: number, year: number, tenantId: string) {
	return getRepos().birthday.findBirthdayReviewByYear(childId, year, tenantId);
}
export async function insertBirthdayReview(input: InsertBirthdayReviewInput, tenantId: string) {
	return getRepos().birthday.insertBirthdayReview(input, tenantId);
}
export async function findBirthdayReviews(childId: number, tenantId: string) {
	return getRepos().birthday.findBirthdayReviews(childId, tenantId);
}
