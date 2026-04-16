// src/lib/server/auth/types.ts
// 二層セッションモデルの型定義

import type { RequestEvent } from '@sveltejs/kit';

/** 認証モードの切り替え（DATA_SOURCE パターンと同様） */
export type AuthMode = 'local' | 'cognito';

/** テナント内ロール（#0123: viewer 廃止） */
export type Role = 'owner' | 'parent' | 'child';

/** Layer 1: Identity（誰であるか）
 * - local: LAN内認証なし（NUC/Docker）
 * - cognito: Cognito Email/Password + MFA（AWS SaaS）
 *
 * #820: Cognito `cognito:groups` claim を surfaces する `groups` フィールドを追加。
 * /ops のような group ベース認可は `groups.includes('ops')` で判定する。
 * PR-A 時点ではフィールドを追加するのみで、既存の認可ロジックは未変更。
 */
export type Identity =
	| { type: 'local' }
	| { type: 'cognito'; userId: string; email: string; groups?: string[] };

/** Layer 2: Context（何として操作しているか） */
export interface AuthContext {
	tenantId: string;
	role: Role;
	childId?: number;
	licenseStatus: 'active' | 'suspended' | 'expired' | 'none';
	tenantStatus?: 'active' | 'suspended' | 'grace_period' | 'terminated';
	plan?: string;
}

/** authorize() の戻り値 */
export type AuthResult =
	| { allowed: true }
	| { allowed: false; redirect: string; status?: 401 | 403 };

/** AuthProvider インターフェース — AUTH_MODE ごとに実装を差し替える */
export interface AuthProvider {
	resolveIdentity(event: RequestEvent): Promise<Identity | null>;
	resolveContext(event: RequestEvent, identity: Identity | null): Promise<AuthContext | null>;
	authorize(path: string, identity: Identity | null, context: AuthContext | null): AuthResult;
}
