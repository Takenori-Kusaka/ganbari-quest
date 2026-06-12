import type { CloudExportRecord, InsertCloudExportInput } from '../types';

export interface ICloudExportRepo {
	findByTenant(tenantId: string): Promise<CloudExportRecord[]>;
	findByPin(pinCode: string): Promise<CloudExportRecord | undefined>;
	findById(id: number, tenantId: string): Promise<CloudExportRecord | undefined>;
	insert(input: InsertCloudExportInput): Promise<CloudExportRecord>;
	/**
	 * #2845 B1: tenantId 必須 (旧 id-only は DynamoDB 側で tenant 無束縛 Scan + 全 tenant write 可能形状)。
	 * 呼び出し元 (findByPin 経路) は record.tenantId を持つため signature で束縛する。
	 */
	incrementDownloadCount(id: number, tenantId: string): Promise<void>;
	deleteById(id: number, tenantId: string): Promise<void>;
	deleteExpired(now: string): Promise<number>;
	countByTenant(tenantId: string): Promise<number>;
}
