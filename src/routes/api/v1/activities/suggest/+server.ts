import { error, json } from '@sveltejs/kit';
import { suggestActivity } from '$lib/server/services/activity-suggest-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const text = String(body.text ?? '').trim();

	if (!text) {
		throw error(400, { message: 'テキストを入力してください' });
	}

	if (text.length > 200) {
		throw error(400, { message: 'テキストは200文字以内にしてください' });
	}

	const suggestion = await suggestActivity(text);
	return json(suggestion);
};
