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
	wizardInProgress: false,
};

const complete = {
	items: items.map((i) => ({ ...i, completed: true })),
	completedCount: 5,
	totalCount: 5,
	allCompleted: true,
	dismissed: false,
	nextRecommendation: null,
	wizardInProgress: false,
};

// #4863 (PO 決裁 2026-09-09): ウィザードを中断した人。印が立っているので、続きは
// admin の checklist ではなく **ウィザード本体**へ戻す。
const wizardInterrupted = {
	...incomplete,
	wizardInProgress: true,
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

<!-- #4863: ウィザードを中断した人 (印あり)。続きは /setup/* に戻す。
     #2821 が admin へ誘導していたのは step 2〜9 が原理的に開かなかった時代の判断で、
     いま admin のままにすると questionnaire / rules / activities-defaults / challenges /
     first-adventure の 5 step が中断者に二度と届かない。 -->
<Story
	name="ResumeIntoWizard"
	args={{ onboarding: wizardInterrupted, variant: 'resume' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const banner = canvas.getByTestId('setup-resume-banner');
		await expect(banner).toBeVisible();
		const cta = canvas.getByTestId('setup-resume-cta');
		// 印が立っている人はウィザードへ。admin の次項目 (from=setup 付き) には行かない。
		await expect(cta).toHaveAttribute('href', '/setup/questionnaire');
		await expect(cta).not.toHaveAttribute('href', '/admin/activities?from=setup');
	}}
/>

<!-- #4863: context (admin 着地) でも同じ条件で行き先が変わる。面は増やさない。 -->
<Story
	name="ContextIntoWizard"
	args={{ onboarding: wizardInterrupted, variant: 'context' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const cta = canvas.getByTestId('setup-resume-cta');
		await expect(cta).toHaveAttribute('href', '/setup/questionnaire');
	}}
/>

<!-- 完了済み **かつ 印が降りている** ときだけ描画されない (Anti-engagement ADR-0012)。 -->
<Story
	name="CompletedRendersNothing"
	args={{ onboarding: complete, variant: 'resume' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// 歩き終えた人には出さない。
		await expect(canvas.queryByTestId('setup-resume-banner')).toBeNull();
	}}
/>

<!-- #4868 adversarial: 「あとでやる」で降りた人は、step 1〜4 で admin checklist の
     required が 4/5 まで埋まり、`/switch` から子供の画面を 1 回覗いた時点で 5/5 になる。
     `allCompleted` だけで消すと、印が立っているのにバナーが二度と出ず、
     rules / activities-defaults / challenges / **first-adventure** / complete が
     URL 直打ちだけのものに戻る。**印が立っている間は出す。** -->
<Story
	name="CompletedButWizardInProgress"
	args={{ onboarding: { ...complete, wizardInProgress: true }, variant: 'resume' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId('setup-resume-banner')).toBeVisible();
		await expect(canvas.getByTestId('setup-resume-cta')).toHaveAttribute(
			'href',
			'/setup/questionnaire',
		);
	}}
/>
