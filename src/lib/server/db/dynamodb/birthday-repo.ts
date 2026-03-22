// src/lib/server/db/dynamodb/birthday-repo.ts
// DynamoDB implementation of IBirthdayRepo

import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { BirthdayReview, InsertBirthdayReviewInput } from '../types';
import { TABLE_NAME, getDocClient } from './client';
import { nextId } from './counter';
import { ENTITY_NAMES, birthdayReviewKey, birthdayReviewPrefix, childPK } from './keys';

/** Strip PK/SK/GSI keys from a DynamoDB item */
function stripKeys<T extends Record<string, unknown>>(
	item: T,
): Omit<T, 'PK' | 'SK' | 'GSI2PK' | 'GSI2SK'> {
	const { PK, SK, GSI2PK, GSI2SK, ...rest } = item;
	return rest;
}

/** 指定年の誕生日レビューを取得 */
export async function findBirthdayReviewByYear(
	childId: number,
	year: number,
): Promise<{ id: number } | undefined> {
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: birthdayReviewKey(childId, year),
			ProjectionExpression: 'id',
		}),
	);

	if (!result.Item) return undefined;
	return { id: result.Item.id as number };
}

/** 誕生日レビューを挿入 */
export async function insertBirthdayReview(
	input: InsertBirthdayReviewInput,
): Promise<BirthdayReview> {
	const id = await nextId(ENTITY_NAMES.birthdayReview);
	const now = new Date().toISOString();

	const review: BirthdayReview = {
		id,
		childId: input.childId,
		reviewYear: input.reviewYear,
		ageAtReview: input.ageAtReview,
		healthChecks: input.healthChecks,
		aspirationText: input.aspirationText,
		aspirationCategories: input.aspirationCategories,
		basePoints: input.basePoints,
		healthPoints: input.healthPoints,
		aspirationPoints: input.aspirationPoints,
		totalPoints: input.totalPoints,
		createdAt: now,
	};

	const key = birthdayReviewKey(input.childId, input.reviewYear);

	await getDocClient().send(
		new PutCommand({
			TableName: TABLE_NAME,
			Item: {
				...key,
				...review,
			},
		}),
	);

	return review;
}

/** 子供の全誕生日レビューを取得（年昇順） */
export async function findBirthdayReviews(childId: number): Promise<BirthdayReview[]> {
	const pk = childPK(childId);
	const prefix = birthdayReviewPrefix();

	const result = await getDocClient().send(
		new QueryCommand({
			TableName: TABLE_NAME,
			KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
			ExpressionAttributeValues: {
				':pk': pk,
				':prefix': prefix,
			},
			ScanIndexForward: true, // ascending order (by year)
		}),
	);

	return (result.Items ?? []).map((item) => stripKeys(item) as unknown as BirthdayReview);
}
