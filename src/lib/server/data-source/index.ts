/**
 * データソースファクトリ
 *
 * `locals.isDemo` からデモモードを判定し、適切なデータソースを返す。
 */

import type { ChildDataSource } from './types.js';

/**
 * リクエストがデモモードかどうかを判定する。
 *
 * hooks.server.ts で locals.isDemo = true が設定されていることを前提とする。
 */
export function isDemoMode(locals: App.Locals): boolean {
	return (locals as unknown as Record<string, unknown>).isDemo === true;
}

/**
 * デモモードかどうかに応じてデータソースを生成する。
 *
 * DB ソースは各 +page.server.ts で直接サービス関数を呼ぶ既存パターンを維持するため、
 * 現時点ではデモソースのみファクトリで生成する。
 * 本番はアダプタ移行完了後に DbChildDataSource として実装する。
 */
export async function createChildDataSource(locals: App.Locals): Promise<ChildDataSource | null> {
	if (!isDemoMode(locals)) return null;

	const { DemoChildDataSource } = await import('./demo-source.js');
	return new DemoChildDataSource();
}

export type { ChildDataSource } from './types.js';
