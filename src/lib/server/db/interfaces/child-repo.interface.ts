import type { Child, InsertChildInput, UpdateChildInput } from '../types';

export interface IChildRepo {
	findAllChildren(): Promise<Child[]>;
	findChildById(id: number): Promise<Child | undefined>;
	insertChild(input: InsertChildInput): Promise<Child>;
	updateChild(id: number, input: UpdateChildInput): Promise<Child | undefined>;
	deleteChild(id: number): Promise<void>;
}
