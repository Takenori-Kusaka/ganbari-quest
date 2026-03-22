// src/lib/server/db/dynamodb/auth-keys.ts
// Auth エンティティ用キー定義（テナントプレフィックス付き）
// 既存の keys.ts とは独立。Auth エンティティは初めからマルチテナント対応。

import type { DynamoKey } from './keys';

const AUTH_PREFIX = {
	USER: 'USER',
	TENANT: 'TENANT',
	DEVICE: 'DEVICE',
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

/** Tenant-device: PK=TENANT#<tenantId>, SK=DEVICE#<deviceId> */
export function tenantDeviceKey(tenantId: string, deviceId: string): DynamoKey {
	return { PK: `${AUTH_PREFIX.TENANT}#${tenantId}`, SK: `${AUTH_PREFIX.DEVICE}#${deviceId}` };
}

// ============================================================
// Device keys
// ============================================================

/** Device token: PK=DEVICE#<deviceId>, SK=META */
export function deviceKey(deviceId: string): DynamoKey {
	return { PK: `${AUTH_PREFIX.DEVICE}#${deviceId}`, SK: 'META' };
}

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

/** Tenant device SK prefix: DEVICE# */
export const DEVICE_SK_PREFIX = 'DEVICE#';

/** User tenant SK prefix: TENANT# */
export const USER_TENANT_SK_PREFIX = 'TENANT#';
