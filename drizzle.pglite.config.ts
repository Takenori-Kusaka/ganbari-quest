import { defineConfig } from 'drizzle-kit';

// #3620 AC-C1 (ADR-0064 案 C): NUC = PGlite 上で pg-core schema (dsql/schema.ts) を駆動する。
// 本番 PGlite は drizzle-kit (devDependency) を実行時に持たないため、schema は本 config で
// **dev 時に生成した migration SQL** (drizzle/pglite/) を boot 時 drizzle-orm/pglite migrator で
// 適用する。cloud DSQL は別 migration 経路 (M4-B① runner) を持つため out を分離する。
export default defineConfig({
	schema: './src/lib/server/db/dsql/schema.ts',
	out: './drizzle/pglite',
	dialect: 'postgresql',
});
