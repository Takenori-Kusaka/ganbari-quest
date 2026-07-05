// src/lib/server/db/backend.ts
// EPIC #3424 / M4-B② 接続層 / 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.3
//
// backend 切替の単一解決点。既存の `DATA_SOURCE` 切替機構 (factory.ts) に寄せ、DSQL を
// 追加した (新機軸を作らない)。repo インターフェイスは backend 別接続でも 1 本のため、
// 「どの backend か」の判定はここに集約し、factory / 接続層が参照する。
//
//   DATA_SOURCE=sqlite   → 'sqlite'   : NUC / local / test (better-sqlite3、単テナント物理分離)
//   DATA_SOURCE=dsql     → 'dsql'     : cognito / 本番 (Aurora DSQL、tenant 述語で論理分離)
//   DATA_SOURCE=dynamodb → 'dynamodb' : 撤去予定 (M5 で DB 一本化、m4-plan §3.9)
//   DATA_SOURCE=demo     → 'demo'     : Multi-Lambda demo (stateless fixture、ADR-0048)

/** 物理 backend の種別。repo 実装 (sqlite/ dsql/ dynamodb/ demo/) の選択軸。 */
export type DbBackend = 'sqlite' | 'dsql' | 'dynamodb' | 'demo';

/**
 * `DATA_SOURCE` から物理 backend を解決する (純関数、副作用なし)。
 * 引数省略時は `process.env.DATA_SOURCE` を読み、既定は 'sqlite' (既存挙動と同一)。
 */
export function resolveDbBackend(dataSource?: string): DbBackend {
	const source = dataSource ?? process.env.DATA_SOURCE ?? 'sqlite';
	switch (source) {
		case 'dsql':
			return 'dsql';
		case 'dynamodb':
			return 'dynamodb';
		case 'demo':
			return 'demo';
		default:
			return 'sqlite';
	}
}

/** 現在の実行環境が DSQL backend か。接続層 (db/dsql/connection.ts) を起動すべきか の判定に使う。 */
export function isDsqlBackend(dataSource?: string): boolean {
	return resolveDbBackend(dataSource) === 'dsql';
}
