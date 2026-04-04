import { error, json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { listVoices, uploadVoice } from '$lib/server/services/voice-service';
import type { RequestHandler } from './$types';

/** GET /api/v1/children/:id/voices?scene=complete */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.id);
	if (!childId || Number.isNaN(childId)) throw error(400, { message: '不正なIDです' });

	const scene = url.searchParams.get('scene') ?? 'complete';
	const voices = await listVoices(childId, scene, tenantId);
	return json({ voices });
};

/** POST /api/v1/children/:id/voices */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const tenantId = requireTenantId(locals);
	const childId = Number(params.id);
	if (!childId || Number.isNaN(childId)) throw error(400, { message: '不正なIDです' });

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
