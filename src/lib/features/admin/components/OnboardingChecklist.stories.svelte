<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import OnboardingChecklist from './OnboardingChecklist.svelte';

const basePath = '/admin';

const allItems = [
	{
		key: 'children',
		label: '子供を登録する',
		completed: false,
		href: `${basePath}/children`,
		required: true,
	},
	{
		key: 'activities',
		label: '活動パックを選ぶ',
		completed: false,
		href: `${basePath}/activities`,
		required: true,
	},
	{
		key: 'rewards',
		label: 'ごほうびプリセットを選ぶ',
		completed: false,
		href: `${basePath}/rewards`,
		required: true,
	},
	{
		key: 'checklist',
		label: 'チェックリストを作る',
		completed: false,
		href: `${basePath}/checklists`,
		required: true,
	},
	{
		key: 'child_screen',
		label: '子供の画面を確認する',
		completed: false,
		href: '/switch',
		required: true,
	},
	{
		key: 'pin',
		label: 'おやカギコードを変更する',
		completed: false,
		href: `${basePath}/settings`,
		required: false,
	},
];

const { Story } = defineMeta({
	title: 'Admin/OnboardingChecklist',
	component: OnboardingChecklist,
	tags: ['autodocs'],
});
</script>

<!-- 必須未完（初期状態） -->
<Story
	name="RequiredIncomplete"
	args={{
		onboarding: {
			items: allItems,
			completedCount: 0,
			totalCount: 6,
			allCompleted: false,
			dismissed: false,
			nextRecommendation: allItems[0],
		},
	}}
/>

<!-- 必須完了 + 任意未完（allCompleted=true で祝福表示） -->
<Story
	name="RequiredCompleteOptionalPending"
	args={{
		onboarding: {
			items: allItems.map((i) => (i.required ? { ...i, completed: true } : i)),
			completedCount: 5,
			totalCount: 6,
			allCompleted: true,
			dismissed: false,
			nextRecommendation: null,
		},
	}}
/>

<!-- 全完了 -->
<Story
	name="AllComplete"
	args={{
		onboarding: {
			items: allItems.map((i) => ({ ...i, completed: true })),
			completedCount: 6,
			totalCount: 6,
			allCompleted: true,
			dismissed: false,
			nextRecommendation: null,
		},
	}}
/>
