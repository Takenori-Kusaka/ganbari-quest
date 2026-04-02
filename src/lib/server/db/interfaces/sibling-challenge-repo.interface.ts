import type {
	InsertSiblingChallengeInput,
	SiblingChallenge,
	SiblingChallengeProgress,
	UpdateSiblingChallengeInput,
} from '../types';

export interface ISiblingChallengeRepo {
	findAllChallenges(tenantId: string): Promise<SiblingChallenge[]>;
	findActiveChallenges(today: string, tenantId: string): Promise<SiblingChallenge[]>;
	findChallengeById(id: number, tenantId: string): Promise<SiblingChallenge | undefined>;
	insertChallenge(input: InsertSiblingChallengeInput, tenantId: string): Promise<SiblingChallenge>;
	updateChallenge(id: number, input: UpdateSiblingChallengeInput, tenantId: string): Promise<void>;
	deleteChallenge(id: number, tenantId: string): Promise<void>;

	findProgressByChallenge(
		challengeId: number,
		tenantId: string,
	): Promise<SiblingChallengeProgress[]>;
	findProgressByChild(childId: number, tenantId: string): Promise<SiblingChallengeProgress[]>;
	findProgress(
		challengeId: number,
		childId: number,
		tenantId: string,
	): Promise<SiblingChallengeProgress | undefined>;
	upsertProgress(
		challengeId: number,
		childId: number,
		currentValue: number,
		targetValue: number,
		tenantId: string,
	): Promise<void>;
	markCompleted(challengeId: number, childId: number, tenantId: string): Promise<void>;
	claimReward(challengeId: number, childId: number, tenantId: string): Promise<void>;
	enrollChildren(
		challengeId: number,
		children: { childId: number; targetValue: number }[],
		tenantId: string,
	): Promise<void>;
}
