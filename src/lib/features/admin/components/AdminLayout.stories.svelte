<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import { TRIAL_LABELS } from '$lib/domain/labels';
import AdminLayout from './AdminLayout.svelte';

// #3033: header のプラン情報表示 (trial 残日数 pill / upgrade-btn / plan-badge) を視覚確認 +
// play で配線検証する。プラン情報の常設表示は header が SSOT (body 常設カードは廃止) のため、
// 状態ごとの header 表示を story で固定する。children は layout 検証用の空 main コンテンツ。
const { Story } = defineMeta({
	title: 'Admin/AdminLayout',
	component: AdminLayout,
	tags: ['autodocs'],
	parameters: {
		layout: 'fullscreen',
		// AdminLayout は $app/stores の $page (現在パスのナビ active 判定) に依存するため
		// Storybook SvelteKit module mock で /admin を注入する
		sveltekit_experimental: {
			stores: {
				page: {
					url: new URL('http://localhost/admin'),
					data: {},
					params: {},
				},
			},
		},
	},
});
</script>

<!-- trial active (残 5 日): header に残日数 pill が出て /admin/subscription にリンクする。 -->
<Story
	name="TrialActivePill"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const pill = canvas.getByTestId('header-trial-pill');
		await expect(pill).toBeVisible();
		await expect(pill).toHaveTextContent(TRIAL_LABELS.headerPillLabel(5));
		await expect(pill).toHaveAttribute('href', '/admin/subscription');
	}}
>
	{#snippet template()}
		<AdminLayout
			mode="live"
			basePath="/admin"
			isPremium={false}
			planTier="free"
			trialDaysRemaining={5}
		>
			<div></div>
		</AdminLayout>
	{/snippet}
</Story>

<!-- free (trial 非 active): pill は出ず、upgrade-btn が唯一の常設導線。 -->
<Story
	name="FreeNoTrial"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByTestId('header-trial-pill')).toBeNull();
		const upgrade = canvasElement.querySelector('[data-tutorial="upgrade-btn"]');
		await expect(upgrade).toBeVisible();
		await expect(upgrade).toHaveAttribute('href', '/admin/subscription');
	}}
>
	{#snippet template()}
		<AdminLayout
			mode="live"
			basePath="/admin"
			isPremium={false}
			planTier="free"
			trialDaysRemaining={null}
		>
			<div></div>
		</AdminLayout>
	{/snippet}
</Story>

<!-- premium (standard): plan-badge がプランページへのリンクとして出る。pill / upgrade-btn は出ない。 -->
<Story
	name="PremiumBadge"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByTestId('header-trial-pill')).toBeNull();
		const badge = canvasElement.querySelector('.plan-badge');
		await expect(badge).toBeVisible();
		await expect(badge).toHaveAttribute('href', '/admin/subscription');
		await expect(canvasElement.querySelector('[data-tutorial="upgrade-btn"]')).toBeNull();
	}}
>
	{#snippet template()}
		<AdminLayout
			mode="live"
			basePath="/admin"
			isPremium={true}
			planTier="standard"
			trialDaysRemaining={null}
		>
			<div></div>
		</AdminLayout>
	{/snippet}
</Story>
