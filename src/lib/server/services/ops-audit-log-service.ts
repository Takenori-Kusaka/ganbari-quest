// src/lib/server/services/ops-audit-log-service.ts
// #820: /ops 運営操作の監査ログサービス

import type { RequestEvent } from '@sveltejs/kit';
import type { Identity } from '$lib/server/auth/types';
import { getRepos } from '$lib/server/db/factory';
import type { OpsAuditLogRow } from '$lib/server/db/interfaces/ops-audit-log-repo.interface';
import { logger } from '$lib/server/logger';

export interface RecordOpsAuditInput {
	identity: Identity;
	event: RequestEvent;
	action: string;
	target?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface OpsAuditLogEntry {
	id: number;
	actorId: string;
	actorEmail: string;
	ip: string | null;
	ua: string | null;
	action: string;
	target: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: string;
}

function extractActor(identity: Identity): { actorId: string; actorEmail: string } {
	if (identity.type === 'cognito') {
		return { actorId: identity.userId, actorEmail: identity.email };
	}
	return { actorId: 'local', actorEmail: 'local@localhost' };
}

function extractIpUa(event: RequestEvent): { ip: string | null; ua: string | null } {
	const ua = event.request.headers.get('user-agent');
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
	}
	return { ip, ua };
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function toEntry(row: OpsAuditLogRow): OpsAuditLogEntry {
	return {
		id: row.id,
		actorId: row.actorId,
		actorEmail: row.actorEmail,
		ip: row.ip,
		ua: row.ua,
		action: row.action,
		target: row.target,
		metadata: parseMetadata(row.metadata),
		createdAt: row.createdAt,
	};
}

export async function recordOpsAudit(input: RecordOpsAuditInput): Promise<void> {
	const { actorId, actorEmail } = extractActor(input.identity);
	const { ip, ua } = extractIpUa(input.event);

	try {
		await getRepos().opsAuditLog.insert({
			actorId,
			actorEmail,
			ip,
			ua,
			action: input.action,
			target: input.target ?? null,
			metadata: input.metadata ?? null,
		});
	} catch (e) {
		logger.error('[OPS_AUDIT] Failed to record audit log', {
			context: {
				action: input.action,
				actorId,
				error: e instanceof Error ? e.message : String(e),
			},
		});
	}
}

export async function listRecentAudits(limit = 100): Promise<OpsAuditLogEntry[]> {
	const rows = await getRepos().opsAuditLog.findRecent(limit);
	return rows.map(toEntry);
}

export async function listAuditsByActor(actorId: string, limit = 100): Promise<OpsAuditLogEntry[]> {
	const rows = await getRepos().opsAuditLog.findByActor(actorId, limit);
	return rows.map(toEntry);
}
