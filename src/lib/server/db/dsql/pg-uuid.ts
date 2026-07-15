// src/lib/server/db/dsql/pg-uuid.ts
// #3709: pg backend (DSQL / PGlite) の uuid 列に対する id 形式 guard。
//
// children.child_id 等の PK は uuid 型 (§11.1)。cutover (旧 SQLite 数値 id → uuid) を跨いで
// 残存した stale な id 値 (Cookie `selectedChildId` の '3' 等) をそのまま WHERE に渡すと
// Postgres が 22P02 (invalid input syntax for type uuid) を throw し、route 層の
// 「undefined = not found → Cookie clear + redirect」グレースフル処理 (src/routes/(child)/
// +layout.server.ts) が機能せず 500 になる (2026-07-13 本番 NUC cutover 直後に PO が実機遭遇)。
//
// uuid 形式でない id は「どの行にも一致し得ない」= not-found と同義のため、query 前に
// 本 guard で弾いて undefined を返す。demo / dynamodb backend の数値 id ('901' 等) は
// pg backend を通らないため影響しない (guard は dsql/ 層に閉じる)。

const UUID_FORMAT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** value が Postgres uuid 型に安全に渡せる形式か (22P02 を起こさないか)。 */
export function isUuidFormat(value: string): boolean {
	return UUID_FORMAT.test(value);
}
