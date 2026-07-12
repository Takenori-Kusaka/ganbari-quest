// src/lib/domain/downgrade-types.ts
// #738: ダウングレードプレビュー — クライアント/サーバー共有型
import type { ActivityId, ChildId } from '$lib/domain/ids';

export interface ChildPreview {
	id: ChildId;
	name: string;
	uiMode: string;
}

export interface ActivityPreview {
	id: ActivityId;
	name: string;
	icon: string;
}

export interface ChecklistTemplatePreview {
	id: string;
	name: string;
	childId: ChildId;
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
		excessByChild: { childId: ChildId; childName: string; excess: number }[];
	};
	retentionChange: {
		currentDays: number | null;
		targetDays: number | null;
		willLoseHistory: boolean;
	};
	hasExcess: boolean;
}
