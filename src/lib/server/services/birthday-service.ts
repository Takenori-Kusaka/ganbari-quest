// src/lib/server/services/birthday-service.ts
// 誕生日イベント・振り返り機能

import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { children, birthdayReviews, pointLedger } from '$lib/server/db/schema';
import { todayDateJST } from '$lib/domain/date-utils';

/** Health check items */
export const HEALTH_CHECK_ITEMS = [
	{ key: 'no_injury', label: 'おおきなけがをしなかった', icon: '🩹' },
	{ key: 'no_cold', label: 'かぜをあまりひかなかった', icon: '🤧' },
	{ key: 'played_outside', label: 'たくさんそとであそんだ', icon: '🌞' },
	{ key: 'ate_well', label: 'すききらいなくたべられた', icon: '🍽️' },
	{ key: 'slept_well', label: 'はやねはやおきができた', icon: '😴' },
] as const;

/** Points config */
const POINTS_PER_HEALTH_CHECK = 50;
const HEALTH_ALL_CLEAR_BONUS = 100;
const ASPIRATION_TEXT_POINTS = 200;
const ASPIRATION_SELECT_POINTS = 100;

/** Grace period (days after birthday to still show the event) */
const GRACE_DAYS = 3;

export interface BirthdayStatus {
	isBirthday: boolean;
	alreadyReviewed: boolean;
	daysUntilBirthday: number | null;
	childAge: number;
}

export interface ReviewInput {
	healthChecks: Record<string, boolean>;
	aspirationText?: string;
	aspirationCategories?: Record<string, string>;
}

export interface ReviewResult {
	id: number;
	basePoints: number;
	healthPoints: number;
	aspirationPoints: number;
	totalPoints: number;
}

/**
 * Check if today is within the birthday event window for a child.
 */
export function checkBirthdayStatus(childId: number): BirthdayStatus | { error: 'NOT_FOUND' } {
	const child = db.select().from(children).where(eq(children.id, childId)).get();
	if (!child) return { error: 'NOT_FOUND' };

	if (!child.birthDate) {
		return { isBirthday: false, alreadyReviewed: false, daysUntilBirthday: null, childAge: child.age };
	}

	const today = todayDateJST();
	const todayDate = new Date(today + 'T00:00:00Z');
	const thisYear = todayDate.getUTCFullYear();

	// This year's birthday
	const birthMonth = child.birthDate.slice(5, 7);
	const birthDay = child.birthDate.slice(8, 10);
	const birthdayThisYear = new Date(`${thisYear}-${birthMonth}-${birthDay}T00:00:00Z`);

	const diffMs = todayDate.getTime() - birthdayThisYear.getTime();
	const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

	// Within window: birthday day through GRACE_DAYS after
	const isBirthday = diffDays >= 0 && diffDays <= GRACE_DAYS;

	// Check if already reviewed this year
	const existing = db
		.select({ id: birthdayReviews.id })
		.from(birthdayReviews)
		.where(and(eq(birthdayReviews.childId, childId), eq(birthdayReviews.reviewYear, thisYear)))
		.get();

	// Days until next birthday
	let daysUntilBirthday: number | null = null;
	if (diffDays < 0) {
		daysUntilBirthday = -diffDays;
	} else {
		// Already past this year, calculate next year
		const nextBirthday = new Date(`${thisYear + 1}-${birthMonth}-${birthDay}T00:00:00Z`);
		daysUntilBirthday = Math.round((nextBirthday.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
	}

	return {
		isBirthday,
		alreadyReviewed: !!existing,
		daysUntilBirthday,
		childAge: child.age,
	};
}

/**
 * Submit birthday review and grant points.
 */
export function submitBirthdayReview(
	childId: number,
	input: ReviewInput,
): ReviewResult | { error: 'NOT_FOUND' } | { error: 'ALREADY_REVIEWED' } | { error: 'NOT_BIRTHDAY' } {
	const child = db.select().from(children).where(eq(children.id, childId)).get();
	if (!child) return { error: 'NOT_FOUND' };

	const today = todayDateJST();
	const thisYear = new Date(today + 'T00:00:00Z').getUTCFullYear();

	// Check for existing review
	const existing = db
		.select({ id: birthdayReviews.id })
		.from(birthdayReviews)
		.where(and(eq(birthdayReviews.childId, childId), eq(birthdayReviews.reviewYear, thisYear)))
		.get();
	if (existing) return { error: 'ALREADY_REVIEWED' };

	// Calculate points
	const basePoints = child.age * 100;

	// Health check points
	const checkedCount = Object.values(input.healthChecks).filter(Boolean).length;
	const healthPoints =
		checkedCount * POINTS_PER_HEALTH_CHECK +
		(checkedCount === HEALTH_CHECK_ITEMS.length ? HEALTH_ALL_CLEAR_BONUS : 0);

	// Aspiration points
	let aspirationPoints = 0;
	if (input.aspirationText && input.aspirationText.trim().length > 0) {
		aspirationPoints = ASPIRATION_TEXT_POINTS;
	} else if (input.aspirationCategories && Object.keys(input.aspirationCategories).length > 0) {
		aspirationPoints = ASPIRATION_SELECT_POINTS;
	}

	const totalPoints = basePoints + healthPoints + aspirationPoints;

	// Insert review
	const review = db
		.insert(birthdayReviews)
		.values({
			childId,
			reviewYear: thisYear,
			ageAtReview: child.age,
			healthChecks: JSON.stringify(input.healthChecks),
			aspirationText: input.aspirationText ?? null,
			aspirationCategories: JSON.stringify(input.aspirationCategories ?? {}),
			basePoints,
			healthPoints,
			aspirationPoints,
			totalPoints,
		})
		.returning()
		.get();

	// Grant points via ledger
	db.insert(pointLedger)
		.values({
			childId,
			amount: totalPoints,
			type: 'birthday_bonus',
			description: `${child.age}さいのおたんじょうび！ +${totalPoints}P`,
			referenceId: review.id,
		})
		.run();

	return {
		id: review.id,
		basePoints,
		healthPoints,
		aspirationPoints,
		totalPoints,
	};
}

/**
 * Get past birthday reviews for a child.
 */
export function getBirthdayReviews(childId: number) {
	return db
		.select()
		.from(birthdayReviews)
		.where(eq(birthdayReviews.childId, childId))
		.orderBy(birthdayReviews.reviewYear)
		.all();
}
