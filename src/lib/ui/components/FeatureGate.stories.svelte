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
  LockedInlineWithReason (#4992): 一覧の行に置くロックした操作 (ごほうび管理の「編集」)。
  popover は押してから開くため、押す前に読める理由の注記を近くに常時出し、trigger から
  aria-describedby で指す。解放判定は呼び出し側の述語 (unlocked) を優先する —
  currentTier が family でも unlocked=false ならロックする (server の拒否と同じ述語で出すため)。
-->
<Story
	name="LockedInlineWithReason"
	play={async () => {
		const note = await waitFor(() => screen.getByTestId('story-gate-reason'));
		await expect(note).toBeVisible();
		const trigger = screen.getByTestId('story-row-locked-trigger');
		// 押す前: 理由の注記を指している / 実行できないことを支援技術に伝える / フォーカスできる
		await expect(trigger).toHaveAttribute('aria-describedby', 'story-gate-reason');
		await expect(trigger).toHaveAttribute('aria-disabled', 'true');
		await expect(trigger).not.toBeDisabled();
		// 本物の操作 (children) は描画しない
		await expect(screen.queryByText(L.unlockedContent)).toBeNull();
		// 押すと拒否ではなくプラン画面への案内が開く
		await userEvent.click(trigger);
		const popover = await waitFor(() => screen.getByTestId('feature-gate-popover'));
		await expect(popover).toBeVisible();
		await expect(screen.getByTestId('feature-gate-popover-link')).toHaveAttribute(
			'href',
			'/admin/subscription',
		);
	}}
>
	{#snippet template()}
		<p id="story-gate-reason" data-testid="story-gate-reason">{L.reasonNote}</p>
		<FeatureGate
			currentTier="family"
			requiredTier="standard"
			unlocked={false}
			display="inline"
			buttonLabel={L.rowButtonLabel}
			describedBy="story-gate-reason"
			testid="story-row-locked-trigger"
		>
			<span>{L.unlockedContent}</span>
		</FeatureGate>
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

<!--
  QuotaReached: quota 上限到達 (current >= max) で disabled + popover (§10.2.2)。
  tier ではなく quota で開閉判定する。
-->
<Story
	name="QuotaReached"
	args={{
		currentTier: 'free',
		requiredTier: 'standard',
		display: 'inline',
		buttonLabel: L.buttonLabel,
		quota: { allowed: false, current: 3, max: 3 },
	}}
	play={async () => {
		const trigger = await waitFor(() => screen.getByTestId('feature-gate-locked-trigger'));
		await userEvent.click(trigger);
		const popover = await waitFor(() => screen.getByTestId('feature-gate-popover'));
		await expect(popover).toBeVisible();
	}}
>
	{#snippet children()}
		<span>{L.unlockedContent}</span>
	{/snippet}
</Story>

<!--
  QuotaAvailable: 上限未到達 (current < max) は操作可 = children をそのまま描画 (gate なし)。
-->
<Story
	name="QuotaAvailable"
	args={{
		currentTier: 'free',
		requiredTier: 'standard',
		display: 'inline',
		buttonLabel: L.buttonLabel,
		quota: { allowed: true, current: 1, max: 3 },
	}}
	play={async () => {
		// gate 痕跡 (locked trigger) は出ず、children が見える
		await expect(screen.queryByTestId('feature-gate-locked-trigger')).toBeNull();
		await expect(screen.getByText(L.unlockedContent)).toBeVisible();
	}}
>
	{#snippet children()}
		<span>{L.unlockedContent}</span>
	{/snippet}
</Story>

<!--
  QuotaUnlimited: max===null (無制限プラン) はゲート痕跡を一切描画しない (§10.2.2)。
-->
<Story
	name="QuotaUnlimited"
	args={{
		currentTier: 'family',
		requiredTier: 'standard',
		display: 'inline',
		buttonLabel: L.buttonLabel,
		quota: { allowed: true, current: 8, max: null },
	}}
	play={async () => {
		await expect(screen.queryByTestId('feature-gate-locked-trigger')).toBeNull();
		await expect(screen.getByText(L.unlockedContent)).toBeVisible();
	}}
>
	{#snippet children()}
		<span>{L.unlockedContent}</span>
	{/snippet}
</Story>

<style>
	:global(.sb-story) {
		min-height: 300px;
	}
</style>
