export type PlanTier = 'free' | 'standard' | 'family';

export interface TutorialStep {
	id: string;
	chapterId: number;
	selector?: string;
	title: string;
	description: string;
	position: 'top' | 'bottom' | 'left' | 'right' | 'auto';
	page?: string;
	/** この手順を表示する最低プランティア（省略時は全プラン表示） */
	requiredTier?: PlanTier;
}

export interface TutorialChapter {
	id: number;
	title: string;
	icon: string;
	steps: TutorialStep[];
}
