import { error, json } from '@sveltejs/kit';
import { activateVoice, deleteVoice } from '$lib/server/services/voice-service';
import type { RequestHandler } from './$types';

/** PATCH /api/v1/children/:id/voices/:voiceId — アクティブ切替 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = Number(params.id);
	const voiceId = Number(params.voiceId);
	if (!childId || !voiceId) throw error(400, { message: '不正なIDです' });

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
	const voiceId = Number(params.voiceId);
	if (!voiceId) throw error(400, { message: '不正なIDです' });

	const ok = await deleteVoice(voiceId, tenantId);
	if (!ok) throw error(404, { message: 'ボイスが見つかりません' });

	return json({ success: true });
};
