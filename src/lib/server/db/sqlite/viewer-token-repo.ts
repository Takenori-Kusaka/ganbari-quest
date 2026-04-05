import { and, desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { viewerTokens } from '../schema';
import type { InsertViewerTokenInput, ViewerToken } from '../types';

function toRecord(row: typeof viewerTokens.$inferSelect): ViewerToken {
	return row as unknown as ViewerToken;
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

export async function revoke(id: number, tenantId: string): Promise<void> {
	db.update(viewerTokens)
		.set({ revokedAt: new Date().toISOString() })
		.where(and(eq(viewerTokens.id, id), eq(viewerTokens.tenantId, tenantId)))
		.run();
}

export async function deleteById(id: number, tenantId: string): Promise<void> {
	db.delete(viewerTokens)
		.where(and(eq(viewerTokens.id, id), eq(viewerTokens.tenantId, tenantId)))
		.run();
}
