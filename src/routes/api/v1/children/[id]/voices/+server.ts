import { error, json } from '@sveltejs/kit';
import { asChildId } from '$lib/domain/ids';
import { requireChildAccess } from '$lib/server/auth/factory';
import { parentGateResponse } from '$lib/server/auth/owner-gate';
import { listVoices, uploadVoice } from '$lib/server/services/voice-service';
import type { RequestHandler } from './$types';

/** GET /api/v1/children/:id/voices?scene=complete */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.id);
	if (!childId) throw error(400, { message: '不正なIDです' });
	// child ロールは自分のボイスのみ一覧できる。
	requireChildAccess(locals, childId);

	const scene = url.searchParams.get('scene') ?? 'complete';
	const voices = await listVoices(childId, scene, tenantId);
	return json({ voices });
};

/** POST /api/v1/children/:id/voices */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const childId = asChildId(params.id);
	if (!childId) throw error(400, { message: '不正なIDです' });
	// PO 決裁 2026-09-10 決定 6: **親限定**。録音そのものが PII で、しかも登録した音声は
	// きょうだいの画面で再生される (家庭内の他の子に届く)。だれの声を家庭内に流すかは
	// 保護者が決める。role 判定は単一 seam 経由 (#3528)。
	const roleGate = parentGateResponse(locals);
	if (roleGate) return roleGate;
	// 親が他テナントの子 id を渡す経路も塞ぐ (tenant 跨ぎの IDOR)。
	requireChildAccess(locals, childId);

	const formData = await request.formData();
	const file = formData.get('file');
	const label = String(formData.get('label') ?? '').trim();
	const scene = String(formData.get('scene') ?? 'complete');
	const durationMs = formData.get('durationMs') ? Number(formData.get('durationMs')) : undefined;

	if (!label) throw error(400, { message: 'ラベルを入力してください' });
	if (label.length > 30) throw error(400, { message: 'ラベルは30文字以内です' });
	if (!(file instanceof File)) throw error(400, { message: '音声ファイルを選択してください' });

	const result = await uploadVoice(childId, tenantId, file, label, scene, durationMs);
	if ('error' in result) {
		const messages: Record<string, string> = {
			INVALID_FILE: 'ファイルが不正です',
			FILE_TOO_LARGE: 'ファイルサイズは5MB以下にしてください',
			UNSUPPORTED_TYPE: 'MP3, M4A, WAV, WebM, OGG形式のみ対応しています',
			TOO_MANY_VOICES: '登録できるボイスは10件までです',
			NOT_FOUND: '子供が見つかりません',
		};
		throw error(400, { message: messages[result.error] ?? 'エラーが発生しました' });
	}

	return json(result, { status: 201 });
};
