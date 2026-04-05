import type { InsertViewerTokenInput, ViewerToken } from '../types';

export interface IViewerTokenRepo {
	findByTenant(tenantId: string): Promise<ViewerToken[]>;
	findByToken(token: string): Promise<ViewerToken | undefined>;
	insert(input: InsertViewerTokenInput, tenantId: string): Promise<ViewerToken>;
	revoke(id: number, tenantId: string): Promise<void>;
	deleteById(id: number, tenantId: string): Promise<void>;
}
