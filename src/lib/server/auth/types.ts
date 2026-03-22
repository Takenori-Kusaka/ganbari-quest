// src/lib/server/auth/types.ts
// 二層セッションモデルの型定義

import type { RequestEvent } from '@sveltejs/kit';

/** 認証モードの切り替え（DATA_SOURCE パターンと同様） */
export type AuthMode = 'local' | 'cognito';

/** テナント内ロール */
export type Role = 'owner' | 'parent' | 'child' | 'viewer';

/** Layer 1: Identity（誰であるか） */
export type Identity =
	| { type: 'pin'; sessionId: string }
	| { type: 'oauth'; userId: string; email: string }
	| { type: 'device'; deviceId: string; tenantId: string };

/** Layer 2: Context（何として操作しているか） */
export interface AuthContext {
	tenantId: string;
	role: Role;
	childId?: number;
	licenseStatus: 'active' | 'suspended' | 'expired' | 'none';
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
