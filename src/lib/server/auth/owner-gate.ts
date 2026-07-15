// src/lib/server/auth/owner-gate.ts
// owner-gate seam の共通 Response 変換 (#3561、#3558 follow-up)
//
// requireRole(locals, ['owner']) seam (#3528 fitness#3 / #3556) が throw する
// HttpError を、既存 client 互換の {error} JSON body へ変換する共通 helper。
// account / tenant / members 系の owner-gate endpoint はハンドラ内に
// try/catch を複製せず本 helper を経由する。
//
// - 403: endpoint 別文言 (OWNER_GATE_LABELS、#3561 ①) を呼び出し側が指定
// - 401: 上流の `!context` 早期 return が将来リファクタで消えても outer
//   try/catch での 500 化 (潜在退行) をさせず、上流と同一文言の
//   `{error}` 401 JSON に変換する (#3561 ③)
// - それ以外の HttpError / 例外は re-throw (呼び出し側の責務)

import { isHttpError, json } from '@sveltejs/kit';
import { OWNER_GATE_LABELS } from '$lib/domain/labels';
import { requireRole } from './guards';

/**
 * owner-gate 判定を requireRole seam 経由で行い、結果を Response に変換する。
 *
 * @returns owner なら null（続行可）。非 owner なら 403 Response、
 *          認証コンテキスト欠落なら 401 Response。
 */
export function ownerGateResponse(locals: App.Locals, forbiddenMessage: string): Response | null {
	try {
		requireRole(locals, ['owner']);
		return null;
	} catch (e) {
		if (isHttpError(e, 401)) {
			return json({ error: OWNER_GATE_LABELS.authRequired }, { status: 401 });
		}
		if (isHttpError(e, 403)) {
			return json({ error: forbiddenMessage }, { status: 403 });
		}
		throw e;
	}
}
