import type { ChildTitle, Title } from '../types';

export interface ITitleRepo {
	findAllTitles(tenantId: string): Promise<Title[]>;
	findTitleById(id: number, tenantId: string): Promise<Title | undefined>;
	findUnlockedTitles(
		childId: number,
		tenantId: string,
	): Promise<{ titleId: number; unlockedAt: string }[]>;
	isTitleUnlocked(childId: number, titleId: number, tenantId: string): Promise<boolean>;
	insertChildTitle(childId: number, titleId: number, tenantId: string): Promise<ChildTitle>;
	getActiveTitleId(childId: number, tenantId: string): Promise<number | null>;
	setActiveTitleId(childId: number, titleId: number | null, tenantId: string): Promise<void>;
}
