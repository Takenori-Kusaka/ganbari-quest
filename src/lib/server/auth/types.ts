import type { ChildId } from '$lib/domain/ids';
// src/lib/server/auth/types.ts
// 二層セッションモデルの型定義

import type { RequestEvent } from '@sveltejs/kit';
import type { AuthLicenseStatus } from '$lib/domain/constants/auth-license-status';
import type { SubscriptionStatus } from '$lib/domain/constants/subscription-status';

/** 認証モードの切り替え（DATA_SOURCE パターンと同様） */
export type AuthMode = 'local' | 'cognito' | 'anonymous';

/** テナント内ロール（#0123: viewer 廃止）。
 * runtime 配列は DSQL memberships.role の CHECK 生成 SSOT (#3528、手書き二重化禁止)。 */
export const ROLES = ['owner', 'parent', 'child'] as const;
export type Role = (typeof ROLES)[number];

/** Layer 1: Identity（誰であるか）
 * - local: LAN内認証なし（NUC/Docker）
 * - cognito: Cognito Email/Password + MFA（AWS SaaS）
 * - anonymous: ADR-0048 Multi-Lambda demo deployment。dummy user `anon-{requestId}` を返し、
 *   production DB / Cognito へのアクセス権を持たない demo Lambda 環境で動作する。
 *
 * #820: Cognito `cognito:groups` claim を surfaces する `groups` フィールドを追加。
 * /ops のような group ベース認可は `groups.includes('ops')` で判定する。
 * PR-A 時点ではフィールドを追加するのみで、既存の認可ロジックは未変更。
 */
export type Identity =
	| { type: 'local' }
	| {
			type: 'cognito';
			userId: string;
			email: string;
			/** #3555 ③: Cognito `email_verified` claim。email 束縛招待の受諾判定 (fail-closed) に使う */
			emailVerified?: boolean;
			groups?: string[];
			/** #3025: federated IdP (Google 等) 経由 = Cognito パスワードを持たない */
			isFederated?: boolean;
			/** #3025: 実認証時刻 (epoch 秒)。requires-recent-login 判定用 (refresh では更新されない) */
			authTime?: number;
			/**
			 * #4266: ログイン時に MFA チャレンジを完了したか (ID token の `amr` claim 由来)。
			 * `undefined` = 判定不能。**未設定 / 不明はいずれも「MFA なし」として扱う**
			 * (`hasOpsAccess()` が fail-closed で拒否する)。
			 */
			mfaAuthenticated?: boolean;
	  }
	| { type: 'anonymous'; userId: string; email: string };

/** Layer 2: Context（何として操作しているか）
 *
 * plan は Stripe price ID 相当（例: 'standard_monthly', 'family_monthly'）
 * または DB Tenant.plan（'monthly' | 'family-monthly' 等）のいずれか。
 * 呼び出し側は `startsWith('family')` 等でゆるく判定しているため、ここでは
 * string のまま保持する（#972 も含め今後整理予定）。
 */
export interface AuthContext {
	tenantId: string;
	role: Role;
	childId?: ChildId;
	licenseStatus: AuthLicenseStatus;
	tenantStatus?: SubscriptionStatus;
	plan?: string;
	/**
	 * #4585-2: `families.stripe_subscription_id`。**`tenantStatus` と対で読む**。
	 * `suspended` は「契約が残る停止 (S4)」と「解約確定 (S5)」を兼ねており、契約の有無 (本値)
	 * が無いと区別できない (docs/design/billing-redesign/contract-state-matrix.md §4)。
	 * サーバー側 `locals.context` にのみ載り、クライアントには配布しない。
	 */
	stripeSubscriptionId?: string | null;
	/**
	 * #4266: **このセッションが MFA を経て開始されたか**。ログイン時に ID token の `amr` から
	 * 確定し、context token (署名付き) で保持する。
	 *
	 * silent refresh (`REFRESH_TOKEN_AUTH`) で再発行される ID token が `amr` を保持するかは
	 * AWS 公式ドキュメントで確定できないため、identity 側の判定だけに依存すると運営者が
	 * 無操作で `/ops` から締め出されうる。判定は `hasOpsAccess(identity, context)` に集約。
	 */
	mfaAuthenticated?: boolean;
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

/**
 * context_token に焼き込まず、毎リクエスト DB から解決する部分 (#3963)。
 *
 * 型をここ (leaf) に置くのは、`request-context.ts` が値の型を必要とする一方で
 * `tenant-entitlement.ts` は `request-context.ts` の cache を使うため、
 * 実装 module 側に型を置くと循環になるため。
 */
export interface TenantEntitlement {
	licenseStatus: AuthContext['licenseStatus'];
	tenantStatus: NonNullable<AuthContext['tenantStatus']>;
	plan?: string;
	stripeSubscriptionId?: AuthContext['stripeSubscriptionId'];
}
