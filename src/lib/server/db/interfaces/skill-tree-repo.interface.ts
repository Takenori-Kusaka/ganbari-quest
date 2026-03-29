import type { ChildSkillNode, SkillNode, SkillPoints } from '../types';

export interface ISkillTreeRepo {
	findAllSkillNodes(tenantId: string): Promise<SkillNode[]>;
	findSkillNodeById(nodeId: number, tenantId: string): Promise<SkillNode | undefined>;
	findChildSkillNodes(childId: number, tenantId: string): Promise<ChildSkillNode[]>;
	insertChildSkillNode(childId: number, nodeId: number, tenantId: string): Promise<ChildSkillNode>;
	findSkillPoints(childId: number, tenantId: string): Promise<SkillPoints | undefined>;
	upsertSkillPoints(
		childId: number,
		balance: number,
		totalEarned: number,
		totalSpent: number,
		tenantId: string,
	): Promise<SkillPoints>;
}
