import type { ChildTitle, Title } from '../types';

export interface ITitleRepo {
	findAllTitles(): Promise<Title[]>;
	findTitleById(id: number): Promise<Title | undefined>;
	findUnlockedTitles(childId: number): Promise<{ titleId: number; unlockedAt: string }[]>;
	isTitleUnlocked(childId: number, titleId: number): Promise<boolean>;
	insertChildTitle(childId: number, titleId: number): Promise<ChildTitle>;
	getActiveTitleId(childId: number): Promise<number | null>;
	setActiveTitleId(childId: number, titleId: number | null): Promise<void>;
}
