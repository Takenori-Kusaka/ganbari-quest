// POST /api/v1/settings/pin-gate-onboarding — #2353 設計欠陥 6
//
// PIN gate 初心者導線 dialog の「以降表示しない」checkbox から呼ばれる。
// settings.pin_gate_onboarding_seen='true' を tenant scope で persist する。
//
// 認証必須 (子供 user / 親 user どちらでも可、tenant scope で保存)。
// 値は冪等 (true 固定)、payload なし。

import { json } from '@sveltejs/kit';
import { setSetting } from '$lib/server/db/settings-repo';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	await setSetting('pin_gate_onboarding_seen', 'true', context.tenantId);
	return json({ ok: true });
};
