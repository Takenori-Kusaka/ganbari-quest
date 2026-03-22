import type { BirthdayReview, InsertBirthdayReviewInput } from '../types';

export interface IBirthdayRepo {
	findBirthdayReviewByYear(childId: number, year: number): Promise<{ id: number } | undefined>;
	insertBirthdayReview(input: InsertBirthdayReviewInput): Promise<BirthdayReview>;
	findBirthdayReviews(childId: number): Promise<BirthdayReview[]>;
}
