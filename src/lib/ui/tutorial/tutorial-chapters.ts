import {
	NAV_CATEGORIES,
	NAV_ITEM_LABELS,
	OYAKAGI_LABELS,
	PLAN_LABELS,
	TUTORIAL_CHAPTER_LABELS,
} from '$lib/domain/labels';
import type { PlanTier, TutorialChapter } from './tutorial-types';

const TIER_ORDER: Record<PlanTier, number> = { free: 0, standard: 1, family: 2 };

const L = TUTORIAL_CHAPTER_LABELS;

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
	{
		id: 1,
		title: L.chapters.intro.title,
		icon: L.chapters.intro.icon,
		steps: [
			{
				id: 'intro-1',
				chapterId: 1,
				selector: '[data-tutorial="nav-desktop"], [data-tutorial="nav-primary"]',
				title: L.steps['intro-1'].title,
				description: `メニューは「${NAV_CATEGORIES.monitor.label}」「${NAV_CATEGORIES.encourage.label}」「${NAV_CATEGORIES.customize.label}」「${NAV_CATEGORIES.settings.label}」の4つのカテゴリに分かれています。それぞれのカテゴリを開くと、詳しいメニューが表示されます。`,
				position: 'top',
				page: '/admin',
			},
			{
				id: 'intro-2',
				chapterId: 1,
				selector: '[data-tutorial="summary-cards"]',
				title: L.steps['intro-2'].title,
				description: L.steps['intro-2'].description,
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'intro-3',
				chapterId: 1,
				selector: '[data-tutorial="monthly-summary"]',
				title: L.steps['intro-3'].title,
				description: L.steps['intro-3'].description,
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'intro-4',
				chapterId: 1,
				selector: '[data-tutorial="children-overview"]',
				title: L.steps['intro-4'].title,
				description: L.steps['intro-4'].description,
				position: 'bottom',
				page: '/admin',
			},
		],
	},
	{
		id: 2,
		title: L.chapters.children.title,
		icon: L.chapters.children.icon,
		steps: [
			{
				id: 'children-1',
				chapterId: 2,
				selector: '[data-tutorial="add-child-btn"]',
				title: L.steps['children-1'].title,
				description: L.steps['children-1'].description,
				position: 'bottom',
				page: '/admin/children',
			},
			{
				id: 'children-2',
				chapterId: 2,
				selector: '[data-tutorial="children-list"]',
				title: L.steps['children-2'].title,
				description: L.steps['children-2'].description,
				position: 'bottom',
				page: '/admin/children',
			},
			{
				id: 'children-3',
				chapterId: 2,
				selector: '[data-tutorial="child-card"]',
				title: L.steps['children-3'].title,
				description: L.steps['children-3'].description,
				position: 'bottom',
				page: '/admin/children',
			},
		],
	},
	{
		id: 3,
		title: L.chapters.activities.title,
		icon: L.chapters.activities.icon,
		steps: [
			{
				id: 'activities-1',
				chapterId: 3,
				selector: '[data-tutorial="activity-list"]',
				title: L.steps['activities-1'].title,
				description: L.steps['activities-1'].description,
				position: 'bottom',
				page: '/admin/activities',
			},
			{
				id: 'activities-2',
				chapterId: 3,
				selector: '[data-tutorial="category-filter"]',
				title: L.steps['activities-2'].title,
				description: L.steps['activities-2'].description,
				position: 'bottom',
				page: '/admin/activities',
			},
			{
				id: 'activities-3',
				chapterId: 3,
				selector: '[data-tutorial="add-activity-btn"]',
				title: L.steps['activities-3'].title,
				description: `お子さまの習い事や家庭のルールに合わせたオリジナル活動を追加できます。例えば「ピアノの練習30分」「犬のお散歩」など、ご家庭ならではの活動を登録しましょう。\n\n⭐ 活動の追加・編集は${PLAN_LABELS.standard}以上で利用できます。${PLAN_LABELS.free}では初期登録されている活動をそのままご利用いただけます。`,
				position: 'bottom',
				page: '/admin/activities',
				requiredTier: 'standard',
			},
		],
	},
	{
		id: 4,
		title: L.chapters.rewards.title,
		icon: L.chapters.rewards.icon,
		steps: [
			{
				id: 'rewards-1',
				chapterId: 4,
				selector: '[data-tutorial="rewards-section"]',
				title: L.steps['rewards-1'].title,
				description: L.steps['rewards-1'].description,
				position: 'bottom',
				page: '/admin/rewards',
			},
			{
				id: 'rewards-2',
				chapterId: 4,
				selector: '[data-tutorial="points-section"]',
				title: L.steps['rewards-2'].title,
				description: L.steps['rewards-2'].description,
				position: 'top',
				page: '/admin/points',
			},
		],
	},
	{
		id: 5,
		title: `${NAV_CATEGORIES.monitor.label}（${NAV_ITEM_LABELS.reports}）`,
		icon: L.chapters.reports.icon,
		steps: [
			{
				id: 'reports-1',
				chapterId: 5,
				selector: '[data-tutorial="report-tabs"]',
				title: L.steps['reports-1'].title,
				description: L.steps['reports-1'].description,
				position: 'bottom',
				page: '/admin/reports',
			},
			{
				id: 'reports-2',
				chapterId: 5,
				selector: '[data-tutorial="growth-book-link"]',
				title: L.steps['reports-2'].title,
				description: L.steps['reports-2'].description,
				position: 'bottom',
				page: '/admin/reports',
			},
		],
	},
	{
		id: 6,
		title: `${NAV_CATEGORIES.encourage.label}（${NAV_ITEM_LABELS.messages}）`,
		icon: L.chapters.messages.icon,
		steps: [
			{
				id: 'messages-1',
				chapterId: 6,
				selector: '[data-tutorial="message-child-select"]',
				title: L.steps['messages-1'].title,
				description: L.steps['messages-1'].description,
				position: 'bottom',
				page: '/admin/messages',
			},
			{
				id: 'messages-2',
				chapterId: 6,
				selector: '[data-tutorial="message-stamp-grid"]',
				title: L.steps['messages-2'].title,
				description: L.steps['messages-2'].description,
				position: 'bottom',
				page: '/admin/messages',
			},
		],
	},
	{
		id: 7,
		title: `${NAV_CATEGORIES.customize.label}（データ管理）`,
		icon: L.chapters.customize.icon,
		steps: [
			{
				id: 'customize-1',
				chapterId: 7,
				selector: '[data-tutorial="data-management"]',
				title: L.steps['customize-1'].title,
				description: L.steps['customize-1'].description,
				position: 'bottom',
				page: '/admin/settings',
				requiredTier: 'standard',
			},
		],
	},
	{
		id: 8,
		title: L.chapters.settings.title,
		icon: L.chapters.settings.icon,
		steps: [
			{
				id: 'settings-1',
				chapterId: 8,
				selector: '[data-tutorial="switch-to-child"]',
				title: L.steps['settings-1'].title,
				description: `こどもにタブレットやスマホを渡す時に使います。こども専用のゲーム画面に切り替わり、自分で活動を記録できるようになります。管理画面に戻るには${OYAKAGI_LABELS.name}が必要です。\n\n💡 こども画面にも「❓」ボタンからアクセスできる操作ガイドがあります。お子さまが自分で使い方を確認できるので安心です。`,
				position: 'bottom',
				page: '/admin',
			},
			{
				id: 'settings-2',
				chapterId: 8,
				selector: '[data-tutorial="pin-settings"]',
				title: OYAKAGI_LABELS.sectionTitle,
				description: `${L.steps['settings-2'].description}${OYAKAGI_LABELS.name}${L.steps['settings-2'].descriptionSuffix}${OYAKAGI_LABELS.defaultValueHint}。`,
				position: 'bottom',
				page: '/admin/settings',
			},
			{
				id: 'settings-3',
				chapterId: 8,
				selector: '[data-tutorial="feedback-section"]',
				title: L.steps['settings-3'].title,
				description: L.steps['settings-3'].description,
				position: 'top',
				page: '/admin/settings',
			},
			{
				id: 'settings-4',
				chapterId: 8,
				selector: '[data-tutorial="tutorial-restart"]',
				title: L.steps['settings-4'].title,
				description: L.steps['settings-4'].description,
				position: 'bottom',
				page: '/admin/settings',
			},
		],
	},
	{
		id: 9,
		title: L.chapters.upgrade.title,
		icon: L.chapters.upgrade.icon,
		steps: [
			{
				id: 'premium-1',
				chapterId: 9,
				selector: '[data-tutorial="upgrade-btn"]',
				title: L.steps['premium-1'].title,
				description: L.steps['premium-1'].description,
				position: 'bottom',
				page: '/admin',
			},
		],
	},
];

export function getAllSteps() {
	return TUTORIAL_CHAPTERS.flatMap((ch) => ch.steps);
}

/** プランティアに応じてフィルタされたチャプターを返す */
export function getChaptersForPlan(planTier: PlanTier): TutorialChapter[] {
	return TUTORIAL_CHAPTERS.map((ch) => ({
		...ch,
		steps: ch.steps.filter((step) => {
			if (!step.requiredTier) return true;
			return TIER_ORDER[planTier] >= TIER_ORDER[step.requiredTier];
		}),
	})).filter((ch) => ch.steps.length > 0);
}
