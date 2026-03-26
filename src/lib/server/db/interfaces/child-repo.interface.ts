import type { Child, InsertChildInput, UpdateChildInput } from '../types';

export interface IChildRepo {
	findAllChildren(tenantId: string): Promise<Child[]>;
	findChildById(id: number, tenantId: string): Promise<Child | undefined>;
	insertChild(input: InsertChildInput, tenantId: string): Promise<Child>;
	updateChild(id: number, input: UpdateChildInput, tenantId: string): Promise<Child | undefined>;
	deleteChild(id: number, tenantId: string): Promise<void>;
}
