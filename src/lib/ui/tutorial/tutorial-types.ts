export interface TutorialStep {
	id: string;
	chapterId: number;
	selector?: string;
	title: string;
	description: string;
	position: 'top' | 'bottom' | 'left' | 'right' | 'auto';
	page?: string;
}

export interface TutorialChapter {
	id: number;
	title: string;
	icon: string;
	steps: TutorialStep[];
}
