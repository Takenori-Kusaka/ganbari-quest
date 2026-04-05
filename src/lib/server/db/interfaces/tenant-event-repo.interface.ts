import type {
	InsertTenantEventInput,
	TenantEvent,
	TenantEventProgress,
	UpdateTenantEventInput,
	UpsertTenantEventProgressInput,
} from '../types';

export interface ITenantEventRepo {
	findByTenantAndYear(tenantId: string, year: number): Promise<TenantEvent[]>;

	findByEventCode(
		tenantId: string,
		eventCode: string,
		year: number,
	): Promise<TenantEvent | undefined>;

	upsertEvent(input: InsertTenantEventInput, tenantId: string): Promise<TenantEvent>;

	updateEvent(id: number, input: UpdateTenantEventInput, tenantId: string): Promise<void>;

	findProgress(
		tenantId: string,
		eventCode: string,
		childId: number,
		year: number,
	): Promise<TenantEventProgress | undefined>;

	findProgressByChild(
		childId: number,
		year: number,
		tenantId: string,
	): Promise<TenantEventProgress[]>;

	upsertProgress(input: UpsertTenantEventProgressInput, tenantId: string): Promise<void>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
