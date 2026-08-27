<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import { ARCHIVED_RESOURCE_LABELS } from '$lib/domain/labels';
import ArchivedChildrenSection from './ArchivedChildrenSection.svelte';

// #4708: /admin/children の「非表示になっているお子さま」読み取り専用一覧。
// 編集 / 削除 / 詳細リンクを置かず、復元は有料化 (webhook) が担うことを UI でも守る。
const { Story } = defineMeta({
	title: 'Admin/ArchivedChildrenSection',
	component: ArchivedChildrenSection,
	tags: ['autodocs'],
});
</script>

<Story
	name="TwoChildren"
	args={{
		children: [
			{ id: '3', nickname: 'けんた', age: 8, uiMode: 'elementary', avatarUrl: null },
			{ id: '4', nickname: 'ゆうこ', age: 13, uiMode: 'junior', avatarUrl: null },
		],
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const section = canvas.getByTestId('archived-children-section');
		await expect(section).toBeVisible();
		await expect(section).toHaveAttribute('id', 'archived');
		await expect(canvas.getAllByTestId('archived-child-item')).toHaveLength(2);
		await expect(section).toHaveTextContent(ARCHIVED_RESOURCE_LABELS.childrenSectionTitle);
		await expect(section).toHaveTextContent(ARCHIVED_RESOURCE_LABELS.childrenSectionReadOnlyTag);
		// 読み取り専用: 詳細 / 編集へのリンクは無く、導線はプランページだけ
		await expect(canvas.getByTestId('archived-children-cta')).toHaveAttribute(
			'href',
			'/admin/subscription',
		);
		await expect(canvas.queryByRole('link', { name: /けんた/ })).toBeNull();
	}}
/>

<Story
	name="Empty"
	args={{ children: [] }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByTestId('archived-children-section')).toBeNull();
	}}
/>
