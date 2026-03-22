// src/lib/server/db/index.ts
// DB モジュール公開インタフェース

export { db } from './client';
export type { DrizzleDatabase as Database } from './client';
export * from './schema';
