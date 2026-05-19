// DynamoDB implementation of IViewerTokenRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// ビューワートークン機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import { logger } from '$lib/server/logger';
import type { InsertViewerTokenInput, ViewerToken } from '../types';

const SERVICE = 'viewer-token-repo.dynamodb';

function warnRead(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] read fallback: returning empty (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

function warnWrite(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] write fallback: no-op (Pre-PMF stub, #2263)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

export async function findByTenant(tenantId: string): Promise<ViewerToken[]> {
	warnRead('findByTenant', { tenantId });
	return [];
}

export async function findByToken(token: string): Promise<ViewerToken | undefined> {
	warnRead('findByToken', { tokenLength: token.length });
	return undefined;
}

export async function insert(
	input: InsertViewerTokenInput,
	tenantId: string,
): Promise<ViewerToken> {
	warnWrite('insert', { tenantId, label: input.label });
	return {
		id: 0,
		tenantId,
		token: input.token,
		label: input.label ?? null,
		expiresAt: input.expiresAt ?? null,
		createdAt: new Date().toISOString(),
		revokedAt: null,
	};
}

export async function revoke(id: number, tenantId: string): Promise<void> {
	warnWrite('revoke', { id, tenantId });
}

export async function deleteById(id: number, tenantId: string): Promise<void> {
	warnWrite('deleteById', { id, tenantId });
}
