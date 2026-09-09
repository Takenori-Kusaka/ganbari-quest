import { error, json } from '@sveltejs/kit';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { forbiddenForNonParent } from '$lib/server/errors';
import type { RequestHandler } from './$types';

const VALID_INTENSITIES = ['none', 'gentle', 'normal', 'strict'] as const;

/** 減少強度設定を取得 */
export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	// #4867 系 QM 監査 (S2) / PO 決裁 2026-09-09: **親だけが触ってよい経路**。
	// `/api/v1/**` は `authorization.ts` の ROUTE_RULES が child まで通すので、role 検査は
	// この route の責務。無いと子供が親の設定を書き換えられる (ポイント経済が壊れる = ADR-0012
	// の前提が崩れる)。判定は `forbiddenForNonParent` に集約し、fitness test が漏れを見る。
	if (context.role !== 'owner' && context.role !== 'parent') {
		return forbiddenForNonParent();
	}

	const tenantId = context.tenantId;
	const value = await getSetting('decay_intensity', tenantId);
	return json({ intensity: value ?? 'normal' });
};

/** 減少強度設定を更新 */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const body = await request.json();
	const intensity = body.intensity as string;

	if (!VALID_INTENSITIES.includes(intensity as (typeof VALID_INTENSITIES)[number])) {
		throw error(400, `Invalid intensity. Must be one of: ${VALID_INTENSITIES.join(', ')}`);
	}

	await setSetting('decay_intensity', intensity, tenantId);
	return json({ ok: true, intensity });
};
