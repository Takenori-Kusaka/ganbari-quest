<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import { ARCHIVED_RESOURCE_LABELS } from '$lib/domain/labels';
import ArchivedResourceBanner from './ArchivedResourceBanner.svelte';

// #4708: 無料プランの上限で archive (一時非表示) 中のリソースを親に告知する banner。
// 表示条件 (無料プランに戻った + 件数 > 0) は layout server が決めるため、ここでは
// 件数の内訳 (0 件の資源は省略) と 2 導線 (プランを見る / 非表示のお子さまを見る) を検証する。
const { Story } = defineMeta({
	title: 'Admin/ArchivedResourceBanner',
	component: ArchivedResourceBanner,
	tags: ['autodocs'],
});
</script>

<!-- 3 資源とも archive あり (trial 終了で 3 人中 1 人 + 活動 5 件 + チェックリスト 2 件が非表示) -->
<Story
	name="AllResources"
	args={{
		summary: {
			archivedChildCount: 1,
			archivedActivityCount: 5,
			archivedChecklistTemplateCount: 2,
			totalCount: 8,
			hasArchivedResources: true,
		},
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const banner = canvas.getByTestId('archived-resource-banner');
		await expect(banner).toBeVisible();
		await expect(canvas.getByTestId('archived-resource-banner-title')).toHaveTextContent(
			ARCHIVED_RESOURCE_LABELS.bannerTitle(
				ARCHIVED_RESOURCE_LABELS.breakdown({ children: 1, activities: 5, checklists: 2 }),
			),
		);
		await expect(canvas.getByTestId('archived-resource-banner-cta')).toHaveAttribute(
			'href',
			'/admin/subscription',
		);
		await expect(canvas.getByTestId('archived-resource-banner-list-link')).toHaveAttribute(
			'href',
			'/admin/children#archived',
		);
	}}
/>

<!-- 活動だけ archive (お子さまは上限内)。内訳は活動のみ、一覧リンクは出ない -->
<Story
	name="ActivitiesOnly"
	args={{
		summary: {
			archivedChildCount: 0,
			archivedActivityCount: 2,
			archivedChecklistTemplateCount: 0,
			totalCount: 2,
			hasArchivedResources: true,
		},
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId('archived-resource-banner-title')).toHaveTextContent(
			ARCHIVED_RESOURCE_LABELS.bannerTitle(
				ARCHIVED_RESOURCE_LABELS.breakdown({ children: 0, activities: 2, checklists: 0 }),
			),
		);
		await expect(canvas.queryByTestId('archived-resource-banner-list-link')).toBeNull();
	}}
/>

<!-- archive なし → 描画しない (layout 側でも出さないが component 単体でも防御) -->
<Story
	name="Empty"
	args={{
		summary: {
			archivedChildCount: 0,
			archivedActivityCount: 0,
			archivedChecklistTemplateCount: 0,
			totalCount: 0,
			hasArchivedResources: false,
		},
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByTestId('archived-resource-banner')).toBeNull();
	}}
/>
