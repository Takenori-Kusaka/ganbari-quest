// src/lib/server/db/birthday-repo.ts — Facade (delegates to factory)

import { getRepos } from './factory';
import type { InsertBirthdayReviewInput } from './types';

export async function findBirthdayReviewByYear(childId: number, year: number) {
	return getRepos().birthday.findBirthdayReviewByYear(childId, year);
}
export async function insertBirthdayReview(input: InsertBirthdayReviewInput) {
	return getRepos().birthday.insertBirthdayReview(input);
}
export async function findBirthdayReviews(childId: number) {
	return getRepos().birthday.findBirthdayReviews(childId);
}
