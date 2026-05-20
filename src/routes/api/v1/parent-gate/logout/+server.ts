// POST /api/v1/parent-gate/logout — EPIC #2310 子#2313
//
// PIN session cookie 削除 (client から「親モードを抜ける」操作時に呼ぶ想定)
// /switch select action 内 (子#2314) は server context 内で cookies.delete を直接呼ぶ

import { json } from '@sveltejs/kit';
import { PARENT_SESSION_COOKIE_NAME } from '$lib/server/services/parent-gate-session';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete(PARENT_SESSION_COOKIE_NAME, { path: '/' });
	return json({ ok: true });
};
