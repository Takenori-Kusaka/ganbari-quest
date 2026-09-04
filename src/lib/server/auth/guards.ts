import type { ChildId } from '$lib/domain/ids';
// src/lib/server/auth/guards.ts
// 認証ガード関数（純粋関数 — DB 依存なし）

import { error } from '@sveltejs/kit';
import type { Role } from './types';

/** 認証済みルートから tenantId を安全に取得。未認証ならエラー。 */
export function requireTenantId(locals: App.Locals): string {
	if (!locals.context) {
		throw new Error('Unauthorized: missing auth context');
	}
	return locals.context.tenantId;
}

/**
 * 認証済みルートから **アプリ DB の `users.user_id`** を取得する (#4643)。
 *
 * `locals.identity.userId` は IdP (Cognito) の sub であり `users.user_id` ではない。
 * memberships / invites / children / consents はすべて後者を参照するため、sub を渡すと
 * 一致するレコードが無く「削除したのに消えない」「本人判定が効かない」が静かに起きる。
 * 取り違えを型と実行時の両方で塞ぐため、DB を触る route は必ず本関数から取る。
 *
 * cognito 系 provider のみ `context.userId` を発行する。local / anonymous は users 行を
 * 持たないため 401 にする (fail-closed。sub へのフォールバックは作らない)。
 */
export function requireAppUserId(locals: App.Locals): string {
	const userId = locals.context?.userId;
	if (!userId) {
		throw error(401, 'Unauthorized');
	}
	return userId;
}

/**
 * child ロールの場合、指定された childId が自分のものであるかチェック。
 * owner/parent は常に許可。child は context.childId と一致しなければ 403。
 *
 * `/api/v1/**` は `ROUTE_RULES` で child ロールに開いている (子供が自分のデータを読み書きする
 * 正当な経路のため閉じられない)。そのため **path / body / query の childId を差し替えるだけで
 * 兄弟の行に届く**。この家庭内 IDOR (CWE-639) を止める唯一の seam が本関数であり、
 * per-child データを扱う route は例外なくこれを通す
 * (適用範囲は `tests/unit/architecture/per-child-route-authz-fitness.test.ts` が機械強制する)。
 *
 * child ロールで `context.childId` が未解決 (子供レコードに紐づいていない) 場合は **403 で閉じる**。
 * その状態の child が正当に読める per-child データは無く、開けると「未紐づけなら誰にでもなれる」
 * 抜け道になるため。
 */
export function requireChildAccess(locals: App.Locals, requestedChildId: ChildId): void {
	if (!locals.context) {
		throw error(401, 'Unauthorized');
	}
	if (locals.context.role === 'child' && locals.context.childId !== requestedChildId) {
		throw error(403, 'Access denied');
	}
}

/**
 * 「この要求が読み書きしてよい child」の範囲を返す。
 *
 * - owner / parent → `null` (家族内の全 child が対象。呼び出し側は絞り込まない)
 * - child → 自分の `childId` (未紐づけなら 403)
 *
 * `requireChildAccess` は「要求された childId」があって初めて使える。ところが
 * `DELETE /api/v1/activity-logs/[id]` のように **path が行 id しか持たない mutation** では、
 * その行が誰のものかを route 側では知り得ない。そこで本関数で「絞り込むべき child」を取り出し、
 * service 層へ渡して所有者を突合させる (id-only mutation 禁止、#2845 と同じ扱い)。
 */
export function requireChildScope(locals: App.Locals): ChildId | null {
	if (!locals.context) {
		throw error(401, 'Unauthorized');
	}
	if (locals.context.role !== 'child') {
		return null;
	}
	const childId = locals.context.childId;
	if (!childId) {
		throw error(403, 'Access denied');
	}
	return childId;
}

/** ロールが指定のいずれかであることを検証。不一致なら 403。 */
export function requireRole(locals: App.Locals, allowedRoles: Role[]): void {
	if (!locals.context) {
		throw error(401, 'Unauthorized');
	}
	if (!allowedRoles.includes(locals.context.role)) {
		throw error(403, 'Forbidden');
	}
}
