// DynamoDB implementation of ICloudExportRepo
//
// #2263 hotfix: 旧バージョンの未実装エラー throw で本番 500 を引き起こしうるため、
// Pre-PMF fallback (read = 空 / write = no-op + logger.warn) に置換。
// クラウドエクスポート機能は本番未活用 (ADR-0010 Pre-PMF Bucket B = まだ作らない)。

import { logger } from '$lib/server/logger';
import type { CloudExportRecord, InsertCloudExportInput } from '../types';

const SERVICE = 'cloud-export-repo.dynamodb';

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

export async function findByTenant(tenantId: string): Promise<CloudExportRecord[]> {
	warnRead('findByTenant', { tenantId });
	return [];
}

export async function findByPin(pinCode: string): Promise<CloudExportRecord | undefined> {
	warnRead('findByPin', { pinCode });
	return undefined;
}

export async function findById(
	id: number,
	tenantId: string,
): Promise<CloudExportRecord | undefined> {
	warnRead('findById', { id, tenantId });
	return undefined;
}

export async function insert(input: InsertCloudExportInput): Promise<CloudExportRecord> {
	warnWrite('insert', { tenantId: input.tenantId, exportType: input.exportType });
	return {
		id: 0,
		tenantId: input.tenantId,
		exportType: input.exportType,
		pinCode: input.pinCode,
		s3Key: input.s3Key,
		fileSizeBytes: input.fileSizeBytes,
		label: input.label ?? null,
		description: input.description ?? null,
		expiresAt: input.expiresAt,
		downloadCount: 0,
		maxDownloads: input.maxDownloads ?? 0,
		createdAt: new Date().toISOString(),
	};
}

export async function incrementDownloadCount(id: number): Promise<void> {
	warnWrite('incrementDownloadCount', { id });
}

export async function deleteById(id: number, tenantId: string): Promise<void> {
	warnWrite('deleteById', { id, tenantId });
}

export async function deleteExpired(now: string): Promise<number> {
	warnWrite('deleteExpired', { now });
	return 0;
}

export async function countByTenant(tenantId: string): Promise<number> {
	warnRead('countByTenant', { tenantId });
	return 0;
}
