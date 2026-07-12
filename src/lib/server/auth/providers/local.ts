// src/lib/server/auth/providers/local.ts
// LocalAuthProvider — 認証なし（LAN内限定、#0123 要件: PIN廃止）

import type { RequestEvent } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { getEnv } from '$lib/runtime/env';
import { resolveLocalTenantId } from '../local-tenant';
import type { AuthContext, AuthProvider, AuthResult, Identity } from '../types';

export class LocalAuthProvider implements AuthProvider {
	async resolveIdentity(_event: RequestEvent): Promise<Identity> {
		// local モード: 常に認証済み（LAN内アクセス制限で十分）
		return { type: 'local' };
	}

	async resolveContext(_event: RequestEvent, _identity: Identity | null): Promise<AuthContext> {
		// 単一テナント固定、常に owner。tenantId は backend-aware (#3620 AC-C4):
		// pg-core 系 (pglite/dsql) は uuid 型 family_id のため固定 UUID、旧 backend は 'local'
		// (既存データの帰属キー) を維持する。SSOT: ../local-tenant.ts
		return {
			tenantId: resolveLocalTenantId(getEnv().DATA_SOURCE),
			role: 'owner',
			licenseStatus: AUTH_LICENSE_STATUS.NONE,
		};
	}

	authorize(_path: string, _identity: Identity | null, _context: AuthContext | null): AuthResult {
		// 全ルート許可（認証なし）
		return { allowed: true };
	}
}
