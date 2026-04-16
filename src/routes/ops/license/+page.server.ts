// src/routes/ops/license/+page.server.ts
// #805: /ops/license — ライセンスキー検索 & 最近のイベント一覧
//
// 詳細画面 (/ops/license/[key]) への動線を提供する。
// キー全体の一覧取得 API は auth-repo には無いので、license_events の最近レコードから
// 「どのキーで活動があったか」を表示するディスカバリ UI とし、個別キーは検索で辿らせる。

import { redirect } from '@sveltejs/kit';
import { listRecentEvents } from '$lib/server/services/license-event-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);
	const events = await listRecentEvents(limit);
	return { events, limit };
};

export const actions: Actions = {
	search: async ({ request }) => {
		const form = await request.formData();
		const raw = (form.get('licenseKey') ?? '').toString().trim().toUpperCase();
		if (!raw) {
			return { error: 'ライセンスキーを入力してください' };
		}
		redirect(303, `/ops/license/${encodeURIComponent(raw)}`);
	},
};
