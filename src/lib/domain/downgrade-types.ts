// src/lib/domain/downgrade-types.ts
// #738: ダウングレードプレビュー — クライアント/サーバー共有型

export interface ChildPreview {
	id: number;
	name: string;
	uiMode: string;
}

export interface ActivityPreview {
	id: number;
	name: string;
	icon: string;
}

export interface ChecklistTemplatePreview {
	id: number;
	name: string;
	childId: number;
	childName: string;
}

export interface DowngradePreview {
	targetTier: string;
	children: {
		current: ChildPreview[];
		max: number | null;
		excess: number;
	};
	activities: {
		current: ActivityPreview[];
		max: number | null;
		excess: number;
	};
	checklistTemplates: {
		current: ChecklistTemplatePreview[];
		maxPerChild: number | null;
		excessByChild: { childId: number; childName: string; excess: number }[];
	};
	retentionChange: {
		currentDays: number | null;
		targetDays: number | null;
		willLoseHistory: boolean;
	};
	hasExcess: boolean;
}
