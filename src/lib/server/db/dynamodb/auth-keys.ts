// src/lib/server/db/dynamodb/auth-keys.ts
// Auth エンティティ用キー定義（テナントプレフィックス付き）
// 既存の keys.ts とは独立。Auth エンティティは初めからマルチテナント対応。
// #0123: DeviceToken 廃止（共用アカウントに置き換え）

import type { DynamoKey } from './keys';

const AUTH_PREFIX = {
	USER: 'USER',
	TENANT: 'TENANT',
} as const;

// ============================================================
// User keys
// ============================================================

/** User profile: PK=USER#<userId>, SK=PROFILE */
export function userKey(userId: string): DynamoKey {
	return { PK: `${AUTH_PREFIX.USER}#${userId}`, SK: 'PROFILE' };
}

/** User-email lookup (GSI1 で逆引き): PK=USER#<userId>, SK=EMAIL#<email> */
export function userEmailKey(userId: string, email: string): DynamoKey {
	return { PK: `${AUTH_PREFIX.USER}#${userId}`, SK: `EMAIL#${email}` };
}

/** User-tenant membership (user 側): PK=USER#<userId>, SK=TENANT#<tenantId> */
export function userTenantKey(userId: string, tenantId: string): DynamoKey {
	return { PK: `${AUTH_PREFIX.USER}#${userId}`, SK: `${AUTH_PREFIX.TENANT}#${tenantId}` };
}

// ============================================================
// Tenant keys
// ============================================================

/** Tenant metadata: PK=TENANT#<tenantId>, SK=META */
export function tenantKey(tenantId: string): DynamoKey {
	return { PK: `${AUTH_PREFIX.TENANT}#${tenantId}`, SK: 'META' };
}

/** Tenant-member (tenant 側): PK=TENANT#<tenantId>, SK=MEMBER#<userId> */
export function tenantMemberKey(tenantId: string, userId: string): DynamoKey {
	return { PK: `${AUTH_PREFIX.TENANT}#${tenantId}`, SK: `MEMBER#${userId}` };
}

// ============================================================
// Invite keys
// ============================================================
//
// Epic #2525 Phase 7 PR-L5 (#2860): license key 全廃 contract に伴い旧 `licenseKey()` /
// `tenantLicenseKey()` (LICENSE# partition / TENANT#<id> SK=LICENSE) を撤去。
// entitlement は Stripe Subscription (tenant.status) が唯一 SSOT。
// 本番 DynamoDB に残存する LICENSE# item は dead data (コード参照ゼロで到達不能、放置)。

/** Invite: PK=INVITE#<inviteCode>, SK=META */
export function inviteKey(inviteCode: string): DynamoKey {
	return { PK: `INVITE#${inviteCode}`, SK: 'META' };
}

/** Tenant-invite (tenant 側): PK=TENANT#<tenantId>, SK=INVITE#<inviteCode> */
export function tenantInviteKey(tenantId: string, inviteCode: string): DynamoKey {
	return { PK: `${AUTH_PREFIX.TENANT}#${tenantId}`, SK: `INVITE#${inviteCode}` };
}

// ============================================================
// Consent keys (#0192)
// ============================================================

/** Consent record: PK=TENANT#<tenantId>, SK=CONSENT#<type>#<version> */
export function tenantConsentKey(tenantId: string, type: string, version: string): DynamoKey {
	return { PK: `${AUTH_PREFIX.TENANT}#${tenantId}`, SK: `CONSENT#${type}#${version}` };
}

/** Consent SK prefix for querying all consent records */
export const CONSENT_SK_PREFIX = 'CONSENT#';

// ============================================================
// Prefix helpers (for queries)
// ============================================================

/** User partition prefix: PK=USER#<userId> */
export function userPartition(userId: string): string {
	return `${AUTH_PREFIX.USER}#${userId}`;
}

/** Tenant partition prefix: PK=TENANT#<tenantId> */
export function tenantPartition(tenantId: string): string {
	return `${AUTH_PREFIX.TENANT}#${tenantId}`;
}

/** Tenant member SK prefix: MEMBER# */
export const MEMBER_SK_PREFIX = 'MEMBER#';

/** User tenant SK prefix: TENANT# */
export const USER_TENANT_SK_PREFIX = 'TENANT#';

/** Tenant invite SK prefix: INVITE# */
export const INVITE_SK_PREFIX = 'INVITE#';
