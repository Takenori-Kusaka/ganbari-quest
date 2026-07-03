<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import FeatureGate from './FeatureGate.svelte';

const L = STORYBOOK_LABELS.featureGate;

const { Story } = defineMeta({
	title: 'Components/FeatureGate',
	component: FeatureGate,
	tags: ['autodocs'],
});
</script>

<!--
  Unlocked: currentTier が requiredTier を満たすとき children をそのまま描画。
-->
<Story name="Unlocked" args={{ currentTier: 'family', requiredTier: 'standard' }}>
	{#snippet children()}
		<span>{L.unlockedContent}</span>
	{/snippet}
</Story>

<!--
  LockedInline: free が standard 機能に触れると 🔒 disabled ボタン。tap で popover が開き
  ① 利用不可 ② 対象プラン名 ③ プラン画面リンク が出る (§10.2.1、CX-DoR #8 操作回帰)。
  Popover は Portal 経由で描画されるため screen (document.body 起点) を使う。
-->
<Story
	name="LockedInline"
	args={{
		currentTier: 'free',
		requiredTier: 'standard',
		display: 'inline',
		buttonLabel: L.buttonLabel,
	}}
	play={async () => {
		const trigger = await waitFor(() => screen.getByTestId('feature-gate-locked-trigger'));
		await expect(trigger).toBeVisible();
		await expect(trigger).toHaveAttribute('aria-disabled', 'true');
		// tap → popover open (dead-end でない: プラン画面リンクを提示)
		await userEvent.click(trigger);
		const popover = await waitFor(() => screen.getByTestId('feature-gate-popover'));
		await expect(popover).toBeVisible();
		const link = screen.getByTestId('feature-gate-popover-link');
		await expect(link).toHaveAttribute('href', '/admin/subscription');
	}}
>
	{#snippet children()}
		<span>{L.unlockedContent}</span>
	{/snippet}
</Story>

<!--
  LockedSection: パネル全体を disabled + overlay。overlay tap で同じ popover が開く。
-->
<Story
	name="LockedSection"
	args={{ currentTier: 'free', requiredTier: 'standard', display: 'section' }}
	play={async () => {
		const trigger = await waitFor(() => screen.getByTestId('feature-gate-locked-trigger'));
		await userEvent.click(trigger);
		const popover = await waitFor(() => screen.getByTestId('feature-gate-popover'));
		await expect(popover).toBeVisible();
	}}
>
	{#snippet children()}
		<div>{L.sectionTitle}</div>
	{/snippet}
</Story>

<style>
	:global(.sb-story) {
		min-height: 300px;
	}
</style>
