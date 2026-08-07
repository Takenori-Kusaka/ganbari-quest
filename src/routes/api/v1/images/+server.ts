// GET /api/v1/images?type=favicon - Get favicon path
//
// #4397: 画像生成 (POST {type:'avatar'|'favicon'}) は撤去した。子供のニックネームと年齢を
// 運営者の環境の外にある生成 AI (Gemini) へ送る配線であり、privacy.html 第 3 条 / 第 10 条の
// 開示と食い違っていたため機能ごと廃止した。アバターの設定は
// POST /api/v1/children/[id]/avatar (写真アップロード) が担う。

import { json } from '@sveltejs/kit';
import { validationError } from '$lib/server/errors';
import { getFaviconPath } from '$lib/server/services/image-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const type = url.searchParams.get('type');

	if (type === 'favicon') {
		const path = await getFaviconPath(tenantId);
		return json({ faviconPath: path || null });
	}

	return validationError('type パラメータを指定してください（favicon）');
};
