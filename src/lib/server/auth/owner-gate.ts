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
import { forbiddenForNonParent } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { requireRole } from './guards';

/**
 * role-mutation 拒否の監査ログ用コンテキスト (#3552 ②)。
 *
 * owner-gate が 403 で拒否した「テナント権限そのものを変える mutation」
 * (メンバー削除 / owner 移譲 / 招待発行・取消) の濫用試行を追跡するため、
 * `auditAction` を渡した呼び出しのみ 403 時に `logger.warn` を 1 行残す。
 * Pre-PMF (ADR-0010) の最小ログ: 汎用監査ログ基盤は導入せず、既存の
 * structured logger に actor / role / tenant / target を記録するに留める。
 */
export interface OwnerGateAudit {
	/** 拒否された操作の識別子 (例: 'members.transfer-ownership') */
	auditAction: string;
	/** 操作対象の userId / inviteCode 等 (任意) */
	targetId?: string;
}

/**
 * owner-gate 判定を requireRole seam 経由で行い、結果を Response に変換する。
 *
 * @param audit 指定時のみ、403 拒否を `logger.warn` で監査ログに残す (#3552 ②)。
 *   role-mutation endpoint (メンバー削除 / owner 移譲 / 招待) が渡す。account /
 *   tenant ライフサイクル系は従来通り未指定 (ログ対象外)。
 * @returns owner なら null（続行可）。非 owner なら 403 Response、
 *          認証コンテキスト欠落なら 401 Response。
 */
export function ownerGateResponse(
	locals: App.Locals,
	forbiddenMessage: string,
	audit?: OwnerGateAudit,
): Response | null {
	try {
		requireRole(locals, ['owner']);
		return null;
	} catch (e) {
		if (isHttpError(e, 401)) {
			return json({ error: OWNER_GATE_LABELS.authRequired }, { status: 401 });
		}
		if (isHttpError(e, 403)) {
			if (audit) {
				logger.warn('[owner-gate] role-mutation を owner 権限外で拒否', {
					context: {
						action: audit.auditAction,
						tenantId: locals.context?.tenantId,
						// #4643: targetId は users.user_id なので actor 側も同じ空間で残す。
						// IdP の sub を混ぜると同じログ行の 2 値が別空間になり突合できない。
						actorUserId: locals.context?.userId,
						actorRole: locals.context?.role,
						targetId: audit.targetId,
					},
				});
			}
			return json({ error: forbiddenMessage }, { status: 403 });
		}
		throw e;
	}
}

/**
 * 親 (owner / parent) 限定 gate を requireRole seam 経由で行い、結果を Response に変換する。
 *
 * `ownerGateResponse` の兄弟。違いは 2 つだけ:
 *   - 許可ロールが `['owner', 'parent']` (owner 専用ではない)
 *   - 403 body が ADR-0062 の集約先 `forbiddenForNonParent()` (`{ error: { code, message } }`)
 *
 * **なぜ seam を通すのか** (#3528 / 14-セキュリティ設計書 §5.2.3 / §5.2.5):
 * ハンドラ内に `context.role !== 'owner' && context.role !== 'parent'` を直接書くと、
 * role 判定がルート横断で散り、許可ロールの定義を 1 箇所で読めなくなる。#3528 は
 * account / tenant 系でそれを `requireRole` に寄せた。`/api/v1` の親限定書き込み (#4869) も
 * 同じ seam に乗せる。
 *
 * **なぜ owner 用と body を分けるのか**: owner-gate 側は既存 client が依存する
 * `{ error: <文言> }` 形をバイト一致で保存する契約 (§5.2.5)。`/api/v1` の親限定 route は
 * ADR-0062 の統一形 (`{ error: { code: 'FORBIDDEN' } }`) を返しており、こちらを崩せない。
 * 許可ロールの判定だけを共有し、表現は各々の契約に合わせる。
 *
 * @returns owner / parent なら null (続行可)。それ以外は 403 Response、
 *          認証コンテキスト欠落なら 401 Response。
 */
export function parentGateResponse(locals: App.Locals): Response | null {
	try {
		requireRole(locals, ['owner', 'parent']);
		return null;
	} catch (e) {
		if (isHttpError(e, 401)) {
			return json({ error: OWNER_GATE_LABELS.authRequired }, { status: 401 });
		}
		if (isHttpError(e, 403)) {
			return forbiddenForNonParent();
		}
		throw e;
	}
}
