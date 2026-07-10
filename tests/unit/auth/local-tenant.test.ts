// tests/unit/auth/local-tenant.test.ts
// EPIC #3620 AC-C4 — NUC local auth tenantId の backend-aware 解決 (local-tenant.ts SSOT)。
//
// 背景: pg-core 新 schema (PGlite/DSQL) の family_id は uuid 型で、旧固定文字列 'local' は
// 全クエリ uuid parse error になる (cross-backend round-trip test で実証)。backend に応じた
// 解決契約を固定し、cutover 前後の帰属キー不整合を防ぐ。

import { describe, expect, it } from 'vitest';
import { LOCAL_TENANT_UUID, resolveLocalTenantId } from '../../../src/lib/server/auth/local-tenant';

describe('local-tenant (#3620 AC-C4、backend-aware tenantId)', () => {
	it('[LT1] pg-core 系 (pglite/dsql) は固定 UUID を返す', () => {
		expect(resolveLocalTenantId('pglite')).toBe(LOCAL_TENANT_UUID);
		expect(resolveLocalTenantId('dsql')).toBe(LOCAL_TENANT_UUID);
	});

	it('[LT2] 旧 backend (sqlite/dynamodb/未指定) は後方互換の "local" を返す', () => {
		expect(resolveLocalTenantId('sqlite')).toBe('local');
		expect(resolveLocalTenantId('dynamodb')).toBe('local');
		expect(resolveLocalTenantId(undefined)).toBe('local');
	});

	it('[LT3] LOCAL_TENANT_UUID は uuid 形式 (pg uuid 列に挿入可能)', () => {
		expect(LOCAL_TENANT_UUID).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});
});
