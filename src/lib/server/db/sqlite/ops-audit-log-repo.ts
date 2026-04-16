// src/lib/server/db/sqlite/ops-audit-log-repo.ts
// SQLite implementation of IOpsAuditLogRepo (#820)

import { desc, eq } from 'drizzle-orm';
import { db } from '../client';
import type {
	InsertOpsAuditLogInput,
	OpsAuditLogRow,
} from '../interfaces/ops-audit-log-repo.interface';
import { opsAuditLog } from '../schema';

function rowFromRecord(r: typeof opsAuditLog.$inferSelect): OpsAuditLogRow {
	return {
		id: r.id,
		actorId: r.actorId,
		actorEmail: r.actorEmail,
		ip: r.ip,
		ua: r.ua,
		action: r.action,
		target: r.target,
		metadata: r.metadata,
		createdAt: r.createdAt,
	};
}

export async function insert(input: InsertOpsAuditLogInput): Promise<void> {
	await db.insert(opsAuditLog).values({
		actorId: input.actorId,
		actorEmail: input.actorEmail,
		ip: input.ip ?? null,
		ua: input.ua ?? null,
		action: input.action,
		target: input.target ?? null,
		metadata:
			input.metadata === undefined || input.metadata === null
				? null
				: JSON.stringify(input.metadata),
	});
}

export async function findRecent(limit: number): Promise<OpsAuditLogRow[]> {
	const rows = await db.select().from(opsAuditLog).orderBy(desc(opsAuditLog.id)).limit(limit);
	return rows.map(rowFromRecord);
}

export async function findByActor(actorId: string, limit: number): Promise<OpsAuditLogRow[]> {
	const rows = await db
		.select()
		.from(opsAuditLog)
		.where(eq(opsAuditLog.actorId, actorId))
		.orderBy(desc(opsAuditLog.id))
		.limit(limit);
	return rows.map(rowFromRecord);
}
