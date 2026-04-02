import { deleteByEndpoint } from '$lib/server/db/push-subscription-repo';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context?.tenantId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = (await request.json()) as { endpoint: string };

		if (!body.endpoint) {
			return json({ error: 'Missing endpoint' }, { status: 400 });
		}

		await deleteByEndpoint(body.endpoint, context.tenantId);
		return json({ success: true });
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};
