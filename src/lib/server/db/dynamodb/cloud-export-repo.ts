import type { CloudExportRecord, InsertCloudExportInput } from '../types';

const NOT_IMPL = 'DynamoDB cloud-export-repo not implemented';

export async function findByTenant(_tenantId: string): Promise<CloudExportRecord[]> {
	throw new Error(NOT_IMPL);
}

export async function findByPin(_pinCode: string): Promise<CloudExportRecord | undefined> {
	throw new Error(NOT_IMPL);
}

export async function findById(
	_id: number,
	_tenantId: string,
): Promise<CloudExportRecord | undefined> {
	throw new Error(NOT_IMPL);
}

export async function insert(_input: InsertCloudExportInput): Promise<CloudExportRecord> {
	throw new Error(NOT_IMPL);
}

export async function incrementDownloadCount(_id: number): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function deleteById(_id: number, _tenantId: string): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function deleteExpired(_now: string): Promise<number> {
	throw new Error(NOT_IMPL);
}

export async function countByTenant(_tenantId: string): Promise<number> {
	throw new Error(NOT_IMPL);
}
