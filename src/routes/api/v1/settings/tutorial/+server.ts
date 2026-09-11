import { error, json } from '@sveltejs/kit';
import { setSetting } from '$lib/server/db/settings-repo';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const body = await request.json();
	const action = body.action as string;

	const now = new Date().toISOString();

	// #4654 (EPIC #4650 判断 2): 親の章立てチュートリアル (v1) 撤去に伴い、開始マーク ('start') と
	// バナー dismiss ('dismiss') の書き手が無くなったため受理しない。完了マークのみ残す
	// (子供画面チュートリアルの完了で書かれる)。過去に書かれた設定値 (tutorial_started_at /
	// tutorial_banner_dismissed) は export/import 互換のため保持する (ADR-0066)。
	switch (action) {
		case 'complete':
			await setSetting('tutorial_completed_at', now, tenantId);
			break;
		default:
			throw error(400, 'Invalid action');
	}

	return json({ ok: true });
};
