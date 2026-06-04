<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import { PAGE_TITLES, SETUP_RESUME_LABELS, STORYBOOK_LABELS } from '$lib/domain/labels';
import SetupResumeBanner from './SetupResumeBanner.svelte';

// #2821: セットアップ離脱後の再開導線バナー。/switch・子供着地画面 (resume) と
// setup 由来の admin 文脈 (context) の 2 variant を視覚確認 + play で配線検証する。
// mock onboarding data の label は STORYBOOK_LABELS 経由 (表示文言は SETUP_RESUME_LABELS)。
const SB = STORYBOOK_LABELS.setupResumeBanner;
const items = [
	{
		key: 'children',
		label: SB.itemChildren,
		completed: true,
		href: '/admin/children',
		required: true,
	},
	{
		key: 'activities',
		label: PAGE_TITLES.setupPacks,
		completed: false,
		href: '/admin/activities',
		required: true,
	},
	{
		key: 'rewards',
		label: SB.itemRewards,
		completed: false,
		href: '/admin/rewards',
		required: true,
	},
	{
		key: 'checklist',
		label: SB.itemChecklist,
		completed: false,
		href: '/admin/checklists',
		required: true,
	},
	{
		key: 'child_screen',
		label: SB.itemChildScreen,
		completed: false,
		href: '/switch',
		required: true,
	},
];

const incomplete = {
	items,
	completedCount: 1,
	totalCount: 5,
	allCompleted: false,
	dismissed: false,
	nextRecommendation: items[1],
};

const complete = {
	items: items.map((i) => ({ ...i, completed: true })),
	completedCount: 5,
	totalCount: 5,
	allCompleted: true,
	dismissed: false,
	nextRecommendation: null,
};

const { Story } = defineMeta({
	title: 'Admin/SetupResumeBanner',
	component: SetupResumeBanner,
	tags: ['autodocs'],
});
</script>

<!-- 着地画面 (/switch・子供ホーム) で続きを促す。CTA は次の step に from=setup 付きで遷移する。 -->
<Story
	name="ResumeIncomplete"
	args={{ onboarding: incomplete, variant: 'resume' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const banner = canvas.getByTestId('setup-resume-banner');
		await expect(banner).toBeVisible();
		await expect(banner).toHaveAttribute('data-variant', 'resume');
		await expect(banner).toHaveAttribute('role', 'status');
		// resume CTA は続きをする文言 + 次 step (activities) に from=setup 付きで遷移する。
		const cta = canvas.getByTestId('setup-resume-cta');
		await expect(cta).toHaveTextContent(SETUP_RESUME_LABELS.resumeCta);
		await expect(cta).toHaveAttribute('href', '/admin/activities?from=setup');
	}}
/>

<!-- setup 由来で admin 画面に着地したときの文脈バナー。戻る導線が出る。 -->
<Story
	name="ContextFromSetup"
	args={{ onboarding: incomplete, variant: 'context' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const banner = canvas.getByTestId('setup-resume-banner');
		await expect(banner).toBeVisible();
		await expect(banner).toHaveAttribute('data-variant', 'context');
		// context バナーは setup に戻す文言 + href に from=setup を再付与しない (再帰回避)。
		const cta = canvas.getByTestId('setup-resume-cta');
		await expect(cta).toHaveTextContent(SETUP_RESUME_LABELS.backToSetupCta);
		await expect(cta).toHaveAttribute('href', '/admin/activities');
	}}
/>

<!-- 完了済みは描画されない (Anti-engagement ADR-0012: 進行中のみ表示)。 -->
<Story
	name="CompletedRendersNothing"
	args={{ onboarding: complete, variant: 'resume' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// allCompleted ではバナー自体が render されない。
		await expect(canvas.queryByTestId('setup-resume-banner')).toBeNull();
	}}
/>
