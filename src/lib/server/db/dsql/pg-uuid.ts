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

import { logger } from '$lib/server/logger';
import { checkRateLimit } from '$lib/server/security/rate-limiter';

const UUID_FORMAT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** value が Postgres uuid 型に安全に渡せる形式か (22P02 を起こさないか)。 */
export function isUuidFormat(value: string): boolean {
	return UUID_FORMAT.test(value);
}

// #3581 ②: guard 発火の rate-limit 窓 (source 単位で 1 分に 1 回だけ warn する)。
const GUARD_WARN_WINDOW_MS = 60_000;

/**
 * #3581 ②: isUuidFormat guard が trip した (非 uuid の id が uuid 列 WHERE に渡ろうとした) ことを
 * rate-limited に warn 記録する。
 *
 * guard は「非 uuid = not-found」に静かに正規化するため (500 を防ぐ本来の目的)、放置すると
 * stale cookie / 旧 integer id の systematic な取り違えが observability ゼロで進行する (本来は
 * 早期に潰すべき id バグ)。逆に無条件で warn すると悪性 cookie の連打でログが溢れるため、既存
 * `checkRateLimit` util で source 単位・`GUARD_WARN_WINDOW_MS` 窓に 1 回だけ記録する。実 alert
 * ではなく breadcrumb 目的なので level=warn。
 *
 * @param source guard trip 箇所の識別子 (例 `'child-repo.updateChild'` / `'route.checklist.toggle'`)。
 */
export function warnInvalidUuidId(source: string): void {
	const { allowed } = checkRateLimit(`uuid-guard:${source}`, 1, GUARD_WARN_WINDOW_MS);
	if (!allowed) return;
	logger.warn('non-uuid id rejected by uuid guard (stale cookie / legacy id?)', {
		service: 'pg-uuid-guard',
		method: source,
	});
}
