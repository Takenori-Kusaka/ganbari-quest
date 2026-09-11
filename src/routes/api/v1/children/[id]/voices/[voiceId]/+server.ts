import { error, json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { requireChildAccess } from '$lib/server/auth/factory';
import { parentGateResponse } from '$lib/server/auth/owner-gate';
import { activateVoice, deleteVoice } from '$lib/server/services/voice-service';
import type { RequestHandler } from './$types';

/** PATCH /api/v1/children/:id/voices/:voiceId — アクティブ切替 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.id);
	const voiceId = params.voiceId;
	if (!childId || !voiceId) throw error(400, { message: '不正なIDです' });
	// PO 決裁 2026-09-10 決定 6: **親限定**。録音そのものが PII で、しかも登録済みの音声は
	// きょうだいの画面で再生される。だれの声を家庭内に流すかは保護者が決める。role 判定は単一 seam 経由 (#3528)。
	const roleGate = parentGateResponse(locals);
	if (roleGate) return roleGate;
	// 親が他テナントの子 id を渡す経路も塞ぐ (tenant 跨ぎの IDOR)。
	requireChildAccess(locals, childId);

	const body = await request.json();
	const scene = String(body.scene ?? 'complete');

	const ok = await activateVoice(voiceId, childId, scene, tenantId);
	if (!ok) throw error(404, { message: 'ボイスが見つかりません' });

	return json({ success: true });
};

/** DELETE /api/v1/children/:id/voices/:voiceId — ボイス削除 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	// 旧実装は `params.id` を読まず `deleteVoice(voiceId, tenantId)` を呼んでいた。
	// URL の childId が何であれ voiceId だけで消せるため (a) child ロールが兄弟のボイスを
	// 削除でき、(b) URL と実際に消える行が一致しないという二重の欠陥だった。
	// childId を必ず解決し、guard と service の両方で所有者を突合する
	// (PATCH 側は元から (voiceId, childId) 複合キーで検証していた = 非対称だった)。
	const childId = asChildId(params.id);
	const voiceId = params.voiceId;
	if (!childId || !voiceId) throw error(400, { message: '不正なIDです' });
	// PO 決裁 2026-09-10 決定 6: **親限定**。録音そのものが PII で、しかも登録済みの音声は
	// きょうだいの画面で再生される。だれの声を家庭内に流すかは保護者が決める。role 判定は単一 seam 経由 (#3528)。
	const roleGate = parentGateResponse(locals);
	if (roleGate) return roleGate;
	// 親が他テナントの子 id を渡す経路も塞ぐ (tenant 跨ぎの IDOR)。
	requireChildAccess(locals, childId);

	const ok = await deleteVoice(voiceId, childId, tenantId);
	if (!ok) throw error(404, { message: 'ボイスが見つかりません' });

	return json({ success: true });
};
