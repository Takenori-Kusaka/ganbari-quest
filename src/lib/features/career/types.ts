// src/lib/features/career/types.ts
// キャリアプランニング機能の型定義

export interface MandalaGoal {
	goal: string;
	actions: string[];
}

export interface MandalaChart {
	center: string;
	surrounding: MandalaGoal[];
}

export interface CareerField {
	id: number;
	name: string;
	description: string | null;
	icon: string | null;
	relatedCategories: number[];
	recommendedActivities: number[];
	minAge: number;
}

export interface CareerPlan {
	id: number;
	childId: number;
	careerFieldId: number | null;
	dreamText: string | null;
	mandalaChart: MandalaChart;
	timeline3y: string | null;
	timeline5y: string | null;
	timeline10y: string | null;
	targetStatuses: Record<string, number>;
	version: number;
	isActive: number;
	careerField: CareerField | null;
}
