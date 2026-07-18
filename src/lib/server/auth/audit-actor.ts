// src/lib/server/auth/audit-actor.ts
//
// #3474 item 3: 管理操作の監査 log に載せる actor 識別子を全 AUTH_MODE で解決する。
//
// 背景: admin 操作の audit log は `locals.identity?.type === 'cognito' ? userId : undefined` で
// actor を解決していたため、NUC (self-hosted、`type: 'local'`) では常に undefined になり
// 「誰が操作したか」の traceability が欠落していた。NUC は単一家庭・単一操作者だが、
// undefined よりも安定した principal 文字列を残す方が incident 追跡に有用。
//
// COPPA / ADR-0010: 監査 log には内部識別子のみを載せ、子供の氏名等 PII は載せない
// (呼び出し側で childId 等の内部数値 id のみ context に入れる)。本 helper 自身は
// 認証 principal の内部識別子 (Cognito userId / 固定ラベル) だけを返す。

import type { Identity } from './types';

/** NUC (local) の単一操作者を表す固定 principal。 */
export const NUC_LOCAL_ACTOR = 'nuc-local';
/** demo (anonymous) Lambda の操作者 (admin 操作は本来到達しないが fail-safe で識別)。 */
export const ANONYMOUS_ACTOR = 'anonymous';

/**
 * audit log 用の actor 識別子を解決する。
 * - cognito: 実 userId (sub)
 * - local (NUC): `nuc-local` 固定 (単一家庭・単一操作者)
 * - anonymous (demo): `anonymous` 固定
 * - null: `unknown`
 */
export function resolveAuditActor(identity: Identity | null | undefined): string {
	if (!identity) return 'unknown';
	switch (identity.type) {
		case 'cognito':
			return identity.userId;
		case 'local':
			return NUC_LOCAL_ACTOR;
		case 'anonymous':
			return ANONYMOUS_ACTOR;
		default: {
			// 網羅性チェック (新 identity type 追加時に型エラーで気付く)
			const _exhaustive: never = identity;
			void _exhaustive;
			return 'unknown';
		}
	}
}
