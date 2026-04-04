// src/lib/server/db/index.ts
// DB モジュール公開インタフェース

export type { DrizzleDatabase as Database } from './client';
export { db } from './client';
export * from './schema';
