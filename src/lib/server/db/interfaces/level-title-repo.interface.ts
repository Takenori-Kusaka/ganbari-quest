import type { LevelTitle } from '../types';

export interface ILevelTitleRepo {
	findByTenant(tenantId: string): Promise<LevelTitle[]>;
	upsert(tenantId: string, level: number, customTitle: string): Promise<void>;
	deleteByTenantAndLevel(tenantId: string, level: number): Promise<void>;
	deleteAllByTenant(tenantId: string): Promise<void>;
}
