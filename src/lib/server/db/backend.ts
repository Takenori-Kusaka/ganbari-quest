// src/lib/server/db/backend.ts
// EPIC #3424 / M4-B② 接続層 / 設計 SSOT: docs/design/dsql/m4-implementation-plan.md §3.3
//
// backend 切替の単一解決点。既存の `DATA_SOURCE` 切替機構 (factory.ts) に寄せ、DSQL を
// 追加した (新機軸を作らない)。repo インターフェイスは backend 別接続でも 1 本のため、
// 「どの backend か」の判定はここに集約し、factory / 接続層が参照する。
//
//   DATA_SOURCE=sqlite   → 'sqlite'   : local / test (better-sqlite3、単テナント物理分離)
//   DATA_SOURCE=dsql     → 'dsql'     : cognito / 本番 cloud (Aurora DSQL、tenant 述語で論理分離)
//   DATA_SOURCE=pglite   → 'pglite'   : NUC (PGlite、dsql repos を verbatim 再利用、ADR-0064 案 C)
//   DATA_SOURCE=demo     → 'demo'     : Multi-Lambda demo (stateless fixture、ADR-0048)
// #3438 Phase 2B: DynamoDB backend は cutover 完了により撤去済 (DB 一本化)。
// #4720: 'pglite' を default→'sqlite' に潰していたため、NUC では isDsqlBackend() が false になり
//   活動記録 / 取消の単一 txn core 経路・uuid guard・置換インポートの pg 戦略が全て無効だった
//   (本番 backend でだけ壊れる class、#4680)。backend 判定は **「pg 系 (dsql | pglite)」と
//   「sqlite」の 2 値** を `isPgBackend()` 1 関数に寄せ、dsql / pglite を個別に分岐しない。

import { getEnv } from '$lib/runtime/env';

/** 物理 backend の種別。repo 実装 (sqlite/ dsql/ demo/) の選択軸。pglite は dsql repos を共有する。 */
export type DbBackend = 'sqlite' | 'dsql' | 'pglite' | 'demo';

/**
 * `DATA_SOURCE` から物理 backend を解決する (純関数、副作用なし)。
 * 引数省略時は `process.env.DATA_SOURCE` を読み、既定は 'sqlite' (既存挙動と同一)。
 */
export function resolveDbBackend(dataSource?: string): DbBackend {
	// ADR-0040 P1: env は $lib/runtime/env 経由 (envSchema が default 'sqlite' を保証)。
	const source = dataSource ?? getEnv().DATA_SOURCE;
	switch (source) {
		case 'dsql':
			return 'dsql';
		case 'pglite':
			return 'pglite';
		case 'demo':
			return 'demo';
		default:
			return 'sqlite';
	}
}

/**
 * 現在の実行環境が pg 系 backend (Aurora DSQL / NUC PGlite) か。
 * record / cancel core の単一 txn 経路・uuid 形式 guard・置換インポートの pg 戦略など
 * 「pg-core repos (db/dsql/) を使う backend 共通」の分岐は **必ずこの関数** で判定する
 * (#4720。dsql だけを見ると NUC PGlite が sqlite 扱いになる)。
 */
export function isPgBackend(dataSource?: string): boolean {
	const b = resolveDbBackend(dataSource);
	return b === 'dsql' || b === 'pglite';
}

/**
 * 現在の実行環境が cloud DSQL (Aurora DSQL pool) か。**接続層 (db/dsql/connection.ts) を
 * 起動すべきか** の判定にのみ使う。アプリ層の挙動分岐には使わない (pglite を取り逃す) —
 * `isPgBackend()` を使うこと。
 */
export function isDsqlBackend(dataSource?: string): boolean {
	return resolveDbBackend(dataSource) === 'dsql';
}
