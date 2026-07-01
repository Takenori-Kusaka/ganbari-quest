// Demo ICloudExportRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type {
	CloudExportRecord,
	CloudExportStatus,
	InsertCloudExportInput,
	UpdateCloudExportStatusInput,
} from '../types';

export async function findByTenant(_tenantId: string): Promise<CloudExportRecord[]> {
	return [];
}

export async function findByPin(_pinCode: string): Promise<CloudExportRecord | undefined> {
	return undefined;
}

export async function findById(
	_id: number,
	_tenantId: string,
): Promise<CloudExportRecord | undefined> {
	return undefined;
}

export async function insert(input: InsertCloudExportInput): Promise<CloudExportRecord> {
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
		maxDownloads: input.maxDownloads ?? 5,
		createdAt: new Date().toISOString(),
		status: input.status ?? 'pending',
		failureReason: null,
	};
}

export async function incrementDownloadCount(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function updateStatus(
	_id: number,
	_tenantId: string,
	_status: CloudExportStatus,
	_opts?: UpdateCloudExportStatusInput,
): Promise<void> {
	// Stub: no-op (demo Lambda は cloud export の状態を持たない)
}

export async function findPendingBuilds(_limit: number): Promise<CloudExportRecord[]> {
	return [];
}

export async function deleteById(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function deleteExpired(_now: string): Promise<number> {
	return 0;
}

export async function countByTenant(_tenantId: string): Promise<number> {
	return 0;
}
