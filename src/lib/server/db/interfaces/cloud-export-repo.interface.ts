import type { CloudExportRecord, InsertCloudExportInput } from '../types';

export interface ICloudExportRepo {
	findByTenant(tenantId: string): Promise<CloudExportRecord[]>;
	findByPin(pinCode: string): Promise<CloudExportRecord | undefined>;
	findById(id: number, tenantId: string): Promise<CloudExportRecord | undefined>;
	insert(input: InsertCloudExportInput): Promise<CloudExportRecord>;
	incrementDownloadCount(id: number): Promise<void>;
	deleteById(id: number, tenantId: string): Promise<void>;
	deleteExpired(now: string): Promise<number>;
	countByTenant(tenantId: string): Promise<number>;
}
