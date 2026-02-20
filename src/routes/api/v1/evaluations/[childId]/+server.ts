import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { evaluations, children } from '$lib/server/db/schema';
import { notFound, validationError } from '$lib/server/errors';

export const GET: RequestHandler = async ({ params, url }) => {
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const child = db.select().from(children).where(eq(children.id, childId)).get();
	if (!child) return notFound('こどもがみつかりません');

	const limit = Number(url.searchParams.get('limit') ?? '10');

	const results = db
		.select()
		.from(evaluations)
		.where(eq(evaluations.childId, childId))
		.orderBy(desc(evaluations.createdAt))
		.limit(limit)
		.all();

	return json({
		evaluations: results.map((e) => ({
			...e,
			scores: JSON.parse(e.scoresJson),
		})),
	});
};
