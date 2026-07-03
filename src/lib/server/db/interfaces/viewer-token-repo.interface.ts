import type { InsertViewerTokenInput, ViewerToken } from '../types';

export interface IViewerTokenRepo {
	findByTenant(tenantId: string): Promise<ViewerToken[]>;
	findByToken(token: string): Promise<ViewerToken | undefined>;
	insert(input: InsertViewerTokenInput, tenantId: string): Promise<ViewerToken>;
	revoke(id: string, tenantId: string): Promise<void>;
	deleteById(id: string, tenantId: string): Promise<void>;
}
