// src/lib/server/db/dsql/viewer-token-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// IViewerTokenRepo (viewer_tokens) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **§P9 tenant 述語**: findByToken (閲覧リンクの無 tenant 単点 lookup、token global UNIQUE が
//     機能要件 — schema §11.2 で明示された例外) を除く全メソッドが family_id = tenantId を含む。
//   - **UUID surrogate PK**: token_id は gen_random_uuid() 採番。entity.id = token_id 文字列。
//   - **失効判定は app 層述語**: revoked_at / expires_at は素の列 (部分 unique index 不可
//     spike#2 §3.5.3)。revoke は revoked_at = now() の soft revoke (sqlite と同挙動)。
//   - **findByTenant は created_at 降順** (sqlite と同順) + token_id DESC tie-break で決定的。

import { sql } from 'drizzle-orm';
import type { IViewerTokenRepo } from '../interfaces/viewer-token-repo.interface';
import type { ViewerToken } from '../types';
import type { SqlExecutor } from './sql-executor';

interface ViewerTokenRow {
	token_id: string;
	family_id: string;
	token: string;
	label: string | null;
	expires_at: string | null;
	created_at: string;
	revoked_at: string | null;
}

const VIEWER_TOKEN_COLUMNS = sql.raw(
	`token_id, family_id, token, label, expires_at, created_at, revoked_at`,
);

/** row → ViewerToken entity (family_id → tenantId マップ)。 */
function toViewerToken(row: ViewerTokenRow): ViewerToken {
	return {
		id: row.token_id,
		tenantId: row.family_id,
		token: row.token,
		label: row.label,
		expiresAt: row.expires_at,
		createdAt: row.created_at,
		revokedAt: row.revoked_at,
	};
}

/** DSQL 用 IViewerTokenRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlViewerTokenRepo(db: SqlExecutor): IViewerTokenRepo {
	return {
		async findByTenant(tenantId) {
			const result = await db.execute(sql`
				SELECT ${VIEWER_TOKEN_COLUMNS} FROM viewer_tokens
				WHERE family_id = ${tenantId}
				ORDER BY created_at DESC, token_id DESC
			`);
			return (result.rows as unknown as ViewerTokenRow[]).map(toViewerToken);
		},

		async findByToken(token) {
			// token global UNIQUE の無 tenant 単点 lookup (閲覧リンク解決、§11.2 機能要件)。
			const result = await db.execute(sql`
				SELECT ${VIEWER_TOKEN_COLUMNS} FROM viewer_tokens WHERE token = ${token}
			`);
			const row = result.rows[0] as unknown as ViewerTokenRow | undefined;
			return row ? toViewerToken(row) : undefined;
		},

		async insert(input, tenantId) {
			// #3574 ①: expire-then-purge。token は revoke 後の値再発行が前提 (§11.2) だが global
			// UNIQUE のため、自 family の dead 旧行 (revoke 済 or 期限切れ) が同 token を占有したまま
			// 再発行すると UNIQUE 衝突で沈黙失敗する。挿入前に自 family の再利用可能な旧行を purge する。
			// live 行が占有していれば purge 対象外 → UNIQUE 衝突が surface する (= 2 live 行防止は維持、§P9)。
			await db.execute(sql`
				DELETE FROM viewer_tokens
				WHERE family_id = ${tenantId} AND token = ${input.token}
					AND (revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at < now()))
			`);
			const result = await db.execute(sql`
				INSERT INTO viewer_tokens (family_id, token, label, expires_at)
				VALUES (${tenantId}, ${input.token}, ${input.label ?? null},
					${input.expiresAt ?? null}::timestamptz)
				RETURNING ${VIEWER_TOKEN_COLUMNS}
			`);
			const row = result.rows[0] as unknown as ViewerTokenRow | undefined;
			if (!row) throw new Error('insert: insert returned no row');
			return toViewerToken(row);
		},

		async revoke(id, tenantId) {
			await db.execute(sql`
				UPDATE viewer_tokens SET revoked_at = now()
				WHERE family_id = ${tenantId} AND token_id = ${id}
			`);
		},

		async deleteById(id, tenantId) {
			await db.execute(sql`
				DELETE FROM viewer_tokens WHERE family_id = ${tenantId} AND token_id = ${id}
			`);
		},
	};
}
