import type { InsertSiblingCheerInput, SiblingCheer } from '../types';

export interface ISiblingCheerRepo {
	insertCheer(input: InsertSiblingCheerInput, tenantId: string): Promise<SiblingCheer>;
	findUnshownCheers(toChildId: number, tenantId: string): Promise<SiblingCheer[]>;
	markShown(cheerIds: number[], tenantId: string): Promise<void>;
	countTodayCheersFrom(fromChildId: number, tenantId: string): Promise<number>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
