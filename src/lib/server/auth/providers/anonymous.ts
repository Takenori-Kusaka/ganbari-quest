// src/lib/server/auth/providers/anonymous.ts
// AnonymousAuthProvider (ADR-0048 §決定 P-1.6)
//
// Multi-Lambda demo deployment (`demo.ganbari-quest.com`) で `AUTH_MODE=anonymous` 指定時に
// 選択される。dummy user (`anon-{requestId}`) + role='owner' + tenantId='demo' + licenseStatus=ACTIVE
// を返し、demo Lambda 配下の全画面 (admin / child / ops) を見せられる。
//
// 設計原則:
// - Lambda は production DB / Cognito / Secrets Manager への IAM 権限を持たない (ADR-0048 §決定 §1)
// - 認証 cookie / セッション state を一切持たない (Lambda stateless, ADR-0048 §決定 §2)
// - write API は Policy Gate で deny される想定 (本 PR scope 外、Multi-Lambda 全体方針)

import type { RequestEvent } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import type { AuthContext, AuthProvider, AuthResult, Identity } from '../types';

const DEMO_TENANT_ID = 'demo';
const DEMO_ROLE = 'owner' as const;
const ANON_EMAIL = 'anon@demo.local';

function deriveRequestId(event: RequestEvent): string {
	// SvelteKit `event.locals.requestId` が hooks.server で set されている前提
	// (multi-lambda demo Lambda の hooks も含めてセットする想定。
	//  fallback として URL hash / timestamp を使う)
	const fromLocals = (event.locals as { requestId?: string }).requestId;
	if (fromLocals) return fromLocals;
	// fallback: stateless かつ重複 OK (Lambda は user-specific state を持たない)
	return `${Date.now().toString(36)}`;
}

export class AnonymousAuthProvider implements AuthProvider {
	async resolveIdentity(event: RequestEvent): Promise<Identity> {
		const requestId = deriveRequestId(event);
		return {
			type: 'anonymous',
			userId: `anon-${requestId}`,
			email: ANON_EMAIL,
		};
	}

	async resolveContext(_event: RequestEvent, _identity: Identity | null): Promise<AuthContext> {
		// ADR-0048 P-1.6: tenantId='demo' / role='owner' / licenseStatus=ACTIVE (全画面表示用)
		return {
			tenantId: DEMO_TENANT_ID,
			role: DEMO_ROLE,
			licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
			tenantStatus: SUBSCRIPTION_STATUS.ACTIVE,
		};
	}

	authorize(_path: string, _identity: Identity | null, _context: AuthContext | null): AuthResult {
		// Demo Lambda は全パスを allow (admin / ops / child を見せる)。
		// write は Policy Gate / route 側で 200 no-op response を返す (ADR-0048 §決定 P-1.7)。
		return { allowed: true };
	}
}
