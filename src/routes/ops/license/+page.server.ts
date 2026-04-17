// src/routes/ops/license/+page.server.ts
// #805: /ops/license — ライセンスキー検索
//
// 詳細画面 (/ops/license/[key]) への動線を提供する。
// 個別キーは検索で辿らせる。

import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {};
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
