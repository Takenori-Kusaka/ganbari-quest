// POST /api/v1/settings/pin-gate-onboarding — #2353 設計欠陥 6
//
// PIN gate 初心者導線 dialog の「以降表示しない」checkbox から呼ばれる。
// settings.pin_gate_onboarding_seen='true' を tenant scope で persist する。
//
// **親限定** (PO 決裁 2026-09-10 決定 6)。この dialog は文言も宛先も保護者向けで
// (「初めて見守り画面に入るときに、親がおやカギを作成します」)、既読フラグは
// tenant 全体に効く。子供が既読にできると、**保護者が案内を一度も見ないまま消える**。
// 値は冪等 (true 固定)、payload なし。
//
// dialog 自体も `(child)/+layout.svelte` が保護者のセッションにだけ出す。
// 子供に見せて「閉じられない dialog」を作らないための対 (どちらか一方だけ直すと壊れる)。

import { json } from '@sveltejs/kit';
import { parentGateResponse } from '$lib/server/auth/owner-gate';
import { setSetting } from '$lib/server/db/settings-repo';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const roleGate = parentGateResponse(locals);
	if (roleGate) return roleGate;

	await setSetting('pin_gate_onboarding_seen', 'true', context.tenantId);
	return json({ ok: true });
};
