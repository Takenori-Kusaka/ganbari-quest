// src/lib/server/db/interfaces/auto-challenge-repo.interface.ts
import type { AutoChallenge, InsertAutoChallengeInput, UpdateAutoChallengeInput } from '../types';

export interface IAutoChallengeRepo {
	findActiveChallenge(
		childId: number,
		today: string,
		tenantId: string,
	): Promise<AutoChallenge | null>;
	findChallengesByChild(childId: number, tenantId: string): Promise<AutoChallenge[]>;
	findChallengeById(challengeId: number, tenantId: string): Promise<AutoChallenge | null>;
	insertChallenge(input: InsertAutoChallengeInput, tenantId: string): Promise<AutoChallenge>;
	updateChallenge(
		challengeId: number,
		input: UpdateAutoChallengeInput,
		tenantId: string,
	): Promise<void>;
	expireOldChallenges(today: string, tenantId: string): Promise<number>;
}
