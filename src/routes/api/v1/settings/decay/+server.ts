import { error, json } from '@sveltejs/kit';
import { parentGateResponse } from '$lib/server/auth/owner-gate';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import type { RequestHandler } from './$types';

const VALID_INTENSITIES = ['none', 'gentle', 'normal', 'strict'] as const;

/** 減少強度設定を取得 */
export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
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
	// #4867 系 QM 監査 (S2) / PO 決裁 2026-09-09: **親だけが触ってよい経路**。
	//
	// `/api/v1/**` は `authorization.ts` の ROUTE_RULES が `['owner','parent','child']` に
	// 開けている (既存 test が固定している仕様)。つまり **child セッションはここに到達できる**
	// ので、「ここは親だけ」は各 route が言う以外にない。無いと子供が親の設定を書き換えられ、
	// **親が決め、子が記録する**という製品の中核が崩れる (ADR-0012 の前提)。
	//
	// **読み取り (GET) は閉じない** — 一覧を引けること自体は親限定と言い切れず、
	// PO 決裁が「判断が要るものは私へ」としているため。閉じるのは書き込みだけ。
	// role 判定はルート横断の唯一の seam (`requireRole`) 経由にする
	// (#3528 / 14-セキュリティ設計書 §5.2.3 §5.2.5。ハンドラ内の ad-hoc 判定は置かない)。
	const gate = parentGateResponse(locals);
	if (gate) return gate;
	const tenantId = context.tenantId;
	const body = await request.json();
	const intensity = body.intensity as string;

	if (!VALID_INTENSITIES.includes(intensity as (typeof VALID_INTENSITIES)[number])) {
		throw error(400, `Invalid intensity. Must be one of: ${VALID_INTENSITIES.join(', ')}`);
	}

	await setSetting('decay_intensity', intensity, tenantId);
	return json({ ok: true, intensity });
};
