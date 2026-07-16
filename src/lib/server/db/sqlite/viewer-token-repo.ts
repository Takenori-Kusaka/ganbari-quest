import { and, desc, eq, isNotNull, lt, or } from 'drizzle-orm';
import { db } from '../client';
import { viewerTokens } from '../schema';
import type { InsertViewerTokenInput, ViewerToken } from '../types';

function toRecord(row: typeof viewerTokens.$inferSelect): ViewerToken {
	return { ...row, id: String(row.id) };
}

export async function findByTenant(tenantId: string): Promise<ViewerToken[]> {
	const rows = await db
		.select()
		.from(viewerTokens)
		.where(eq(viewerTokens.tenantId, tenantId))
		.orderBy(desc(viewerTokens.createdAt))
		.all();
	return rows.map(toRecord);
}

export async function findByToken(token: string): Promise<ViewerToken | undefined> {
	const row = db.select().from(viewerTokens).where(eq(viewerTokens.token, token)).get();
	return row ? toRecord(row) : undefined;
}

export async function insert(
	input: InsertViewerTokenInput,
	tenantId: string,
): Promise<ViewerToken> {
	const now = new Date().toISOString();
	// #3574 ①: expire-then-purge (DSQL backend と parity)。token は revoke 後の値再発行が前提だが
	// UNIQUE(token) のため、自 tenant の dead 旧行 (revoke 済 or 期限切れ) が同 token を占有したまま
	// 再発行すると UNIQUE 衝突で沈黙失敗する。挿入前に自 tenant の再利用可能な旧行を purge する
	// (live 行が占有していれば purge 対象外 → UNIQUE 衝突が surface = 2 live 行防止は維持)。
	db.delete(viewerTokens)
		.where(
			and(
				eq(viewerTokens.tenantId, tenantId),
				eq(viewerTokens.token, input.token),
				or(
					isNotNull(viewerTokens.revokedAt),
					and(isNotNull(viewerTokens.expiresAt), lt(viewerTokens.expiresAt, now)),
				),
			),
		)
		.run();
	const row = db
		.insert(viewerTokens)
		.values({
			tenantId,
			token: input.token,
			label: input.label ?? null,
			expiresAt: input.expiresAt ?? null,
			createdAt: now,
		})
		.returning()
		.get();
	return toRecord(row);
}

export async function revoke(id: string, tenantId: string): Promise<void> {
	db.update(viewerTokens)
		.set({ revokedAt: new Date().toISOString() })
		.where(and(eq(viewerTokens.id, Number(id)), eq(viewerTokens.tenantId, tenantId)))
		.run();
}

export async function deleteById(id: string, tenantId: string): Promise<void> {
	db.delete(viewerTokens)
		.where(and(eq(viewerTokens.id, Number(id)), eq(viewerTokens.tenantId, tenantId)))
		.run();
}
