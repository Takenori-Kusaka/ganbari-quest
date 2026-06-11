<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import AdminResourceHeader from './AdminResourceHeader.svelte';

const L = STORYBOOK_LABELS.adminResourceHeader;

// #2998 (EPIC #2897): 3 画面共通ヘッダーの play coverage (CX-DoR #8、interactive component は play 必須)。
// 「+ 追加 trigger click → dropdown open → item (manual / ai / browse) visible → select で onSelect 発火」を
// 検証する。先頭 3 item の id/順序が同型であることを assert し、3 画面 add 経路同型性の component 層担保とする。
const manualSpy = fn();
const aiSpy = fn();
const browseSpy = fn();

const addMenuItems = [
	{ id: 'manual', label: L.addManual, icon: '✏️', onSelect: manualSpy },
	{ id: 'ai', label: L.addAi, icon: '✨', onSelect: aiSpy },
	{ id: 'browse', label: L.addBrowse, icon: '🔍', onSelect: browseSpy },
];

const overflowItems = [
	{ id: 'restore', label: L.overflowRestore, icon: '⬇', onSelect: () => {} },
	{ id: 'export', label: L.overflowExport, icon: '⬆', onSelect: () => {} },
];

const { Story } = defineMeta({
	title: 'Admin/AdminResourceHeader',
	component: AdminResourceHeader,
	tags: ['autodocs'],
	args: {
		title: L.title,
		description: L.description,
		addMenuItems,
		addButtonLabel: L.addButtonLabel,
		addMenuAriaLabel: L.addMenuAriaLabel,
		addMenuTestid: 'story-add-menu',
		overflowItems,
		overflowTriggerLabel: L.overflowTrigger,
		overflowMenuAriaLabel: L.overflowAriaLabel,
		overflowMenuTestid: 'story-overflow-menu',
	},
});
</script>

<!--
  Default: + 追加 trigger click → dropdown open → manual/ai/browse item visible → select で onSelect 発火。
  Menu は Portal 経由で content を render するため screen (document.body 起点) を使う。
-->
<Story
	name="Default"
	play={async () => {
		const trigger = screen.getByRole('button', { name: L.addMenuAriaLabel });
		await expect(trigger).toBeVisible();
		await userEvent.click(trigger);
		// 先頭 3 item (manual / ai / browse) が同型順序で visible (3 画面 add 経路同型性)
		const manualItem = await waitFor(() => screen.getByTestId('menu-item-manual'));
		await expect(manualItem).toBeVisible();
		await expect(screen.getByTestId('menu-item-ai')).toBeVisible();
		await expect(screen.getByTestId('menu-item-browse')).toBeVisible();
		// item select → onSelect spy 発火 (dropdown → 起動の入口が機能する)
		await userEvent.click(manualItem);
		await waitFor(() => expect(manualSpy).toHaveBeenCalledTimes(1));
	}}
/>

<!-- AddDisabled: 上限到達など add 不可状態では + 追加 trigger が disabled になる -->
<Story name="AddDisabled" args={{ addDisabled: true }} />

<!--
  OverflowWithFeedback (#2904): ︙ overflow を開くと、ページが渡した item (restore / export) の
  末尾に標準「ご意見を送る」item が自動 append されている (FeedbackFab 撤去の補填導線)。
-->
<Story
	name="OverflowWithFeedback"
	play={async () => {
		const trigger = screen.getByTestId('story-overflow-menu');
		await expect(trigger).toBeVisible();
		await userEvent.click(trigger);
		const restoreItem = await waitFor(() => screen.getByTestId('menu-item-restore'));
		await expect(restoreItem).toBeVisible();
		await expect(screen.getByTestId('menu-item-export')).toBeVisible();
		// 標準末尾 item (ご意見を送る) が component により自動 append される
		await expect(screen.getByTestId('menu-item-feedback')).toBeVisible();
	}}
/>

<!--
  FeedbackOnlyOverflow (#2904、旧 NoOverflow): ページが overflow item を渡さなくても、
  標準「ご意見を送る」item のみで ︙ が render される (全リソース画面 1 hop 到達性の担保)。
-->
<Story
	name="FeedbackOnlyOverflow"
	args={{ overflowItems: [] }}
	play={async () => {
		const trigger = screen.getByTestId('story-overflow-menu');
		await expect(trigger).toBeVisible();
		await userEvent.click(trigger);
		const feedbackItem = await waitFor(() => screen.getByTestId('menu-item-feedback'));
		await expect(feedbackItem).toBeVisible();
	}}
/>

<!-- WithBadge: title 横に有料バッジ等を差し込む -->
<Story name="WithBadge">
	<AdminResourceHeader
		title={L.title}
		description={L.description}
		addMenuItems={addMenuItems}
		addButtonLabel={L.addButtonLabel}
		addMenuAriaLabel={L.addMenuAriaLabel}
		addMenuTestid="story-add-menu-badge"
	>
		{#snippet badge()}
			<span class="px-2 py-0.5 text-[10px] rounded-full bg-[var(--color-premium)] text-[var(--color-text-inverse)]">{L.badge}</span>
		{/snippet}
	</AdminResourceHeader>
</Story>
