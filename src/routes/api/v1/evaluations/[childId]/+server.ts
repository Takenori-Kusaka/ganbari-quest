import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { notFound, validationError } from '$lib/server/errors';
import { getAllChildren } from '$lib/server/services/child-service';
import { getChildEvaluations } from '$lib/server/services/evaluation-service';

export const GET: RequestHandler = async ({ params, url }) => {
	const childId = Number(params.childId);
	if (Number.isNaN(childId)) return validationError('IDが不正です');

	const children = getAllChildren();
	const child = children.find((c) => c.id === childId);
	if (!child) return notFound('こどもがみつかりません');

	const limit = Number(url.searchParams.get('limit') ?? '10');
	const evaluations = getChildEvaluations(childId, limit);

	return json({ evaluations });
};
