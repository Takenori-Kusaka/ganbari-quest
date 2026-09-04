import { error, json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { requireChildAccess } from '$lib/server/auth/factory';
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
	// child ロールは自分のボイスのみ操作できる。
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
	requireChildAccess(locals, childId);

	const ok = await deleteVoice(voiceId, childId, tenantId);
	if (!ok) throw error(404, { message: 'ボイスが見つかりません' });

	return json({ success: true });
};
