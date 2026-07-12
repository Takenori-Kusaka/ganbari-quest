// src/lib/server/auth/local-tenant.ts
// EPIC #3620 AC-C4 — NUC (AUTH_MODE=local) 単一テナントの tenantId SSOT。
//
// 背景: 旧 sqlite/dynamodb backend の tenant_id は text 型で、local auth は固定文字列 'local' を
// 使ってきた。新 pg-core schema (PGlite/DSQL) の family_id は **uuid 型**のため、'local' のままだと
// 全クエリが uuid parse error になる (cross-backend round-trip test で実証)。
//
// 解決: backend に応じて tenantId を解決する。
//   - pglite / dsql (pg-core 新 schema) → LOCAL_TENANT_UUID (固定 UUID)
//   - sqlite / dynamodb (旧 schema)      → 'local' (既存データの帰属キーと後方互換)
// cutover (旧→新 backend のデータ移行) では、旧 backend から export したデータを
// LOCAL_TENANT_UUID を tenantId として import する (export データ自体は tenant 非依存、
// importFamilyData の引数で新テナントに帰属させる = §12.2 import-then-swap)。

/**
 * NUC 単一テナントの固定 UUID。
 * ⚠️ 一度 cutover したら不変 (この値が新 DB 全行の帰属キーになる)。変更はデータ孤立を招く。
 */
export const LOCAL_TENANT_UUID = '00000000-0000-4000-8000-00000000c0ca';

/**
 * local auth (NUC 単一テナント) の tenantId を DATA_SOURCE に応じて解決する。
 * pg-core 系 backend は uuid 型 family_id のため UUID を、旧 backend は既存データとの
 * 後方互換のため 'local' を返す。
 */
export function resolveLocalTenantId(dataSource: string | undefined): string {
	return dataSource === 'pglite' || dataSource === 'dsql' ? LOCAL_TENANT_UUID : 'local';
}
