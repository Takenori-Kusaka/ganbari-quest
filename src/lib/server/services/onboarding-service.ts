// src/lib/server/services/onboarding-service.ts
// オンボーディングチェックリスト — 自動完了検知

import { findTemplatesByChild } from '$lib/server/db/checklist-repo';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { getActivities } from '$lib/server/services/activity-service';
import { getAllChildren } from '$lib/server/services/child-service';

export interface OnboardingItem {
	key: string;
	label: string;
	completed: boolean;
	href: string;
}

export interface OnboardingProgress {
	items: OnboardingItem[];
	completedCount: number;
	totalCount: number;
	allCompleted: boolean;
	dismissed: boolean;
	nextRecommendation: OnboardingItem | null;
}

const DISMISSED_KEY = 'onboarding_dismissed';
const CHILD_SCREEN_VISITED_KEY = 'onboarding_child_screen_visited';

export async function getOnboardingProgress(
	tenantId: string,
	basePath: string,
): Promise<OnboardingProgress> {
	const [children, activities, pinHash, dismissed, childScreenVisited] = await Promise.all([
		getAllChildren(tenantId),
		getActivities(tenantId),
		getSetting('pin_hash', tenantId),
		getSetting(DISMISSED_KEY, tenantId),
		getSetting(CHILD_SCREEN_VISITED_KEY, tenantId),
	]);

	// Item 4: Check if any child has a checklist template
	let hasChecklist = false;
	for (const child of children) {
		const templates = await findTemplatesByChild(child.id, tenantId, false);
		if (templates.length > 0) {
			hasChecklist = true;
			break;
		}
	}

	const items: OnboardingItem[] = [
		{
			key: 'children',
			label: '子供を登録する',
			completed: children.length > 0,
			href: `${basePath}/members`,
		},
		{
			key: 'activities',
			label: '活動パックを選ぶ',
			completed: activities.length > 0,
			href: `${basePath}/activities`,
		},
		{
			key: 'pin',
			label: 'PINコードを設定する',
			completed: !!pinHash,
			href: `${basePath}/settings`,
		},
		{
			key: 'checklist',
			label: 'チェックリストを作る',
			completed: hasChecklist,
			href: `${basePath}/checklists`,
		},
		{
			key: 'child_screen',
			label: '子供の画面を確認する',
			completed: childScreenVisited === 'true',
			href: '/switch',
		},
	];

	const completedCount = items.filter((i) => i.completed).length;
	const totalCount = items.length;
	const allCompleted = completedCount === totalCount;
	const nextRecommendation = items.find((i) => !i.completed) ?? null;

	return {
		items,
		completedCount,
		totalCount,
		allCompleted,
		dismissed: dismissed === 'true',
		nextRecommendation,
	};
}

export async function markChildScreenVisited(tenantId: string): Promise<void> {
	await setSetting(CHILD_SCREEN_VISITED_KEY, 'true', tenantId);
}

export async function dismissOnboarding(tenantId: string): Promise<void> {
	await setSetting(DISMISSED_KEY, 'true', tenantId);
}
