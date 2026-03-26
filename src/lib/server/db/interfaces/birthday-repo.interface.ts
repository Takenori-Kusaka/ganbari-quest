import type { BirthdayReview, InsertBirthdayReviewInput } from '../types';

export interface IBirthdayRepo {
	findBirthdayReviewByYear(
		childId: number,
		year: number,
		tenantId: string,
	): Promise<{ id: number } | undefined>;
	insertBirthdayReview(input: InsertBirthdayReviewInput, tenantId: string): Promise<BirthdayReview>;
	findBirthdayReviews(childId: number, tenantId: string): Promise<BirthdayReview[]>;
}
