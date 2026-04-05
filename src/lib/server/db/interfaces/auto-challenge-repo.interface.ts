import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from '../types';

export interface IAutoChallengeRepo {
	findByChildAndWeek(
		childId: number,
		weekStart: string,
		tenantId: string,
	): Promise<AutoChallenge | undefined>;

	findActiveByChild(childId: number, tenantId: string): Promise<AutoChallenge | undefined>;

	findByChild(childId: number, tenantId: string, limit?: number): Promise<AutoChallenge[]>;

	insert(input: InsertAutoChallengeInput, tenantId: string): Promise<AutoChallenge>;

	update(id: number, input: UpdateAutoChallengeInput, tenantId: string): Promise<void>;

	expireOldChallenges(beforeDate: string, tenantId: string): Promise<number>;
	deleteByTenantId(tenantId: string): Promise<void>;
}
